import * as xlsx from 'xlsx'

export const COMPANIES = ['TPL', 'TCL-JDM', 'TCL-JDCL']

const DEFAULT_PLANTS = {
  '1100': 'TPL',
  '1200': 'TCL-JDM',
  '1300': 'TCL-JDCL',
}

export function norm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function asId(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value)
  }
  return String(value).trim()
}

export function num(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(String(value).replace(/,/g, '').replace(/\s/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function text(value) {
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
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/)
  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
  }
  return null
}

function val(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return row[key]
  }
  const rowKeys = Object.keys(row)
  const sorted = [...keys].sort((a, b) => b.length - a.length)
  for (const key of sorted) {
    if (key.length < 6) continue
    const hit = rowKeys.find((candidate) => candidate.includes(key))
    if (hit && row[hit] != null && String(row[hit]).trim() !== '') return row[hit]
  }
  return ''
}

function detect(headers) {
  const joined = headers.join(' | ')
  if (joined.includes('movement type') || joined.includes('material document')) return 'MB51'
  if (joined.includes('still to be delivered') || joined.includes('order quantity')) return 'ME2L'
  if (joined.includes('purchase requisition') || joined.includes('requisitioner')) return 'ME5A'
  return null
}

function mapMe5a(row) {
  const indentNo = asId(val(row, ['purchase requisition', 'purch req', 'pr number']))
  const material = asId(val(row, ['material']))
  if (!indentNo && !material) return null
  return {
    indentNo,
    indentItem: asId(val(row, ['item'])) || '0',
    material,
    shortText: text(val(row, ['short text', 'material description', 'description'])),
    quantity: num(val(row, ['quantity'])),
    unit: text(val(row, ['unit of measure', 'base unit of measure', 'uom', 'unit'])),
    indentDelivery: toISO(val(row, ['delivery date', 'deliv date'])),
    plant: asId(val(row, ['plant'])),
    requisitioner: text(val(row, ['requisitioner'])),
    requisitionDate: toISO(val(row, ['requisition date', 'req date'])),
    poNumber: asId(val(row, ['purchasing document', 'purchase order'])),
    vendor: asId(val(row, ['vendor', 'fixed vendor'])),
    vendorName: text(val(row, ['fixed vendor name', 'vendor name', 'name 1'])),
  }
}

function mapMe2l(row) {
  const poNumber = asId(val(row, ['purchasing document', 'purchase order']))
  const indentNo = asId(val(row, ['purchase requisition']))
  const material = asId(val(row, ['material']))
  if (!poNumber && !indentNo && !material) return null
  const indentItem = asId(val(row, ['item of requisition', 'requisition item']))
  return {
    vendor: asId(val(row, ['vendor'])),
    vendorName: text(val(row, ['name 1', 'vendor name', 'supplier name'])),
    poNumber,
    poItem: asId(val(row, ['item'])) || '0',
    material,
    shortText: text(val(row, ['short text', 'material description'])),
    orderQty: num(val(row, ['order quantity'])),
    openQty: num(val(row, ['quantity still to be delivered', 'still to be delivered'])),
    netPrice: num(val(row, ['net price', 'net order price'])),
    plant: asId(val(row, ['plant'])),
    poDate: toISO(val(row, ['document date'])),
    poDelivery: toISO(val(row, ['delivery date'])),
    indentNo,
    indentItem: indentItem || (indentNo ? '0' : ''),
  }
}

function mapMb51(row) {
  const matDoc = asId(val(row, ['material document']))
  const material = asId(val(row, ['material']))
  if (!matDoc && !material) return null
  return {
    matDoc,
    material,
    plant: asId(val(row, ['plant'])),
    movement: asId(val(row, ['movement type'])),
    postingDate: toISO(val(row, ['posting date'])),
    quantity: num(val(row, ['quantity'])),
    poNumber: asId(val(row, ['purchase order', 'purchasing document'])),
    poItem: asId(val(row, ['item'])),
    vendor: asId(val(row, ['vendor'])),
  }
}

export function parseMatrix(matrix) {
  if (!matrix?.length) return { report: null, records: [], headers: [] }
  let headerIdx = 0
  for (let i = 0; i < Math.min(matrix.length, 30); i += 1) {
    const joined = matrix[i].map((cell) => norm(cell)).join(' | ')
    if (
      joined.includes('movement type') ||
      joined.includes('still to be delivered') ||
      joined.includes('order quantity') ||
      joined.includes('purchase requisition') ||
      joined.includes('requisitioner') ||
      joined.includes('purchasing document')
    ) {
      headerIdx = i
      break
    }
  }
  const headers = matrix[headerIdx].map((cell) => norm(cell))
  const report = detect(headers)
  const records = []
  for (let r = headerIdx + 1; r < matrix.length; r += 1) {
    const obj = {}
    let any = false
    headers.forEach((header, index) => {
      if (!header) return
      const value = matrix[r][index]
      if (value != null && String(value).trim() !== '') any = true
      if (obj[header] == null || obj[header] === '') obj[header] = value
    })
    if (!any || !report) continue
    const rec = report === 'ME5A' ? mapMe5a(obj) : report === 'ME2L' ? mapMe2l(obj) : mapMb51(obj)
    if (rec) records.push(rec)
  }
  return { report, records, headers }
}

function parseDelimited(text) {
  const source = text.replace(/^\uFEFF/, '')
  const headerEnd = source.search(/\r?\n/)
  const header = headerEnd === -1 ? source : source.slice(0, headerEnd)
  const commas = (header.match(/,/g) || []).length
  const semis = (header.match(/;/g) || []).length
  const delimiter = semis > commas ? ';' : ','
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

export function parseWorkbook(buffer) {
  const zipped = buffer[0] === 0x50 && buffer[1] === 0x4b
  if (!zipped) {
    const parsed = parseMatrix(parseDelimited(buffer.toString('utf8')))
    if (parsed.report) return parsed
  }
  const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: false })
  for (const name of workbook.SheetNames) {
    const matrix = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' })
    const parsed = parseMatrix(matrix)
    if (parsed.report && parsed.records.length) return parsed
  }
  return { report: null, records: [], headers: [] }
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

function ensure(store, id) {
  let line = store.lines.find((item) => item.id === id)
  if (!line) {
    line = blankLine(id)
    store.lines.push(line)
  }
  return line
}

function fill(line, fields) {
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === '') continue
    line[key] = value
  }
  line.sample = false
  line.updatedAt = new Date().toISOString()
}

export function applyRecords(store, report, records) {
  if (store.lines.some((line) => line.sample)) {
    store.lines = store.lines.filter((line) => !line.sample)
    store.vendorNames = {}
  }
  let count = 0
  if (report === 'ME5A') {
    for (const record of records) {
      if (!record.indentNo && !record.material) continue
      const id = record.indentNo ? `IND-${record.indentNo}-${record.indentItem || '0'}` : `MAT-${record.material}`
      fill(ensure(store, id), record)
      count += 1
    }
  }
  if (report === 'ME2L') {
    for (const record of records) {
      if (!record.poNumber && !record.indentNo) continue
      let id = record.indentNo
        ? `IND-${record.indentNo}-${record.indentItem || '0'}`
        : `PO-${record.poNumber}-${record.poItem || '0'}`
      if (record.indentNo && (!record.indentItem || record.indentItem === '0')) {
        const match = store.lines.find((line) => line.indentNo === record.indentNo && record.material && line.material === record.material)
        if (match) id = match.id
      }
      const existing = store.lines.find(
        (line) => line.poNumber === record.poNumber && String(line.poItem || '') === String(record.poItem || '') && line.id !== id,
      )
      if (existing && record.indentNo) {
        const indentLine = store.lines.find((line) => line.id === id)
        if (!indentLine) existing.id = id
        else {
          indentLine.receipts = { ...existing.receipts, ...indentLine.receipts }
          indentLine.override = { ...existing.override, ...indentLine.override }
          store.lines = store.lines.filter((line) => line !== existing)
        }
      }
      const line = ensure(store, id)
      fill(line, record)
      if (record.vendor && record.vendorName) store.vendorNames[record.vendor] = record.vendorName
      count += 1
    }
  }
  if (report === 'MB51') {
    for (const record of records) {
      if (!record.matDoc) continue
      let line = store.lines.find(
        (item) => record.poNumber && item.poNumber === record.poNumber && String(item.poItem || '') === String(record.poItem || ''),
      )
      if (!line) {
        const id = record.poNumber ? `PO-${record.poNumber}-${record.poItem || '0'}` : `MAT-${record.material}-${record.matDoc}`
        line = ensure(store, id)
        fill(line, {
          material: record.material,
          plant: record.plant,
          poNumber: record.poNumber,
          poItem: record.poItem,
          vendor: record.vendor,
        })
      }
      const movement = String(record.movement || '')
      const reversal = movement === '102' || movement === '122'
      const receipt = movement === '101' || movement === '105' || movement === '103'
      if (!reversal && !receipt) continue
      const magnitude = Math.abs(Number(record.quantity || 0))
      line.receipts[record.matDoc] = {
        qty: reversal ? -magnitude : magnitude,
        date: record.postingDate,
        movement,
      }
      if (!line.vendorName && record.vendor && store.vendorNames[record.vendor]) {
        line.vendorName = store.vendorNames[record.vendor]
      }
      line.sample = false
      line.updatedAt = new Date().toISOString()
      count += 1
    }
  }
  store.uploads.unshift({ report, rows: count, at: new Date().toISOString() })
  store.uploads = store.uploads.slice(0, 12)
  return count
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
  const poMadeAuto = Boolean(line.poNumber || line.manualPoNumber)
  const receiptAuto = autoReceipt(line, poNumber)
  const flags = {
    indent: true,
    poMade: typeof override.poMadeDone === 'boolean' ? override.poMadeDone : poMadeAuto,
    readiness: Boolean(override.readinessDone),
    etd: Boolean(override.etdDone),
    eta: Boolean(override.etaDone),
    expectedArrival: Boolean(override.expectedArrivalDone),
    receipt: typeof override.receiptDone === 'boolean' ? override.receiptDone : receiptAuto,
  }
  const dates = {
    indent: line.requisitionDate || null,
    poMade: override.poMadeDate || line.poDate || null,
    readiness: override.readinessDate || null,
    etd: override.etdDate || null,
    eta: override.etaDate || null,
    expectedArrival: override.expectedArrivalDate || null,
    receipt: override.receiptDate || sapReceipt,
    payment: override.paymentDate || null,
    sapDelivery: line.poDelivery || line.indentDelivery || null,
  }
  const company = line.companyOverride || plantMap[String(line.plant || '')] || 'Unassigned'
  const defs = [
    ['indent', 'Indent raised', 'Indent', true, dates.indent],
    ['poMade', 'PO made', 'PO made', flags.poMade, dates.poMade],
    ['readiness', 'Readiness', 'Readiness', flags.readiness, dates.readiness],
    ['etd', 'ETD', 'ETD', flags.etd, dates.etd],
    ['eta', 'ETA', 'ETA', flags.eta, dates.eta],
    ['expectedArrival', 'Expected arrival', 'Arrival', flags.expectedArrival, dates.expectedArrival],
    ['receipt', 'Receipt at factory', 'Factory', flags.receipt, dates.receipt],
  ]
  const stages = defs.map(([key, label, short, done, date]) => ({ key, label, short, done, date, current: false }))
  if (flags.receipt) {
    stages.forEach((stage) => {
      stage.done = true
      stage.current = false
    })
  } else {
    const current = stages.find((stage) => !stage.done)
    if (current) current.current = true
  }
  const current = stages.find((stage) => stage.current)
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
    statusLabel: flags.receipt ? 'Received at factory' : current?.label || 'Received at factory',
    awaitingPo: !poNumber,
    undelivered: Boolean(poNumber) && !flags.receipt,
    payment: {
      status: override.paymentStatus || 'unpaid',
      date: override.paymentDate || null,
    },
    remark: line.remark || '',
    sample: Boolean(line.sample),
    updatedAt: line.updatedAt,
    editor: {
      company,
      manualPoNumber: line.manualPoNumber || '',
      manualVendorName: line.manualVendorName || '',
      remark: line.remark || '',
      poMadeDone: flags.poMade,
      poMadeAuto,
      poMadeFollowsSap: typeof override.poMadeDone !== 'boolean',
      poMadeDate: override.poMadeDate || '',
      readinessDone: flags.readiness,
      readinessDate: override.readinessDate || '',
      etdDone: flags.etd,
      etdDate: override.etdDate || '',
      etaDone: flags.eta,
      etaDate: override.etaDate || '',
      expectedArrivalDone: flags.expectedArrival,
      expectedArrivalDate: override.expectedArrivalDate || '',
      receiptDone: flags.receipt,
      receiptAuto,
      receiptFollowsSap: typeof override.receiptDone !== 'boolean',
      receiptDate: override.receiptDate || '',
      paymentStatus: override.paymentStatus || 'unpaid',
      paymentDate: override.paymentDate || '',
    },
  }
}

export function applyEditor(line, body) {
  const override = { ...(line.override || {}) }
  const setOptional = (key, value) => {
    if (value === null) delete override[key]
    else override[key] = Boolean(value)
  }
  if ('poMadeDone' in body) setOptional('poMadeDone', body.poMadeDone)
  if ('readinessDone' in body) override.readinessDone = Boolean(body.readinessDone)
  if ('etdDone' in body) override.etdDone = Boolean(body.etdDone)
  if ('etaDone' in body) override.etaDone = Boolean(body.etaDone)
  if ('expectedArrivalDone' in body) override.expectedArrivalDone = Boolean(body.expectedArrivalDone)
  if ('receiptDone' in body) setOptional('receiptDone', body.receiptDone)
  for (const key of ['poMadeDate', 'readinessDate', 'etdDate', 'etaDate', 'expectedArrivalDate', 'receiptDate', 'paymentDate']) {
    if (!(key in body)) continue
    const iso = body[key] ? toISO(body[key]) : null
    if (iso) override[key] = iso
    else delete override[key]
  }
  if ('paymentStatus' in body && ['unpaid', 'partial', 'paid'].includes(body.paymentStatus)) {
    override.paymentStatus = body.paymentStatus
  }
  line.override = override
  if ('manualPoNumber' in body) line.manualPoNumber = asId(body.manualPoNumber)
  if ('manualVendorName' in body) line.manualVendorName = text(body.manualVendorName)
  if ('remark' in body) line.remark = text(body.remark).slice(0, 500)
  if ('company' in body && COMPANIES.includes(body.company)) line.companyOverride = body.company
  line.updatedAt = new Date().toISOString()
}

export function normalizeStore(store) {
  store.lines ||= []
  store.vendorNames ||= {}
  store.uploads ||= []
  store.sessions ||= []
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
