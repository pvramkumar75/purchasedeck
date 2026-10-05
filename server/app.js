import cors from 'cors'
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'
import {
  COMPANIES,
  PLANTS,
  STEP_KEYS,
  applyEditor,
  applyRecords,
  asId,
  asItem,
  clearPlantUploads,
  companiesForPlant,
  companyOf,
  decorate,
  hashToken,
  isPublishedPassword,
  lineLabel,
  notifyChangedSpecials,
  num,
  parseWorkbook,
  pushNotice,
  removeUpload,
  specialSnapshot,
  stepPatch,
} from './logic.js'
import { HttpError, mutate, readStore } from './persist.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist')
const FALLBACK_PIN = 'buyer123'
const SESSION_DAYS = 30
const LOCK_LIMIT = 8
const LOCK_MINUTES = 15
const DAY = 86400000

// ---------- sessions and sign-in ----------

function fresh(at, days = SESSION_DAYS) {
  return Date.now() - new Date(at).getTime() < days * DAY
}

function pruneSessions(store) {
  store.sessions = store.sessions.filter((item) => fresh(item.at)).slice(-40)
  store.plantSessions = Object.fromEntries(
    Object.entries(store.plantSessions).filter(([, item]) => fresh(item.at)).slice(-200),
  )
}

function viewerOf(store, req) {
  const buyerToken = req.get('x-buyer-token')
  if (buyerToken) {
    const hash = hashToken(buyerToken)
    if (store.sessions.some((item) => item.hash === hash && fresh(item.at))) return { buyer: true, hash }
  }
  const plantToken = req.get('x-plant-token')
  if (plantToken) {
    const session = store.plantSessions[hashToken(plantToken)]
    if (session && fresh(session.at) && COMPANIES.includes(session.plant)) return { plant: session.plant }
  }
  return null
}

function requireBuyer(store, req) {
  const viewer = viewerOf(store, req)
  if (!viewer?.buyer) throw new HttpError(401, 'Sign in to the purchase desk again.')
  return viewer
}

function scrypt(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString('hex')
}

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest()
  const right = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(left, right)
}

function pinMatches(store, pin) {
  if (store.buyerPin?.hash) return safeEqual(scrypt(pin, store.buyerPin.salt), store.buyerPin.hash)
  return safeEqual(pin, process.env.BUYER_PIN || FALLBACK_PIN)
}

function clientIp(req) {
  return String(req.get('x-real-ip') || req.get('x-forwarded-for') || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim()
}

function lockKey(account, req) {
  return `${account}|${hashToken(clientIp(req)).slice(0, 16)}`
}

function lockedFor(store, key) {
  const entry = store.loginFailures[key]
  if (!entry || entry.count < LOCK_LIMIT) return 0
  const left = new Date(entry.first).getTime() + LOCK_MINUTES * 60000 - Date.now()
  return left > 0 ? Math.ceil(left / 60000) : 0
}

function noteFailure(store, key) {
  const now = Date.now()
  for (const [name, entry] of Object.entries(store.loginFailures)) {
    if (now - new Date(entry.first).getTime() > LOCK_MINUTES * 60000) delete store.loginFailures[name]
  }
  const entry = store.loginFailures[key] || { count: 0, first: new Date(now).toISOString() }
  entry.count += 1
  store.loginFailures[key] = entry
}

function lockError(minutes) {
  return new HttpError(429, `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`)
}

// ---------- payloads ----------

function forPlant(line) {
  const { payment, editor, netPrice, ...rest } = line
  return rest
}

function payload(store, viewer) {
  const allowed = viewer.plant ? companiesForPlant(viewer.plant) : COMPANIES
  let lines = store.lines
    .map((line) => decorate(line, store.plantMap, store.vendorNames))
    .sort((a, b) => String(b.requisitionDate || b.poDate || '').localeCompare(String(a.requisitionDate || a.poDate || '')))
  if (viewer.plant) lines = lines.filter((line) => allowed.includes(line.company)).map(forPlant)
  const body = {
    lines,
    companies: allowed,
    plants: PLANTS.filter((plant) => allowed.includes(plant.id)),
    plant: viewer.plant || null,
    notices: store.notices.filter((notice) => !viewer.plant || allowed.includes(notice.company)),
    serverTime: new Date().toISOString(),
  }
  if (viewer.buyer) {
    body.plantMap = store.plantMap
    body.uploads = store.uploads.map(({ records, ...upload }) => ({ ...upload, replayable: Array.isArray(records) }))
    body.baselines = Object.fromEntries(Object.entries(store.baselines || {}).map(([plant, base]) => [plant, { lines: base.lines?.length || 0, at: base.at }]))
    body.passwords = store.plantPasswords
    body.plants = PLANTS
    body.companies = COMPANIES
    body.security = {
      defaultPin: !store.buyerPin?.hash && !process.env.BUYER_PIN,
      publishedPasswords: COMPANIES.filter((id) => isPublishedPassword(store.plantPasswords[id])),
      storage: process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : process.env.VERCEL ? 'temporary' : 'file',
    }
  }
  return body
}

// ---------- express ----------

const app = express()
app.set('trust proxy', true)
app.use(cors())
app.use(express.json({ limit: '12mb' }))
app.use((req, _res, next) => {
  if (!process.env.VERCEL) return next()
  const url = req.url || '/'
  if (!url.startsWith('/api')) {
    const queryAt = url.indexOf('?')
    const pathPart = queryAt === -1 ? url : url.slice(0, queryAt)
    const query = queryAt === -1 ? '' : url.slice(queryAt)
    const normalized = pathPart.startsWith('/') ? pathPart : `/${pathPart}`
    req.url = `/api${normalized === '/' ? '' : normalized}${query}`
  }
  next()
})
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

const route = (handler) => async (req, res) => {
  try {
    await handler(req, res)
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, ...error.extra })
      return
    }
    console.error(error)
    res.status(500).json({ error: 'The server could not finish that. Try again in a moment.' })
  }
}

// A buyer change: checks the session, applies the change, saves, returns the fresh board.
const buyerChange = (change) => route(async (req, res) => {
  const { store, result } = await mutate(async (current) => {
    requireBuyer(current, req)
    return change(current, req)
  })
  res.json({ ...payload(store, { buyer: true }), ...(result || {}) })
})

app.get('/api/health', route(async (_req, res) => {
  res.json({ ok: true, storage: process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : process.env.VERCEL ? 'temporary' : 'file' })
}))

app.get('/api/bootstrap', route(async (req, res) => {
  const store = await readStore()
  const viewer = viewerOf(store, req)
  if (!viewer) throw new HttpError(401, req.get('x-buyer-token') ? 'Sign in to the purchase desk again.' : 'Enter the plant password.')
  res.json(payload(store, viewer))
}))

app.post('/api/login', route(async (req, res) => {
  const key = lockKey('buyer', req)
  const { result } = await mutate(async (store) => {
    const wait = lockedFor(store, key)
    if (wait) return { error: lockError(wait) }
    if (!pinMatches(store, req.body?.pin || '')) {
      noteFailure(store, key)
      return { error: new HttpError(401, 'That PIN does not match the purchase desk.') }
    }
    delete store.loginFailures[key]
    pruneSessions(store)
    const token = crypto.randomBytes(24).toString('hex')
    store.sessions.push({ hash: hashToken(token), at: new Date().toISOString() })
    return { token }
  })
  if (result.error) throw result.error
  res.json({ token: result.token })
}))

app.post('/api/logout', route(async (req, res) => {
  const token = req.get('x-buyer-token')
  if (token) {
    const hash = hashToken(token)
    await mutate(async (store) => {
      store.sessions = store.sessions.filter((item) => item.hash !== hash)
    })
  }
  res.json({ ok: true })
}))

app.post('/api/buyer-pin', route(async (req, res) => {
  const next = String(req.body?.next || '')
  if (next.length < 6) throw new HttpError(400, 'Use at least 6 characters for the new PIN.')
  const key = lockKey('buyer', req)
  const { result } = await mutate(async (store) => {
    const viewer = requireBuyer(store, req)
    const wait = lockedFor(store, key)
    if (wait) return { error: lockError(wait) }
    if (!pinMatches(store, req.body?.current || '')) {
      noteFailure(store, key)
      return { error: new HttpError(401, 'The current PIN is not right.') }
    }
    const salt = crypto.randomBytes(16).toString('hex')
    store.buyerPin = { salt, hash: scrypt(next, salt), at: new Date().toISOString() }
    // Everyone else signed in to the desk has to use the new PIN.
    store.sessions = store.sessions.filter((item) => item.hash === viewer.hash)
    return { ok: true }
  })
  if (result.error) throw result.error
  res.json({ ok: true })
}))

app.post('/api/plant-login', route(async (req, res) => {
  const plant = req.body?.plant
  if (!COMPANIES.includes(plant)) throw new HttpError(400, 'Choose a plant link from purchase.')
  const key = lockKey(`plant:${plant}`, req)
  const { result } = await mutate(async (store) => {
    const wait = lockedFor(store, key)
    if (wait) return { error: lockError(wait) }
    if (!safeEqual(req.body?.password || '', store.plantPasswords[plant] || crypto.randomBytes(8).toString('hex'))) {
      noteFailure(store, key)
      return { error: new HttpError(401, 'That password does not match this plant.') }
    }
    delete store.loginFailures[key]
    pruneSessions(store)
    const token = crypto.randomBytes(24).toString('hex')
    store.plantSessions[hashToken(token)] = { plant, at: new Date().toISOString() }
    return { token }
  })
  if (result.error) throw result.error
  res.json({ token: result.token, plant, label: PLANTS.find((item) => item.id === plant)?.label || plant })
}))

app.post('/api/plant-logout', route(async (req, res) => {
  const token = req.get('x-plant-token')
  if (token) {
    await mutate(async (store) => {
      delete store.plantSessions[hashToken(token)]
    })
  }
  res.json({ ok: true })
}))

app.post('/api/plant-passwords', buyerChange((store, req) => {
  const next = {}
  for (const id of COMPANIES) {
    const password = String(req.body?.passwords?.[id] || '').trim()
    if (password.length < 6) throw new HttpError(400, 'Each plant password needs at least 6 characters.')
    next[id] = password
  }
  const changed = COMPANIES.filter((id) => next[id] !== store.plantPasswords[id])
  // A new password signs that plant out everywhere.
  store.plantSessions = Object.fromEntries(Object.entries(store.plantSessions).filter(([, item]) => !changed.includes(item.plant)))
  store.plantPasswords = next
  return { changed }
}))

app.post('/api/upload', buyerChange((store, req) => {
  let buffer = Buffer.from(req.body?.base64 || '', 'base64')
  if (req.body?.encoding === 'gzip') {
    try {
      buffer = zlib.gunzipSync(buffer)
    } catch {
      throw new HttpError(400, 'The file arrived damaged. Try adding it again.')
    }
  }
  if (!buffer.length) throw new HttpError(400, 'The file was empty.')
  const plant = req.body?.plant
  if (!COMPANIES.includes(plant)) throw new HttpError(400, 'Choose the plant before uploading the SAP file.')
  let parsed
  try {
    parsed = parseWorkbook(buffer)
  } catch {
    throw new HttpError(400, 'The file could not be read. Use CSV, TXT, or Excel.')
  }
  if (!parsed.report) {
    throw new HttpError(400, 'This file does not look like ME5A, ME2L, or MB51. Export the list with column headings.')
  }
  const filename = String(req.body?.filename || '').slice(0, 160)
  const before = new Map(store.lines.filter((line) => line.special).map((line) => [line.id, specialSnapshot(line)]))
  const rows = applyRecords(store, parsed.report, parsed.records, plant, { filename })
  notifyChangedSpecials(store, before)
  return { report: parsed.report, rows, filename }
}))

app.post('/api/lines', buyerChange((store, req) => {
  const body = req.body || {}
  const indentNo = asId(body.indentNo)
  const material = asId(body.material)
  if (!indentNo && !material) throw new HttpError(400, 'Enter an indent number or a material code.')
  if (!COMPANIES.includes(body.company)) throw new HttpError(400, 'Choose a plant.')
  const indentItem = asItem(body.indentItem || '10') || '10'
  const id = indentNo ? `IND-${indentNo}-${indentItem}` : `MAN-${crypto.randomBytes(4).toString('hex')}`
  if (store.lines.some((line) => line.id === id)) {
    throw new HttpError(409, 'That indent item is already on the board. Open it and update the milestones.', { id })
  }
  const now = new Date().toISOString()
  store.lines.push({
    id,
    override: {},
    receipts: {},
    companyOverride: body.company,
    plant: asId(body.plant),
    indentNo,
    indentItem: indentNo ? indentItem : '',
    material,
    shortText: String(body.shortText || '').trim().slice(0, 200),
    quantity: num(body.quantity),
    unit: String(body.unit || '').trim().slice(0, 12),
    manualPoNumber: '',
    manualVendorName: String(body.vendorName || '').trim().slice(0, 120),
    remark: '',
    sample: false,
    manual: true,
    requisitioner: String(body.requisitioner || '').trim().slice(0, 80),
    requisitionDate: now.slice(0, 10),
    createdAt: now,
    updatedAt: now,
  })
  return { id }
}))

// Saves only the fields the buyer changed, so two people editing different
// milestones (or a plant marking an item special) never undo each other.
app.post('/api/save', buyerChange((store, req) => {
  const { id, ...fields } = req.body || {}
  const line = store.lines.find((item) => item.id === id)
  if (!line) throw new HttpError(404, 'That material is no longer on the board. Refresh and try again.')
  applyEditor(line, fields, store.plantMap)
  if (line.special) {
    pushNotice(store, { lineId: line.id, company: companyOf(line, store.plantMap), text: `Purchase updated ${lineLabel(line)}.` })
  }
  return { id }
}))

app.post('/api/bulk', buyerChange((store, req) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
  const step = req.body?.step
  if (!ids.length) throw new HttpError(400, 'Select at least one line.')
  if (!STEP_KEYS.includes(step)) throw new HttpError(400, 'Choose a milestone.')
  const patch = stepPatch(step, req.body?.done !== false, req.body?.date)
  const wanted = new Set(ids)
  let updated = 0
  for (const line of store.lines) {
    if (!wanted.has(line.id)) continue
    applyEditor(line, patch, store.plantMap)
    updated += 1
    if (line.special) {
      pushNotice(store, { lineId: line.id, company: companyOf(line, store.plantMap), text: `Purchase updated ${lineLabel(line)}.` })
    }
  }
  if (!updated) throw new HttpError(404, 'Those lines are no longer on the board.')
  return { updated }
}))

app.post('/api/remove', buyerChange((store, req) => {
  const before = store.lines.length
  store.lines = store.lines.filter((item) => item.id !== req.body?.id)
  if (store.lines.length === before) throw new HttpError(404, 'That material is no longer on the board.')
  return { removedId: req.body.id }
}))

app.post('/api/special', route(async (req, res) => {
  const { store, result } = await mutate(async (current) => {
    const viewer = viewerOf(current, req)
    if (!viewer) throw new HttpError(401, 'Sign in before marking a special item.')
    const origin = current.lines.find((item) => item.id === req.body?.id)
    if (!origin) throw new HttpError(404, 'That material is no longer on the board.')
    const allowed = viewer.buyer ? COMPANIES : companiesForPlant(viewer.plant)
    const scope = ['indent', 'po'].includes(req.body?.scope) ? req.body.scope : 'item'
    let targets = [origin]
    if (scope === 'indent' && origin.indentNo) targets = current.lines.filter((item) => item.indentNo === origin.indentNo)
    if (scope === 'po') {
      const po = origin.poNumber || origin.manualPoNumber
      if (po) targets = current.lines.filter((item) => (item.poNumber || item.manualPoNumber) === po)
    }
    targets = targets.filter((item) => allowed.includes(companyOf(item, current.plantMap)))
    if (!targets.length) throw new HttpError(403, 'That item is outside this plant.')
    const on = Boolean(req.body?.on)
    const note = String(req.body?.note || '').trim().slice(0, 240)
    const by = viewer.buyer ? 'buyer' : 'plant'
    const at = new Date().toISOString()
    for (const item of targets) item.special = on ? { by, note, at } : null
    const who = by === 'buyer' ? 'Purchase' : 'The plant'
    const label = targets.length > 1
      ? `${targets.length} items on ${scope === 'po' ? `PO ${origin.poNumber || origin.manualPoNumber}` : `indent ${origin.indentNo}`}`
      : lineLabel(origin)
    pushNotice(current, {
      lineId: origin.id,
      company: companyOf(origin, current.plantMap),
      text: `${who} ${on ? 'asked for special effort on' : 'cleared special effort on'} ${label}.${note ? ` ${note}` : ''}`,
    })
    return { viewer }
  })
  res.json(payload(store, result.viewer.buyer ? { buyer: true } : { plant: result.viewer.plant }))
}))

app.post('/api/upload-remove', buyerChange((store, req) => {
  const removed = removeUpload(store, String(req.body?.id || ''))
  if (!removed) throw new HttpError(404, 'That upload is no longer in the list.')
  return { removed: removed.report, removedFile: removed.filename || '', plant: removed.plant, rebuilt: Boolean(removed.rebuilt) }
}))

app.post('/api/upload-clear', buyerChange((store, req) => {
  if (!clearPlantUploads(store, req.body?.plant)) throw new HttpError(400, 'Choose the plant whose files should be removed.')
  return { cleared: req.body.plant }
}))

app.put('/api/plant-map', buyerChange((store, req) => {
  const next = {}
  for (const [plant, company] of Object.entries(req.body?.plantMap || {})) {
    const key = String(plant).trim()
    if (key && COMPANIES.includes(company)) next[key] = company
  }
  if (!Object.keys(next).length) throw new HttpError(400, 'Keep at least one plant mapped to a unit.')
  store.plantMap = next
}))

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown request.' })
})

app.use(express.static(distDir))
app.use((req, res, next) => {
  if (req.method !== 'GET') return next()
  const indexFile = path.join(distDir, 'index.html')
  if (fs.existsSync(indexFile)) res.sendFile(indexFile)
  else res.status(404).type('text').send('Open the Vite site while developing: http://localhost:5173')
})

// Bodies that are too large or not JSON land here instead of Express's HTML error page.
app.use((error, _req, res, _next) => {
  if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: 'That file is too large to send. Export fewer rows or save it as CSV.' })
    return
  }
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request could not be read.' })
    return
  }
  console.error(error)
  res.status(500).json({ error: 'The server could not finish that.' })
})

export default app
