// Reads SAP exports (ME5A, ME2L, MB51) into plain records. Runs in the browser, so
// big files never have to fit through the server, and on the server as a fallback.
// No Node or browser-only APIs here; the xlsx library is passed in by the caller.

export const RECEIPT_MOVES = new Set(['101', '103', '105'])
export const REVERSAL_MOVES = new Set(['102', '104', '106', '122'])
export const REPORTS = ['ME5A', 'ME2L', 'MB51']

export function norm(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function asId(value) {
  if (value == null || value === '') return ''
  return String(value).trim()
}

// SAP prints item numbers as 10 or 00010 depending on the report and export format.
export function asItem(value) {
  const id = asId(value)
  return /^\d+$/.test(id) ? id.replace(/^0+(?=\d)/, '') : id
}

export function num(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(String(value).replace(/,/g, '').replace(/\s/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function text(value) {
  if (value == null) return ''
  return String(value).trim()
}

export function toISO(value) {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = Date.UTC(1899, 11, 30)
    const dt = new Date(epoch + Math.round(value) * 86400000)
    return dt.toISOString().slice(0, 10)
  }
  const raw = String(value).trim()
  const build = (y, m, d) => {
    const month = Number(m)
    const day = Number(d)
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (match) return build(match[1], match[2], match[3])
  match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/)
  if (match) return build(match[3], match[2], match[1])
  return null
}

function detect(headers) {
  const joined = headers.join(' | ')
  if (joined.includes('movement type') || joined.includes('material document')) return 'MB51'
  if (joined.includes('still to be delivered') || joined.includes('order quantity')) return 'ME2L'
  if (joined.includes('purchase requisition') || joined.includes('requisitioner')) return 'ME5A'
  return null
}

// Column lookup worked out once per file: exact heading matches first (in the order
// given), then headings that contain a longer key. Each row takes the first non-empty.
function columns(headers) {
  const cache = new Map()
  return (keys) => {
    const id = keys.join('|')
    if (cache.has(id)) return cache.get(id)
    const picked = []
    for (const key of keys) headers.forEach((header, index) => { if (header === key) picked.push(index) })
    for (const key of [...keys].sort((a, b) => b.length - a.length)) {
      if (key.length < 6) continue
      const index = headers.findIndex((header) => header.includes(key))
      if (index !== -1 && !picked.includes(index)) picked.push(index)
    }
    cache.set(id, picked)
    return picked
  }
}

function reader(row, find) {
  return (keys) => {
    for (const index of find(keys)) {
      const value = row[index]
      if (value != null && String(value).trim() !== '') return value
    }
    return ''
  }
}

function mapMe5a(val) {
  const indentNo = asId(val(['purchase requisition', 'purch req', 'pr number']))
  const material = asId(val(['material']))
  if (!indentNo && !material) return null
  return {
    indentNo,
    indentItem: asItem(val(['item'])) || '0',
    material,
    shortText: text(val(['short text', 'material description', 'description'])),
    quantity: num(val(['quantity'])),
    unit: text(val(['unit of measure', 'base unit of measure', 'uom', 'unit'])),
    indentDelivery: toISO(val(['delivery date', 'deliv date'])),
    plant: asId(val(['plant'])),
    requisitioner: text(val(['requisitioner'])),
    requisitionDate: toISO(val(['requisition date', 'req date'])),
    poNumber: asId(val(['purchasing document', 'purchase order'])),
    vendor: asId(val(['vendor', 'fixed vendor'])),
    vendorName: text(val(['fixed vendor name', 'vendor name', 'name 1'])),
  }
}

function mapMe2l(val) {
  const poNumber = asId(val(['purchasing document', 'purchase order']))
  const indentNo = asId(val(['purchase requisition']))
  const material = asId(val(['material']))
  if (!poNumber && !indentNo && !material) return null
  const indentItem = asItem(val(['item of requisition', 'requisition item']))
  return {
    vendor: asId(val(['vendor'])),
    vendorName: text(val(['name 1', 'vendor name', 'supplier name'])),
    poNumber,
    poItem: asItem(val(['item'])) || '0',
    material,
    shortText: text(val(['short text', 'material description'])),
    orderQty: num(val(['order quantity'])),
    openQty: num(val(['quantity still to be delivered', 'still to be delivered'])),
    netPrice: num(val(['net price', 'net order price'])),
    plant: asId(val(['plant'])),
    poDate: toISO(val(['document date'])),
    poDelivery: toISO(val(['delivery date'])),
    indentNo,
    indentItem: indentItem || (indentNo ? '0' : ''),
  }
}

function mapMb51(val) {
  const matDoc = asId(val(['material document']))
  const material = asId(val(['material']))
  if (!matDoc && !material) return null
  return {
    matDoc,
    material,
    plant: asId(val(['plant'])),
    movement: asId(val(['movement type'])),
    postingDate: toISO(val(['posting date'])),
    quantity: num(val(['quantity'])),
    poNumber: asId(val(['purchase order', 'purchasing document'])),
    poItem: asItem(val(['item'])),
    vendor: asId(val(['vendor'])),
  }
}

const HEADER_HINTS = ['movement type', 'still to be delivered', 'order quantity', 'purchase requisition', 'requisitioner', 'purchasing document']

export function parseMatrix(matrix) {
  if (!matrix?.length) return { report: null, records: [], headers: [] }
  let headerIdx = 0
  for (let i = 0; i < Math.min(matrix.length, 30); i += 1) {
    const joined = (matrix[i] || []).map((cell) => norm(cell)).join(' | ')
    if (HEADER_HINTS.some((hint) => joined.includes(hint))) {
      headerIdx = i
      break
    }
  }
  const headers = (matrix[headerIdx] || []).map((cell) => norm(cell))
  const report = detect(headers)
  if (!report) return { report: null, records: [], headers }
  const find = columns(headers)
  const map = report === 'ME5A' ? mapMe5a : report === 'ME2L' ? mapMe2l : mapMb51
  const records = []
  for (let r = headerIdx + 1; r < matrix.length; r += 1) {
    const row = matrix[r]
    if (!row || !row.some((cell) => cell != null && String(cell).trim() !== '')) continue
    const rec = map(reader(row, find))
    if (rec) records.push(rec)
  }
  return { report, records, headers }
}

function pickDelimiter(source) {
  // SAP "Spreadsheet" exports are tab separated and often start with title lines,
  // so look at the first few lines rather than only the first.
  const sample = source.split(/\r?\n/, 12).join('\n')
  if ((sample.match(/\t/g) || []).length > 0) return '\t'
  return (sample.match(/;/g) || []).length > (sample.match(/,/g) || []).length ? ';' : ','
}

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '')
}

function parseDelimited(source) {
  const delimiter = pickDelimiter(source)
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"'
          i += 1
        } else quoted = false
      } else cell += char
    } else if (char === '"') quoted = true
    else if (char === delimiter) {
      row.push(cell)
      cell = ''
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (char !== '\r') cell += char
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

// `bytes` is a Uint8Array (a Node Buffer works too); `xlsx` is the SheetJS module.
export function parseWorkbook(bytes, xlsx) {
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b
  const legacyExcel = bytes[0] === 0xd0 && bytes[1] === 0xcf
  if (!zipped && !legacyExcel) {
    const parsed = parseMatrix(parseDelimited(decodeText(bytes)))
    if (parsed.report) return parsed
  }
  const workbook = xlsx.read(bytes, {
    type: 'array',
    dense: true,
    cellDates: false,
    cellText: false,
    cellNF: false,
    cellHTML: false,
    cellStyles: false,
  })
  for (const name of workbook.SheetNames) {
    const matrix = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' })
    const parsed = parseMatrix(matrix)
    if (parsed.report && parsed.records.length) return parsed
  }
  return { report: null, records: [], headers: [] }
}

// Keeps only what the board uses. MB51 exports carry every movement (issues,
// transfers...), but only goods receipts and their reversals matter here.
export function compactRecords(report, records) {
  if (report !== 'MB51') return records
  return records.filter((record) => record.matDoc && (RECEIPT_MOVES.has(record.movement) || REVERSAL_MOVES.has(record.movement)))
}

const FIELDS = {
  ME5A: ['indentNo', 'indentItem', 'material', 'shortText', 'quantity', 'unit', 'indentDelivery', 'plant', 'requisitioner', 'requisitionDate', 'poNumber', 'vendor', 'vendorName'],
  ME2L: ['vendor', 'vendorName', 'poNumber', 'poItem', 'material', 'shortText', 'orderQty', 'openQty', 'netPrice', 'plant', 'poDate', 'poDelivery', 'indentNo', 'indentItem'],
  MB51: ['matDoc', 'material', 'plant', 'movement', 'postingDate', 'quantity', 'poNumber', 'poItem', 'vendor'],
}
const NUMERIC = new Set(['quantity', 'orderQty', 'openQty', 'netPrice'])
const DATES = new Set(['indentDelivery', 'requisitionDate', 'poDate', 'poDelivery', 'postingDate'])

// Records arriving from a browser are rebuilt field by field: known keys only,
// short strings, real numbers and ISO dates, so nothing odd reaches the store.
export function cleanRecords(report, records) {
  if (!REPORTS.includes(report) || !Array.isArray(records)) return null
  const fields = FIELDS[report]
  const out = []
  for (const record of records) {
    if (!record || typeof record !== 'object') continue
    const clean = {}
    for (const key of fields) {
      const value = record[key]
      if (NUMERIC.has(key)) clean[key] = num(value)
      else if (DATES.has(key)) clean[key] = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
      else clean[key] = key.endsWith('Item') ? asItem(value).slice(0, 20) : text(value).slice(0, key === 'shortText' || key === 'vendorName' ? 200 : 60)
    }
    out.push(clean)
  }
  return out
}
