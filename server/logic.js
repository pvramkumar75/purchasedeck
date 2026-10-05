import crypto from 'crypto'
import * as xlsx from 'xlsx'
import { RECEIPT_MOVES, REVERSAL_MOVES, asId, asItem, parseWorkbook as parseBytes, text, toISO } from '../shared/parse.js'

export const PLANTS = [
  { id: 'TPL', label: 'TPL' },
  { id: 'TCL-JDM', label: 'TCL-JDM' },
  { id: 'TCL-JDCL', label: 'TCL-JDCL' },
  { id: 'TCL', label: 'TCL (JDM+JDCL)' },
]
export const COMPANIES = PLANTS.map((plant) => plant.id)
export const STEP_KEYS = ['orderPlaced', 'ready', 'transit', 'hyderabad', 'receipt', 'unloaded']
// Passwords that shipped in earlier public builds. Still accepted if a store holds them,
// but the purchase desk warns until they are replaced.
const PUBLISHED_PASSWORDS = new Set(['TPL-5104', 'JDM-8261', 'JDCL-3479', 'TCL-6928'])
const KEEP_FILES_PER_PLANT = 12
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function randomPassword(prefix = '') {
  const bytes = crypto.randomBytes(8)
  let out = ''
  for (const byte of bytes) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]
  return `${prefix ? `${prefix}-` : ''}${out.slice(0, 4)}-${out.slice(4)}`
}

export function isPublishedPassword(value) {
  return PUBLISHED_PASSWORDS.has(String(value || ''))
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

export function companiesForPlant(plantId) {
  if (plantId === 'TCL') return ['TCL-JDM', 'TCL-JDCL', 'TCL']
  return [plantId]
}

const DEFAULT_PLANTS = {
  '1100': 'TPL',
  '1200': 'TCL-JDM',
  '1300': 'TCL-JDCL',
}

export { asId, asItem, decodeText, norm, num, parseMatrix, toISO } from '../shared/parse.js'

export function parseWorkbook(buffer) {
  return parseBytes(buffer, xlsx)
}


function blankLine(id) {
  return {
    id,
    override: {},
    receipts: {},
    companyOverride: '',
    manualPoNumber: '',
    manualVendorName: '',
    remark: '',
    sample: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function fill(line, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue
    line[key] = value
  }
  line.sample = false
  line.updatedAt = new Date().toISOString()
}

export function companyOf(line, plantMap = {}) {
  return line.unitOverride || line.companyOverride || plantMap[String(line.plant || '')] || 'Unassigned'
}

// The plant whose SAP files produced this line. Older stores only kept companyOverride.
function sourceOf(line) {
  return line.source || line.companyOverride || ''
}

const poKey = (po, item) => `${po}|${item || ''}`
// MB51 receipts for POs not on the board yet are held this long for a later ME2L.
const PENDING_DAYS = 120
const PENDING_MAX = 20000

function isReplayable(upload) {
  return Array.isArray(upload.records) || Boolean(upload.stored)
}

function recordsOf(upload, recordsById) {
  return Array.isArray(upload.records) ? upload.records : recordsById?.[upload.id] || null
}

// Oldest first. The log is kept newest-first, so reverse before the (stable) sort
// to keep files uploaded in the same millisecond in their real order.
function replayableFiles(store, plant) {
  return [...store.uploads]
    .reverse()
    .filter((upload) => upload.plant === plant && isReplayable(upload))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
}

// Files whose rows are kept outside the board and are needed to rebuild a plant.
export function storedFileIds(store, plant) {
  return replayableFiles(store, plant).filter((upload) => !Array.isArray(upload.records)).map((upload) => upload.id)
}

// Files that adding one more upload for this plant will fold into the baseline.
export function filesToFold(store, plant) {
  const files = replayableFiles(store, plant)
  const extra = files.length + 1 - KEEP_FILES_PER_PLANT
  return extra > 0 ? files.slice(0, extra).filter((upload) => !Array.isArray(upload.records)).map((upload) => upload.id) : []
}

export function applyRecords(store, report, records, company, options = {}) {
  const stats = options.stats || {}
  stats.matched = 0
  stats.held = 0
  stats.skipped = 0
  const tag = (line) => {
    if (company && COMPANIES.includes(company)) {
      line.companyOverride = company
      line.source = company
    }
    return line
  }
  if (store.lines.some((line) => line.sample)) {
    store.lines = store.lines.filter((line) => !line.sample)
    store.vendorNames = {}
  }
  store.pendingReceipts ||= {}

  // Lookup tables so large files stay fast (no scanning the board per row).
  const byId = new Map(store.lines.map((line) => [line.id, line]))
  const byPo = new Map()
  const byIndentMaterial = new Map()
  const index = (line) => {
    if (line.poNumber && !byPo.has(poKey(line.poNumber, line.poItem))) byPo.set(poKey(line.poNumber, line.poItem), line)
    if (line.indentNo && line.material && !byIndentMaterial.has(`${line.indentNo}|${line.material}`)) {
      byIndentMaterial.set(`${line.indentNo}|${line.material}`, line)
    }
  }
  store.lines.forEach(index)
  const removed = new Set()
  const ensure = (id) => {
    let line = byId.get(id)
    if (!line) {
      line = blankLine(id)
      store.lines.push(line)
      byId.set(id, line)
    }
    return line
  }
  // A PO line that just appeared picks up receipts MB51 delivered before it existed.
  const claimPending = (line) => {
    if (!line.poNumber) return
    const key = poKey(line.poNumber, line.poItem)
    const held = store.pendingReceipts[key]
    if (!held) return
    line.receipts = { ...held.receipts, ...line.receipts }
    delete store.pendingReceipts[key]
  }

  let count = 0
  if (report === 'ME5A') {
    for (const record of records) {
      if (!record.indentNo && !record.material) continue
      const id = record.indentNo ? `IND-${record.indentNo}-${record.indentItem || '0'}` : `MAT-${record.material}`
      const line = ensure(id)
      fill(line, record)
      tag(line)
      index(line)
      count += 1
    }
  }
  if (report === 'ME2L') {
    for (const record of records) {
      if (!record.poNumber && !record.indentNo) continue
      let id = record.indentNo
        ? `IND-${record.indentNo}-${record.indentItem || '0'}`
        : `PO-${record.poNumber}-${record.poItem || '0'}`
      if (record.indentNo && (!record.indentItem || record.indentItem === '0') && record.material) {
        const match = byIndentMaterial.get(`${record.indentNo}|${record.material}`)
        if (match && !removed.has(match)) id = match.id
      }
      const found = record.poNumber ? byPo.get(poKey(record.poNumber, record.poItem)) : null
      const existing = found && found.id !== id && !removed.has(found) ? found : null
      if (existing && record.indentNo) {
        const indentLine = byId.get(id)
        if (!indentLine) {
          byId.delete(existing.id)
          existing.id = id
          byId.set(id, existing)
        } else {
          indentLine.receipts = { ...existing.receipts, ...indentLine.receipts }
          indentLine.override = { ...existing.override, ...indentLine.override }
          removed.add(existing)
          byId.delete(existing.id)
          byPo.set(poKey(record.poNumber, record.poItem), indentLine)
        }
      }
      const line = ensure(id)
      fill(line, record)
      tag(line)
      index(line)
      claimPending(line)
      if (record.vendor && record.vendorName) store.vendorNames[record.vendor] = record.vendorName
      count += 1
    }
  }
  if (report === 'MB51') {
    const cutoff = new Date(Date.now() - PENDING_DAYS * 86400000).toISOString().slice(0, 10)
    let pendingCount = Object.keys(store.pendingReceipts).length
    for (const record of records) {
      if (!record.matDoc) continue
      const movement = String(record.movement || '')
      const reversal = REVERSAL_MOVES.has(movement)
      const receipt = RECEIPT_MOVES.has(movement)
      // Issues, transfers and other movements are not receipts.
      if (!reversal && !receipt) continue
      const magnitude = Math.abs(Number(record.quantity || 0))
      const entry = { qty: reversal ? -magnitude : magnitude, date: record.postingDate, movement }
      const line = record.poNumber ? byPo.get(poKey(record.poNumber, record.poItem)) : null
      if (!line || removed.has(line)) {
        // Only lines already on the board get receipts; a full MB51 must not flood
        // the board with old POs. Recent ones wait for an ME2L that adds the PO.
        const key = poKey(record.poNumber, record.poItem)
        const recent = !record.postingDate || record.postingDate >= cutoff
        if (record.poNumber && recent && (store.pendingReceipts[key] || pendingCount < PENDING_MAX)) {
          if (!store.pendingReceipts[key]) {
            store.pendingReceipts[key] = { plant: company || '', receipts: {} }
            pendingCount += 1
          }
          store.pendingReceipts[key].receipts[record.matDoc] = entry
          stats.held += 1
        } else stats.skipped += 1
        continue
      }
      line.receipts[record.matDoc] = entry
      if (!line.vendorName && record.vendor && store.vendorNames[record.vendor]) {
        line.vendorName = store.vendorNames[record.vendor]
      }
      line.sample = false
      line.updatedAt = new Date().toISOString()
      tag(line)
      stats.matched += 1
      count += 1
    }
  }
  if (removed.size) store.lines = store.lines.filter((line) => !removed.has(line))
  if (options.log !== false) {
    const upload = {
      id: options.id || crypto.randomBytes(8).toString('hex'),
      report,
      rows: count,
      plant: company || '',
      filename: options.filename || '',
      at: new Date().toISOString(),
      ...(report === 'MB51' ? { held: stats.held, skipped: stats.skipped } : {}),
    }
    // Rows live outside the board when the storage can hold them separately.
    if (options.stored) upload.stored = true
    else upload.records = records
    store.uploads.unshift(upload)
    stats.folded = foldOldUploads(store, company, options.recordsById)
  }
  return count
}

// Only the newest files per plant keep their rows. Older files are folded, in upload
// order, into a per-plant baseline so removing a recent file never drops their lines.
// Returns the ids of folded files whose rows were stored separately.
function foldOldUploads(store, plant, recordsById) {
  store.baselines ||= {}
  const folded = []
  const files = replayableFiles(store, plant)
  const extra = files.length - KEEP_FILES_PER_PLANT
  if (extra > 0 && plant) {
    const oldest = files.slice(0, extra).filter((file) => recordsOf(file, recordsById))
    if (oldest.length) {
      const previous = store.baselines[plant] || {}
      const base = { lines: previous.lines || [], pendingReceipts: { ...(previous.pending || {}) }, vendorNames: store.vendorNames, uploads: [] }
      for (const file of oldest) applyRecords(base, file.report, recordsOf(file, recordsById), plant, { log: false })
      store.baselines[plant] = { lines: base.lines.map(baselineCopy), pending: base.pendingReceipts, at: new Date().toISOString() }
      const gone = new Set(oldest.map((file) => file.id))
      store.uploads = store.uploads.filter((upload) => !gone.has(upload.id))
      for (const file of oldest) if (file.stored) folded.push(file.id)
    }
  }
  const legacy = store.uploads.filter((upload) => !isReplayable(upload))
  if (legacy.length > 30) {
    const drop = new Set(legacy.slice(30).map((upload) => upload.id))
    store.uploads = store.uploads.filter((upload) => !drop.has(upload.id))
  }
  return folded
}

function baselineCopy(line) {
  const { override, remark, manualPoNumber, manualVendorName, special, unitOverride, ...sap } = line
  return { ...sap, override: {}, receipts: { ...(line.receipts || {}) } }
}

function keptEdits(line) {
  return {
    override: line.override || {},
    remark: line.remark || '',
    manualPoNumber: line.manualPoNumber || '',
    manualVendorName: line.manualVendorName || '',
    special: line.special || null,
    unitOverride: line.unitOverride || '',
  }
}

function rebuildPlant(store, plant, recordsById) {
  const files = replayableFiles(store, plant)
  // Never rebuild from a partial set of files: that would silently drop lines.
  const missing = files.filter((file) => !recordsOf(file, recordsById))
  if (missing.length) throw new Error(`Rows for ${missing.length} file(s) could not be loaded; nothing was changed.`)
  const edits = new Map()
  for (const line of store.lines) {
    if (!line.manual && sourceOf(line) === plant) edits.set(line.id, keptEdits(line))
  }
  store.lines = store.lines.filter((line) => line.manual || sourceOf(line) !== plant)
  store.pendingReceipts = Object.fromEntries(Object.entries(store.pendingReceipts || {}).filter(([, held]) => held.plant !== plant))
  const baseline = store.baselines?.[plant] || {}
  store.lines.push(...(baseline.lines || []).map((line) => JSON.parse(JSON.stringify(line))))
  Object.assign(store.pendingReceipts, JSON.parse(JSON.stringify(baseline.pending || {})))
  for (const file of files) applyRecords(store, file.report, recordsOf(file, recordsById), plant, { log: false })
  for (const line of store.lines) {
    const saved = edits.get(line.id)
    if (!saved) continue
    line.override = saved.override
    if (saved.remark) line.remark = saved.remark
    if (saved.manualPoNumber) line.manualPoNumber = saved.manualPoNumber
    if (saved.manualVendorName) line.manualVendorName = saved.manualVendorName
    if (saved.special) line.special = saved.special
    if (saved.unitOverride) line.unitOverride = saved.unitOverride
  }
}


export function lineLabel(line) {
  const name = line.shortText || line.material || 'Material'
  const ref = line.poNumber ? `PO ${line.poNumber}` : line.indentNo ? `indent ${line.indentNo}` : ''
  return ref ? `${name} (${ref})` : name
}

export function pushNotice(store, notice) {
  store.notices ||= []
  store.notices.unshift({
    id: crypto.randomBytes(6).toString('hex'),
    at: new Date().toISOString(),
    lineId: notice.lineId || '',
    company: notice.company || '',
    text: notice.text,
  })
  store.notices = store.notices.slice(0, 40)
}

export function specialSnapshot(line) {
  return JSON.stringify([line.poNumber, line.openQty, line.orderQty, line.receipts, line.override, line.vendorName, line.poDate])
}

export function notifyChangedSpecials(store, before) {
  const changed = store.lines.filter((line) => line.special && before.has(line.id) && before.get(line.id) !== specialSnapshot(line))
  const groups = new Map()
  for (const line of changed) {
    const company = companyOf(line, store.plantMap)
    if (!groups.has(company)) groups.set(company, [])
    groups.get(company).push(line)
  }
  for (const [company, lines] of groups) {
    const names = lines.slice(0, 4).map((line) => line.shortText || line.material).join(', ')
    const extra = lines.length > 4 ? ` and ${lines.length - 4} more` : ''
    pushNotice(store, {
      company,
      lineId: lines[0].id,
      text: `SAP update on special ${lines.length === 1 ? 'item' : 'items'}: ${names}${extra}.`,
    })
  }
}

// `recordsById` holds the rows of files stored outside the board (see storedFileIds).
export function removeUpload(store, uploadId, recordsById) {
  const upload = store.uploads.find((item) => item.id === uploadId)
  if (!upload) return null
  const plant = upload.plant
  const hadRows = isReplayable(upload)
  if (hadRows) {
    store.uploads = store.uploads.filter((item) => item.id !== uploadId)
  } else if (plant) {
    store.uploads = store.uploads.filter((item) => item.plant !== plant || (item.id !== uploadId && isReplayable(item)))
  } else {
    store.uploads = store.uploads.filter((item) => item.id !== uploadId)
  }
  if (plant && COMPANIES.includes(plant)) rebuildPlant(store, plant, recordsById)
  return { ...upload, records: undefined, rebuilt: hadRows }
}

// Returns the ids of the plant's separately stored files, which can then be deleted.
export function clearPlantUploads(store, plant) {
  if (!COMPANIES.includes(plant)) return null
  const dropped = store.uploads.filter((item) => item.plant === plant && item.stored).map((item) => item.id)
  store.uploads = store.uploads.filter((item) => item.plant !== plant)
  if (store.baselines) delete store.baselines[plant]
  rebuildPlant(store, plant, {})
  return dropped
}


export function receivedQty(line) {
  return Object.values(line.receipts || {}).reduce((sum, row) => sum + Number(row.qty || 0), 0)
}

export function receiptDateOf(line) {
  const rows = Object.values(line.receipts || {}).filter((row) => row.qty > 0 && row.date)
  rows.sort((a, b) => (a.date < b.date ? 1 : -1))
  return rows[0]?.date || null
}

function autoReceipt(line, poNumber) {
  if (poNumber && line.openQty != null) return Number(line.openQty) <= 0
  if (line.orderQty != null && Number(line.orderQty) > 0) return receivedQty(line) + 0.0001 >= Number(line.orderQty)
  return false
}

export function decorate(line, plantMap, vendorNames = {}) {
  const received = receivedQty(line)
  const sapReceipt = receiptDateOf(line)
  const poNumber = line.poNumber || line.manualPoNumber || ''
  const vendorName = line.vendorName || line.manualVendorName || (line.vendor && vendorNames[line.vendor]) || ''
  const override = line.override || {}
  const orderAuto = Boolean(line.poNumber || line.manualPoNumber)
  const receiptAuto = autoReceipt(line, poNumber)
  const flagged = (key, legacy, auto = false) => {
    if (typeof override[key] === 'boolean') return override[key]
    if (legacy && typeof override[legacy] === 'boolean') return override[legacy]
    return auto
  }
  const dated = (key, legacy, fallback = null) => override[key] || (legacy && override[legacy]) || fallback || null
  const flags = {
    orderPlaced: flagged('orderPlacedDone', 'poMadeDone', orderAuto),
    ready: flagged('readyDone', 'readinessDone'),
    transit: flagged('transitDone', 'etdDone'),
    hyderabad: flagged('hyderabadDone', typeof override.expectedArrivalDone === 'boolean' ? 'expectedArrivalDone' : 'etaDone'),
    receipt: flagged('receiptDone', '', receiptAuto),
    unloaded: flagged('unloadedDone', ''),
  }
  const dates = {
    indent: line.requisitionDate || null,
    expectedPo: override.expectedPoDate || null,
    orderPlaced: dated('orderPlacedDate', 'poMadeDate', line.poDate),
    ready: dated('readyDate', 'readinessDate'),
    transit: dated('transitDate', 'etdDate'),
    hyderabad: dated('hyderabadDate', 'expectedArrivalDate', override.etaDate),
    receipt: dated('receiptDate', '', sapReceipt),
    unloaded: dated('unloadedDate', ''),
    sapDelivery: line.poDelivery || line.indentDelivery || null,
  }
  const company = companyOf(line, plantMap)
  const defs = [
    ['orderPlaced', 'Order placed', 'Ordered', flags.orderPlaced, dates.orderPlaced],
    ['ready', 'Ready for dispatch', 'Ready', flags.ready, dates.ready],
    ['transit', 'In transit', 'Transit', flags.transit, dates.transit],
    ['hyderabad', 'Arrived at Hyderabad', 'Hyderabad', flags.hyderabad, dates.hyderabad],
    ['receipt', 'Received at factory', 'Factory', flags.receipt, dates.receipt],
    ['unloaded', 'Unloaded', 'Unloaded', flags.unloaded, dates.unloaded],
  ]
  const stages = defs.map(([key, label, short, done, date]) => ({ key, label, short, done, date, current: false }))
  const current = stages.find((stage) => !stage.done)
  if (current) current.current = true
  const orderValue = line.netPrice != null && line.orderQty != null ? Number(line.netPrice) * Number(line.orderQty) : null
  return {
    id: line.id,
    company,
    plant: line.plant || '',
    material: line.material || '',
    shortText: line.shortText || line.material || 'Material',
    quantity: line.quantity ?? null,
    orderQty: line.orderQty ?? null,
    openQty: line.openQty ?? null,
    receivedQty: received,
    unit: line.unit || '',
    indentNo: line.indentNo || '',
    indentItem: line.indentItem || '',
    requisitioner: line.requisitioner || '',
    requisitionDate: line.requisitionDate || null,
    indentDelivery: line.indentDelivery || null,
    sapPoNumber: line.poNumber || '',
    poNumber,
    poItem: line.poItem || '',
    vendor: line.vendor || '',
    sapVendorName: line.vendorName || '',
    vendorName,
    netPrice: line.netPrice ?? null,
    orderValue,
    poDate: line.poDate || null,
    poDelivery: line.poDelivery || null,
    dates,
    flags,
    stages,
    statusLabel: current?.label || 'Unloaded',
    awaitingPo: !poNumber,
    undelivered: Boolean(poNumber) && !flags.receipt,
    payment: {
      status: override.paymentStatus || 'unpaid',
      date: override.paymentDate || null,
    },
    remark: line.remark || '',
    sample: Boolean(line.sample),
    manual: Boolean(line.manual),
    special: line.special ? { by: line.special.by || '', note: line.special.note || '', at: line.special.at || '' } : null,
    updatedAt: line.updatedAt,
    editor: {
      company,
      manualPoNumber: line.manualPoNumber || '',
      manualVendorName: line.manualVendorName || '',
      remark: line.remark || '',
      orderPlacedDone: flags.orderPlaced,
      orderPlacedAuto: orderAuto,
      orderPlacedFollowsSap: typeof override.orderPlacedDone !== 'boolean' && typeof override.poMadeDone !== 'boolean',
      orderPlacedDate: dates.orderPlaced || '',
      expectedPoDate: override.expectedPoDate || '',
      readyDone: flags.ready,
      readyDate: dates.ready || '',
      transitDone: flags.transit,
      transitDate: dates.transit || '',
      hyderabadDone: flags.hyderabad,
      hyderabadDate: dates.hyderabad || '',
      receiptDone: flags.receipt,
      receiptAuto,
      receiptFollowsSap: typeof override.receiptDone !== 'boolean',
      receiptDate: dates.receipt || '',
      unloadedDone: flags.unloaded,
      unloadedDate: dates.unloaded || '',
      paymentStatus: override.paymentStatus || 'unpaid',
      paymentDate: override.paymentDate || '',
    },
  }
}

export function applyEditor(line, body, plantMap = {}) {
  const override = { ...(line.override || {}) }
  const setOptional = (key, value) => {
    if (value === null) delete override[key]
    else override[key] = Boolean(value)
  }
  if ('orderPlacedDone' in body) {
    setOptional('orderPlacedDone', body.orderPlacedDone)
    delete override.poMadeDone
  }
  if ('readyDone' in body) {
    override.readyDone = Boolean(body.readyDone)
    delete override.readinessDone
  }
  if ('transitDone' in body) {
    override.transitDone = Boolean(body.transitDone)
    delete override.etdDone
  }
  if ('hyderabadDone' in body) {
    override.hyderabadDone = Boolean(body.hyderabadDone)
    delete override.expectedArrivalDone
    delete override.etaDone
  }
  if ('receiptDone' in body) setOptional('receiptDone', body.receiptDone)
  if ('unloadedDone' in body) override.unloadedDone = Boolean(body.unloadedDone)
  const legacyDates = {
    orderPlacedDate: ['poMadeDate'],
    readyDate: ['readinessDate'],
    transitDate: ['etdDate'],
    hyderabadDate: ['expectedArrivalDate', 'etaDate'],
  }
  for (const key of ['orderPlacedDate', 'expectedPoDate', 'readyDate', 'transitDate', 'hyderabadDate', 'receiptDate', 'unloadedDate', 'paymentDate']) {
    if (!(key in body)) continue
    const iso = body[key] ? toISO(body[key]) : null
    if (iso) override[key] = iso
    else delete override[key]
    for (const legacy of legacyDates[key] || []) delete override[legacy]
  }
  if ('paymentStatus' in body && ['unpaid', 'partial', 'paid'].includes(body.paymentStatus)) {
    override.paymentStatus = body.paymentStatus
  }
  line.override = override
  if ('manualPoNumber' in body) line.manualPoNumber = asId(body.manualPoNumber).slice(0, 40)
  if ('manualVendorName' in body) line.manualVendorName = text(body.manualVendorName).slice(0, 120)
  if ('remark' in body) line.remark = text(body.remark).slice(0, 500)
  if ('company' in body && COMPANIES.includes(body.company) && body.company !== companyOf(line, plantMap)) {
    line.unitOverride = body.company
  }
  line.updatedAt = new Date().toISOString()
}

// Ticks (or clears) one milestone. Used by the quick "advance" and bulk actions.
export function stepPatch(step, done, date) {
  if (!STEP_KEYS.includes(step)) return null
  const patch = { [`${step}Done`]: Boolean(done) }
  // Without a date the line keeps whatever (possibly planned) date it already had.
  if (date) patch[`${step}Date`] = date
  return patch
}

export function normalizeStore(store) {
  store.lines ||= []
  store.vendorNames ||= {}
  store.uploads ||= []
  store.uploads.forEach((upload) => {
    if (!upload.id) upload.id = crypto.randomBytes(8).toString('hex')
  })
  store.baselines ||= {}
  store.notices ||= []
  store.loginFailures ||= {}
  store.pendingReceipts ||= {}
  const now = new Date().toISOString()
  const markForSave = () => Object.defineProperty(store, 'needsSave', { value: true, enumerable: false, configurable: true })
  // Sessions are kept as hashes with a start time. Older stores held raw tokens,
  // which are converted and written back on the first read.
  if ((store.sessions || []).some((item) => typeof item === 'string') || Object.values(store.plantSessions || {}).some((item) => typeof item === 'string')) {
    markForSave()
  }
  store.sessions =(store.sessions || []).map((item) => (typeof item === 'string' ? { hash: hashToken(item), at: now } : item))
  const plantSessions = {}
  for (const [key, value] of Object.entries(store.plantSessions || {})) {
    if (typeof value === 'string') plantSessions[hashToken(key)] = { plant: value, at: now }
    else plantSessions[key] = value
  }
  store.plantSessions = plantSessions
  store.plantPasswords ||= {}
  for (const id of COMPANIES) {
    if (!store.plantPasswords[id]) {
      store.plantPasswords[id] = randomPassword(id.replace('TCL-', ''))
      markForSave()
    }
  }
  const plantMap = {}
  for (const [plant, company] of Object.entries(store.plantMap || DEFAULT_PLANTS)) {
    if (COMPANIES.includes(company)) plantMap[String(plant)] = company
  }
  store.plantMap = Object.keys(plantMap).length ? plantMap : { ...DEFAULT_PLANTS }
  store.lines.forEach((line) => {
    line.override ||= {}
    line.receipts ||= {}
    line.remark ||= ''
    line.manualPoNumber ||= ''
    line.manualVendorName ||= ''
  })
  return store
}

function demoLine(partial) {
  return {
    override: {},
    receipts: {},
    manualPoNumber: '',
    manualVendorName: '',
    remark: '',
    sample: true,
    unit: '',
    createdAt: '2026-10-03T08:00:00.000Z',
    updatedAt: '2026-10-03T08:00:00.000Z',
    ...partial,
  }
}

export function createDemoStore() {
  const done = {
    readinessDone: true,
    readinessDate: '2026-09-22',
    etdDone: true,
    etdDate: '2026-09-26',
    etaDone: true,
    etaDate: '2026-09-29',
    expectedArrivalDone: true,
    expectedArrivalDate: '2026-09-30',
  }
  return normalizeStore({
    plantMap: { ...DEFAULT_PLANTS },
    vendorNames: {
      '300441': 'Lakshmi Metals',
      '300512': 'PackWell Supplies',
      '300880': 'Deccan Inks',
      '300900': 'Godavari Chem',
    },
    uploads: [],
    sessions: [],
    lines: [
      demoLine({
        id: 'IND-100960-10',
        companyOverride: 'TPL',
        plant: '1100',
        indentNo: '100960',
        indentItem: '10',
        material: 'RM-7720',
        shortText: 'Stainless sheet 1.2mm',
        quantity: 320,
        unit: 'KG',
        requisitioner: 'K. Rao',
        requisitionDate: '2026-10-01',
        indentDelivery: '2026-10-20',
      }),
      demoLine({
        id: 'IND-100891-10',
        companyOverride: 'TPL',
        plant: '1100',
        indentNo: '100891',
        indentItem: '10',
        material: 'RM-2201',
        shortText: 'Aluminium coil 0.8mm',
        quantity: 500,
        unit: 'KG',
        requisitioner: 'K. Rao',
        requisitionDate: '2026-09-18',
        indentDelivery: '2026-10-15',
        poNumber: '45007701',
        poItem: '10',
        vendor: '300441',
        vendorName: 'Lakshmi Metals',
        orderQty: 500,
        openQty: 500,
        netPrice: 240,
        poDate: '2026-10-03',
        poDelivery: '2026-10-15',
        override: {
          readinessDone: true,
          readinessDate: '2026-10-08',
          etdDone: true,
          etdDate: '2026-10-11',
          etaDate: '2026-10-15',
          expectedArrivalDate: '2026-10-16',
        },
      }),
      demoLine({
        id: 'IND-100891-20',
        companyOverride: 'TPL',
        plant: '1100',
        indentNo: '100891',
        indentItem: '20',
        material: 'RM-2204',
        shortText: 'Aluminium foil 20 micron',
        quantity: 180,
        unit: 'KG',
        requisitioner: 'K. Rao',
        requisitionDate: '2026-09-18',
        indentDelivery: '2026-10-15',
        poNumber: '45007701',
        poItem: '20',
        vendor: '300441',
        vendorName: 'Lakshmi Metals',
        orderQty: 180,
        openQty: 180,
        netPrice: 410,
        poDate: '2026-10-03',
        poDelivery: '2026-10-15',
      }),
      demoLine({
        id: 'IND-100870-10',
        companyOverride: 'TPL',
        plant: '1100',
        indentNo: '100870',
        indentItem: '10',
        material: 'PM-1180',
        shortText: 'Carton tape 48mm',
        quantity: 400,
        unit: 'NOS',
        requisitioner: 'K. Rao',
        requisitionDate: '2026-09-12',
        poNumber: '45007660',
        poItem: '10',
        vendor: '300512',
        vendorName: 'PackWell Supplies',
        orderQty: 400,
        openQty: 0,
        netPrice: 35,
        poDate: '2026-09-20',
        poDelivery: '2026-09-30',
        receipts: { 50011101: { qty: 400, date: '2026-10-01', movement: '101' } },
        override: { ...done, paymentStatus: 'paid', paymentDate: '2026-10-02' },
      }),
      demoLine({
        id: 'IND-100961-10',
        companyOverride: 'TCL-JDM',
        plant: '1200',
        indentNo: '100961',
        indentItem: '10',
        material: 'PK-4102',
        shortText: 'Printed shipper',
        quantity: 1500,
        unit: 'NOS',
        requisitioner: 'S. Nair',
        requisitionDate: '2026-10-02',
        indentDelivery: '2026-10-18',
      }),
      demoLine({
        id: 'IND-100940-10',
        companyOverride: 'TCL-JDM',
        plant: '1200',
        indentNo: '100940',
        indentItem: '10',
        material: 'IN-3302',
        shortText: 'Process ink cyan',
        quantity: 120,
        unit: 'KG',
        requisitioner: 'S. Nair',
        requisitionDate: '2026-09-21',
        poNumber: '45007810',
        poItem: '10',
        vendor: '300880',
        vendorName: 'Deccan Inks',
        orderQty: 120,
        openQty: 120,
        netPrice: 890,
        poDate: '2026-09-28',
        poDelivery: '2026-10-09',
        override: {
          readinessDone: true,
          readinessDate: '2026-09-28',
          etdDone: true,
          etdDate: '2026-10-04',
          etaDone: true,
          etaDate: '2026-10-09',
          paymentStatus: 'partial',
          paymentDate: '2026-10-01',
        },
      }),
      demoLine({
        id: 'IND-100901-10',
        companyOverride: 'TCL-JDM',
        plant: '1200',
        indentNo: '100901',
        indentItem: '10',
        material: 'AD-1004',
        shortText: 'Adhesive grade A',
        quantity: 250,
        unit: 'KG',
        requisitioner: 'K. Rao',
        requisitionDate: '2026-09-14',
        poNumber: '45007840',
        poItem: '10',
        vendor: '300512',
        vendorName: 'PackWell Supplies',
        orderQty: 250,
        openQty: 0,
        netPrice: 160,
        poDate: '2026-09-18',
        poDelivery: '2026-09-29',
        receipts: { 50011180: { qty: 250, date: '2026-10-02', movement: '101' } },
        override: { ...done, paymentStatus: 'unpaid' },
      }),
      demoLine({
        id: 'IND-100880-10',
        companyOverride: 'TCL-JDCL',
        plant: '1300',
        indentNo: '100880',
        indentItem: '10',
        material: 'SV-501',
        shortText: 'Solvent grade S',
        quantity: 800,
        unit: 'L',
        requisitioner: 'S. Nair',
        requisitionDate: '2026-10-02',
        indentDelivery: '2026-10-22',
      }),
      demoLine({
        id: 'IND-100850-10',
        companyOverride: 'TCL-JDCL',
        plant: '1300',
        indentNo: '100850',
        indentItem: '10',
        material: 'R-240',
        shortText: 'Resin R-240',
        quantity: 600,
        unit: 'KG',
        requisitioner: 'S. Nair',
        requisitionDate: '2026-09-16',
        poNumber: '45007901',
        poItem: '10',
        vendor: '300900',
        vendorName: 'Godavari Chem',
        orderQty: 600,
        openQty: 600,
        netPrice: 520,
        poDate: '2026-09-24',
        poDelivery: '2026-10-06',
        override: {
          readinessDone: true,
          readinessDate: '2026-09-25',
          etdDone: true,
          etdDate: '2026-09-30',
          etaDone: true,
          etaDate: '2026-10-06',
          expectedArrivalDone: true,
          expectedArrivalDate: '2026-10-07',
        },
      }),
      demoLine({
        id: 'IND-100830-10',
        companyOverride: 'TCL-JDCL',
        plant: '1300',
        indentNo: '100830',
        indentItem: '10',
        material: 'PG-12',
        shortText: 'Pigment white',
        quantity: 80,
        unit: 'KG',
        requisitioner: 'K. Rao',
        requisitionDate: '2026-09-11',
        poNumber: '45007920',
        poItem: '10',
        vendor: '300900',
        vendorName: 'Godavari Chem',
        orderQty: 80,
        openQty: 0,
        netPrice: 740,
        poDate: '2026-09-15',
        poDelivery: '2026-09-28',
        receipts: { 50011002: { qty: 80, date: '2026-09-29', movement: '101' } },
        override: { ...done, paymentStatus: 'paid', paymentDate: '2026-10-01' },
      }),
    ],
  })
}
