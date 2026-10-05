import cors from 'cors'
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  COMPANIES,
  applyEditor,
  applyRecords,
  asId,
  createDemoStore,
  decorate,
  normalizeStore,
  num,
  parseWorkbook,
} from './logic.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, '..', 'data')
const storePath = path.join(dataDir, 'store.json')
const distDir = path.join(__dirname, '..', 'dist')
const PIN = process.env.BUYER_PIN || 'buyer123'
const PORT = Number(process.env.PORT || 8787)

function save(store) {
  fs.mkdirSync(dataDir, { recursive: true })
  const copy = { ...store, sessions: store.sessions.slice(-30) }
  fs.writeFileSync(storePath, JSON.stringify(copy, null, 2))
}

function load() {
  try {
    if (fs.existsSync(storePath)) return normalizeStore(JSON.parse(fs.readFileSync(storePath, 'utf8')))
  } catch (error) {
    console.error('Store could not be read, starting from sample data.', error)
  }
  const demo = createDemoStore()
  save(demo)
  return demo
}

const store = load()

function payload() {
  const lines = store.lines
    .map((line) => decorate(line, store.plantMap, store.vendorNames))
    .sort((a, b) => String(b.requisitionDate || b.poDate || '').localeCompare(String(a.requisitionDate || a.poDate || '')))
  return { lines, plantMap: store.plantMap, uploads: store.uploads, companies: COMPANIES }
}

function buyer(req, res, next) {
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
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

app.get('/api/bootstrap', (req, res) => {
  res.json(payload())
})

app.post('/api/login', (req, res) => {
  if (!safeEqual(req.body?.pin || '', PIN)) {
    res.status(401).json({ error: 'That PIN does not match the purchase desk.' })
    return
  }
  const token = crypto.randomBytes(24).toString('hex')
  store.sessions.push(token)
  store.sessions = store.sessions.slice(-30)
  save(store)
  res.json({ token })
})

app.post('/api/logout', buyer, (req, res) => {
  const token = req.get('x-buyer-token')
  store.sessions = store.sessions.filter((item) => item !== token)
  save(store)
  res.json({ ok: true })
})

app.post('/api/upload', buyer, (req, res) => {
  try {
    const buffer = Buffer.from(req.body?.base64 || '', 'base64')
    if (!buffer.length) {
      res.status(400).json({ error: 'The file was empty.' })
      return
    }
    const parsed = parseWorkbook(buffer)
    if (!parsed.report) {
      res.status(400).json({
        error: 'This file does not look like ME5A, ME2L, or MB51. Export the list with column headings.',
      })
      return
    }
    const rows = applyRecords(store, parsed.report, parsed.records)
    save(store)
    res.json({ report: parsed.report, rows, filename: req.body?.filename || '', ...payload() })
  } catch (error) {
    console.error(error)
    res.status(400).json({ error: 'The file could not be read. Use CSV or Excel.' })
  }
})

app.post('/api/lines', buyer, (req, res) => {
  const body = req.body || {}
  const indentNo = asId(body.indentNo)
  const material = asId(body.material)
  if (!indentNo && !material) {
    res.status(400).json({ error: 'Enter an indent number or a material code.' })
    return
  }
  if (!COMPANIES.includes(body.company)) {
    res.status(400).json({ error: 'Choose TPL, TCL-JDM, or TCL-JDCL.' })
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
    requisitioner: String(body.requisitioner || '').trim(),
    requisitionDate: new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  store.lines.push(line)
  save(store)
  res.json({ line: decorate(line, store.plantMap, store.vendorNames) })
})

app.put('/api/lines/:id', buyer, (req, res) => {
  const line = store.lines.find((item) => item.id === req.params.id)
  if (!line) {
    res.status(404).json({ error: 'That material is no longer on the board.' })
    return
  }
  applyEditor(line, req.body || {})
  save(store)
  res.json({ line: decorate(line, store.plantMap, store.vendorNames) })
})

app.delete('/api/lines/:id', buyer, (req, res) => {
  const before = store.lines.length
  store.lines = store.lines.filter((item) => item.id !== req.params.id)
  if (store.lines.length === before) {
    res.status(404).json({ error: 'That material is no longer on the board.' })
    return
  }
  save(store)
  res.json(payload())
})

app.put('/api/plant-map', buyer, (req, res) => {
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
  save(store)
  res.json(payload())
})

app.use(express.static(distDir))
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
  const indexFile = path.join(distDir, 'index.html')
  if (fs.existsSync(indexFile)) res.sendFile(indexFile)
  else res.status(404).type('text').send('Open the Vite site while developing: http://localhost:5173')
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Material Tracking API on http://localhost:${PORT}`)
})
