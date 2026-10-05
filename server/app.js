import cors from 'cors'
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  COMPANIES,
  PLANTS,
  applyEditor,
  applyRecords,
  clearPlantUploads,
  removeUpload,
  asId,
  companiesForPlant,
  decorate,
  lineFromView,
  num,
  parseWorkbook,
} from './logic.js'
import { readStore, writeStore } from './persist.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist')
const PIN = process.env.BUYER_PIN || 'buyer123'

let store = null

function payload(viewer = { buyer: true }) {
  let lines = store.lines
    .map((line) => decorate(line, store.plantMap, store.vendorNames))
    .sort((a, b) => String(b.requisitionDate || b.poDate || '').localeCompare(String(a.requisitionDate || a.poDate || '')))
  const allowed = viewer.plant ? companiesForPlant(viewer.plant) : COMPANIES
  if (viewer.plant) lines = lines.filter((line) => allowed.includes(line.company))
  const body = {
    lines,
    companies: allowed,
    plants: PLANTS.filter((plant) => allowed.includes(plant.id)),
    plant: viewer.plant || null,
  }
  if (viewer.buyer) {
    body.plantMap = store.plantMap
    body.uploads = store.uploads.map(({ records, ...upload }) => upload)
    body.passwords = store.plantPasswords
    body.plants = PLANTS
    body.companies = COMPANIES
  }
  return body
}

async function buyer(req, res, next) {
  try {
    store = await readStore()
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'The material list could not be loaded.' })
    return
  }
  const token = req.get('x-buyer-token')
  if (!token || !store.sessions.includes(token)) {
    res.status(401).json({ error: 'Sign in to the purchase desk again.' })
    return
  }
  next()
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '40mb' }))
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
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

app.get('/api/bootstrap', async (req, res) => {
  try {
    store = await readStore()
    const buyerToken = req.get('x-buyer-token')
    if (buyerToken && store.sessions.includes(buyerToken)) {
      res.json(payload({ buyer: true }))
      return
    }
    const plant = store.plantSessions?.[req.get('x-plant-token')]
    if (!plant || !COMPANIES.includes(plant)) {
      res.status(401).json({ error: 'Enter the plant password.' })
      return
    }
    res.json(payload({ plant }))
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'The material list could not be loaded.' })
  }
})

app.post('/api/plant-login', async (req, res) => {
  const plant = req.body?.plant
  if (!COMPANIES.includes(plant)) {
    res.status(400).json({ error: 'Choose a plant link from purchase.' })
    return
  }
  try {
    store = await readStore()
    if (!safeEqual(req.body?.password || '', store.plantPasswords[plant] || '')) {
      res.status(401).json({ error: 'That password does not match this plant.' })
      return
    }
    const token = crypto.randomBytes(24).toString('hex')
    const sessions = Object.entries(store.plantSessions || {}).slice(-80)
    store.plantSessions = Object.fromEntries(sessions)
    store.plantSessions[token] = plant
    await writeStore(store)
    res.json({ token, plant, label: PLANTS.find((item) => item.id === plant)?.label || plant })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'The plant link could not be opened.' })
  }
})

app.post('/api/plant-passwords', buyer, async (req, res) => {
  const next = {}
  for (const id of COMPANIES) {
    const password = String(req.body?.passwords?.[id] || '').trim()
    if (password.length < 4) {
      res.status(400).json({ error: 'Each plant password needs at least 4 characters.' })
      return
    }
    next[id] = password
  }
  store.plantPasswords = next
  await writeStore(store)
  res.json(payload({ buyer: true }))
})

app.post('/api/login', async (req, res) => {
  if (!safeEqual(req.body?.pin || '', PIN)) {
    res.status(401).json({ error: 'That PIN does not match the purchase desk.' })
    return
  }
  try {
    store = await readStore()
    const token = crypto.randomBytes(24).toString('hex')
    store.sessions.push(token)
    store.sessions = store.sessions.slice(-30)
    await writeStore(store)
    res.json({ token })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'The purchase desk could not sign you in.' })
  }
})

app.post('/api/logout', buyer, async (req, res) => {
  const token = req.get('x-buyer-token')
  store.sessions = store.sessions.filter((item) => item !== token)
  await writeStore(store)
  res.json({ ok: true })
})

app.post('/api/upload', buyer, async (req, res) => {
  try {
    const buffer = Buffer.from(req.body?.base64 || '', 'base64')
    if (!buffer.length) {
      res.status(400).json({ error: 'The file was empty.' })
      return
    }
    const plant = req.body?.plant
    if (!COMPANIES.includes(plant)) {
      res.status(400).json({ error: 'Choose the plant before uploading the SAP file.' })
      return
    }
    const parsed = parseWorkbook(buffer)
    if (!parsed.report) {
      res.status(400).json({
        error: 'This file does not look like ME5A, ME2L, or MB51. Export the list with column headings.',
      })
      return
    }
    const rows = applyRecords(store, parsed.report, parsed.records, plant, { filename: req.body?.filename || '' })
    await writeStore(store)
    res.json({ report: parsed.report, rows, filename: req.body?.filename || '', ...payload() })
  } catch (error) {
    console.error(error)
    res.status(400).json({ error: 'The file could not be read. Use CSV or Excel.' })
  }
})

app.post('/api/lines', buyer, async (req, res) => {
  const body = req.body || {}
  const indentNo = asId(body.indentNo)
  const material = asId(body.material)
  if (!indentNo && !material) {
    res.status(400).json({ error: 'Enter an indent number or a material code.' })
    return
  }
  if (!COMPANIES.includes(body.company)) {
    res.status(400).json({ error: 'Choose a plant.' })
    return
  }
  const indentItem = asId(body.indentItem || '10') || '10'
  const id = indentNo ? `IND-${indentNo}-${indentItem}` : `MAN-${crypto.randomBytes(4).toString('hex')}`
  if (store.lines.some((line) => line.id === id)) {
    res.status(409).json({ error: 'That indent item is already on the board. Open it and update the milestones.' })
    return
  }
  const line = {
    id,
    override: {},
    receipts: {},
    companyOverride: body.company,
    plant: asId(body.plant),
    indentNo,
    indentItem: indentNo ? indentItem : '',
    material,
    shortText: String(body.shortText || '').trim(),
    quantity: num(body.quantity),
    unit: String(body.unit || '').trim(),
    manualPoNumber: '',
    manualVendorName: String(body.vendorName || '').trim(),
    remark: '',
    sample: false,
    manual: true,
    requisitioner: String(body.requisitioner || '').trim(),
    requisitionDate: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  store.lines.push(line)
  await writeStore(store)
  res.json({ line: decorate(line, store.plantMap, store.vendorNames) })
})

app.put('/api/lines/:id', buyer, async (req, res) => {
  const line = store.lines.find((item) => item.id === req.params.id)
  if (!line) {
    res.status(404).json({ error: 'That material is no longer on the board.' })
    return
  }
  applyEditor(line, req.body || {})
  await writeStore(store)
  res.json({ line: decorate(line, store.plantMap, store.vendorNames) })
})

app.delete('/api/lines/:id', buyer, async (req, res) => {
  const before = store.lines.length
  store.lines = store.lines.filter((item) => item.id !== req.params.id)
  if (store.lines.length === before) {
    res.status(404).json({ error: 'That material is no longer on the board.' })
    return
  }
  await writeStore(store)
  res.json(payload())
})

app.post('/api/save', buyer, async (req, res) => {
  try {
    if (Array.isArray(req.body?.board) && req.body.board.length) {
      const incoming = req.body.board.map(lineFromView).filter(Boolean)
      const merged = new Map(store.lines.filter((line) => !line.sample).map((line) => [line.id, line]))
      incoming.forEach((line) => merged.set(line.id, line))
      store.lines = [...merged.values()]
    }
    const line = store.lines.find((item) => item.id === req.body?.id)
    if (!line) {
      res.status(404).json({ error: 'That material is no longer on the board. Upload the SAP report again, then save.' })
      return
    }
    applyEditor(line, req.body || {})
    await writeStore(store)
    res.json({ line: decorate(line, store.plantMap, store.vendorNames), ...payload() })
  } catch (error) {
    console.error(error)
    res.status(500).json({ error: 'The purchase desk could not save that change.' })
  }
})

app.post('/api/upload-remove', buyer, async (req, res) => {
  const removed = removeUpload(store, String(req.body?.id || ''))
  if (!removed) {
    res.status(404).json({ error: 'That upload is no longer in the list.' })
    return
  }
  await writeStore(store)
  res.json({
    ...payload(),
    removed: removed.report,
    plant: removed.plant,
    rebuilt: Boolean(removed.rebuilt),
  })
})

app.post('/api/upload-clear', buyer, async (req, res) => {
  const plant = req.body?.plant
  if (!clearPlantUploads(store, plant)) {
    res.status(400).json({ error: 'Choose the plant whose files should be removed.' })
    return
  }
  await writeStore(store)
  res.json(payload())
})

app.post('/api/remove', buyer, async (req, res) => {
  const before = store.lines.length
  store.lines = store.lines.filter((item) => item.id !== req.body?.id)
  if (store.lines.length === before) {
    res.status(404).json({ error: 'That material is no longer on the board.' })
    return
  }
  await writeStore(store)
  res.json(payload())
})

app.put('/api/plant-map', buyer, async (req, res) => {
  const next = {}
  for (const [plant, company] of Object.entries(req.body?.plantMap || {})) {
    const key = String(plant).trim()
    if (key && COMPANIES.includes(company)) next[key] = company
  }
  if (!Object.keys(next).length) {
    res.status(400).json({ error: 'Keep at least one plant mapped to a unit.' })
    return
  }
  store.plantMap = next
  await writeStore(store)
  res.json(payload())
})

app.use(express.static(distDir))
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
  const indexFile = path.join(distDir, 'index.html')
  if (fs.existsSync(indexFile)) res.sendFile(indexFile)
  else res.status(404).type('text').send('Open the Vite site while developing: http://localhost:5173')
})

export default app
