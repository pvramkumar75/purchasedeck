export const PLANTS = [
  { id: 'TPL', label: 'TPL' },
  { id: 'TCL-JDM', label: 'TCL-JDM' },
  { id: 'TCL-JDCL', label: 'TCL-JDCL' },
  { id: 'TCL', label: 'TCL (JDM+JDCL)' },
]
export const COMPANIES = PLANTS.map((plant) => plant.id)

export function plantLabel(id) {
  return PLANTS.find((plant) => plant.id === id)?.label || id
}

export function companiesForPlant(plantId) {
  if (plantId === 'TCL') return ['TCL-JDM', 'TCL-JDCL', 'TCL']
  return [plantId]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function pretty(iso) {
  if (!iso) return '—'
  const [year, month, day] = String(iso).slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return '—'
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]}, ${year}`
}

export function qty(value, unit) {
  if (value == null || value === '') return '—'
  const formatted = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value)
  return unit ? `${formatted} ${unit}` : formatted
}

export function inr(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function includes(value, needle) {
  if (!needle) return true
  return String(value || '').toLowerCase().includes(String(needle).trim().toLowerCase())
}

function sameDay(value, day) {
  if (!day) return true
  return String(value || '').slice(0, 10) === day
}

export function workingDaysSince(iso, today = new Date()) {
  if (!iso) return 0
  const start = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  const end = new Date(today)
  end.setHours(0, 0, 0, 0)
  if (Number.isNaN(start.getTime()) || start >= end) return 0
  let count = 0
  const cursor = new Date(start)
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1)
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) count += 1
  }
  return count
}

export function statusTone(line) {
  const bucket = materialBucket(line)
  if (bucket === 'indent') return workingDaysSince(line.requisitionDate) > 7 ? 'late' : 'indent'
  if (bucket === 'received') return 'received'
  if (bucket === 'partial') return 'partial'
  return 'waiting'
}

export function materialBucket(line) {
  if (!line.poNumber) return 'indent'
  if (line.flags?.receipt) return 'received'
  const received = Number(line.receivedQty || 0)
  const open = line.openQty == null || line.openQty === '' ? null : Number(line.openQty)
  const ordered = Number(line.orderQty ?? line.quantity ?? 0)
  const partial = received > 0.0001 || (open != null && ordered > 0 && open > 0 && open + 0.0001 < ordered)
  return partial ? 'partial' : 'open'
}

export const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'indent', label: 'Indents not converted to PO' },
  { id: 'open', label: 'PO made, material not received' },
  { id: 'partial', label: 'PO made, partial material received' },
  { id: 'special', label: 'Special effort' },
]

export function inPeriod(line, days) {
  if (!days) return true
  const iso = line.requisitionDate || line.poDate || line.updatedAt
  if (!iso) return true
  const when = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  const cutoff = new Date()
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days)
  return when >= cutoff
}

export function matchFields(line, fields) {
  if (!includes(line.indentNo, fields.indent)) return false
  if (fields.item) {
    const itemOk = [line.indentItem, line.poItem, line.material].some((value) => includes(value, fields.item))
    if (!itemOk) return false
  }
  if (fields.supplier) {
    const supplierOk = includes(line.vendorName, fields.supplier) || includes(line.vendor, fields.supplier)
    if (!supplierOk) return false
  }
  if (!sameDay(line.dates?.orderPlaced, fields.orderPlaced)) return false
  if (!sameDay(line.dates?.ready, fields.ready)) return false
  if (!sameDay(line.dates?.transit, fields.transit)) return false
  if (!sameDay(line.dates?.hyderabad, fields.hyderabad)) return false
  if (!sameDay(line.dates?.receipt, fields.receipt)) return false
  if (!sameDay(line.dates?.unloaded, fields.unloaded)) return false
  if (fields.q) {
    const blob = [
      line.indentNo,
      line.indentItem,
      line.poNumber,
      line.poItem,
      line.material,
      line.shortText,
      line.vendorName,
      line.vendor,
      line.company,
      line.requisitioner,
    ].join(' ')
    if (!includes(blob, fields.q)) return false
  }
  return true
}

export function sortForBoard(lines) {
  return [...lines].sort((a, b) => {
    const special = Number(Boolean(b.special)) - Number(Boolean(a.special))
    if (special) return special
    const aDate = a.dates?.hyderabad || a.dates?.receipt || a.dates?.orderPlaced || '9999-99-99'
    const bDate = b.dates?.hyderabad || b.dates?.receipt || b.dates?.orderPlaced || '9999-99-99'
    return aDate.localeCompare(bDate) || String(a.indentNo).localeCompare(String(b.indentNo)) || String(a.indentItem).localeCompare(String(b.indentItem), undefined, { numeric: true })
  })
}

export function siblingsOf(lines, line) {
  if (!line) return []
  if (line.poNumber) return lines.filter((item) => item.poNumber === line.poNumber)
  if (line.indentNo) return lines.filter((item) => item.indentNo === line.indentNo)
  return [line]
}

