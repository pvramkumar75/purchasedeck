import { variantFor } from '../shared/variant.js'

export const VARIANT = variantFor(typeof __APP_VARIANT__ === 'undefined' ? '' : __APP_VARIANT__)
export const PLANTS = VARIANT.plants
export const COMPANIES = PLANTS.map((plant) => plant.id)

export const STEPS = [
  { key: 'orderPlaced', label: 'Order placed', short: 'Ordered' },
  { key: 'ready', label: 'Ready for dispatch', short: 'Ready' },
  { key: 'transit', label: 'In transit', short: 'Transit' },
  { key: 'hyderabad', label: 'Arrived at Hyderabad', short: 'Hyderabad' },
  { key: 'receipt', label: 'Received at factory', short: 'Factory' },
  { key: 'unloaded', label: 'Unloaded', short: 'Unloaded' },
]

export function plantLabel(id) {
  return PLANTS.find((plant) => plant.id === id)?.label || id
}

export function companiesForPlant(plantId) {
  if (plantId === 'TCL') return COMPANIES.filter((id) => id.startsWith('TCL'))
  return [plantId]
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function pretty(iso) {
  if (!iso) return '—'
  const [year, month, day] = String(iso).slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return '—'
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`
}

export function short(iso) {
  if (!iso) return '—'
  const [, month, day] = String(iso).slice(0, 10).split('-').map(Number)
  if (!month || !day) return '—'
  return `${day} ${MONTHS[month - 1]}`
}

export function todayISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

export function materialBucket(line) {
  if (!line.poNumber) return 'indent'
  if (line.flags?.receipt) return 'received'
  const received = Number(line.receivedQty || 0)
  const open = line.openQty == null || line.openQty === '' ? null : Number(line.openQty)
  const ordered = Number(line.orderQty ?? line.quantity ?? 0)
  const partial = received > 0.0001 || (open != null && ordered > 0 && open > 0 && open + 0.0001 < ordered)
  return partial ? 'partial' : 'open'
}

export function isLateIndent(line) {
  return materialBucket(line) === 'indent' && workingDaysSince(line.requisitionDate) > 7
}

// A PO whose SAP delivery date has passed and is still not at the factory.
export function isOverdue(line, today = todayISO()) {
  const bucket = materialBucket(line)
  if (bucket !== 'open' && bucket !== 'partial') return false
  return Boolean(line.dates?.sapDelivery) && line.dates.sapDelivery < today
}

export function statusTone(line) {
  const bucket = materialBucket(line)
  if (bucket === 'indent') return isLateIndent(line) ? 'late' : 'indent'
  if (bucket === 'received') return 'received'
  if (bucket === 'partial') return 'partial'
  return 'waiting'
}

export const TONES = [
  { id: 'indent', label: 'Indent – no PO yet' },
  { id: 'late', label: 'Indent pending > 7 days' },
  { id: 'waiting', label: 'PO placed – nothing received' },
  { id: 'partial', label: 'PO placed – part received' },
  { id: 'received', label: 'Fully received' },
]

// Status: every line is in exactly one of these, so they add up to All.
export const STATUS_FILTERS = [
  { id: 'all', label: 'All', hint: 'Every line in this view.' },
  {
    id: 'indent',
    label: 'Indent – no PO yet',
    dot: 'indent',
    hint: 'Indent raised in SAP (ME5A), but no PO number yet from ME2L or typed in by purchase.',
  },
  {
    id: 'open',
    label: 'PO placed – nothing received',
    dot: 'waiting',
    hint: 'A PO exists, but no quantity has reached the factory yet.',
  },
  {
    id: 'partial',
    label: 'PO placed – part received',
    dot: 'partial',
    hint: 'Some quantity has been received (MB51 goods receipt); the balance is still open.',
  },
  {
    id: 'received',
    label: 'Fully received',
    dot: 'received',
    hint: 'Open quantity is 0 in ME2L, receipts cover the order, or purchase ticked "Received at factory".',
  },
]

// Watch list: lines that need a push. These overlap with the status filters.
export const WATCH_FILTERS = [
  {
    id: 'late',
    label: 'Indent pending > 7 days',
    dot: 'late',
    hint: 'Indents with no PO, raised more than 7 working days ago. Needs the requisition date in ME5A.',
  },
  {
    id: 'overdue',
    label: 'Past SAP delivery date',
    dot: 'late',
    hint: 'POs not fully received whose SAP delivery date has passed. Needs the delivery date in ME2L.',
  },
  {
    id: 'special',
    label: 'Special effort',
    dot: 'special',
    hint: 'Marked by purchase or a plant for extra attention. Both sides get a notice when it changes.',
  },
]

// Reached from dashboard cards rather than a chip.
export const EXTRA_FILTERS = [
  { id: 'po-open', label: 'PO placed – not fully received' },
]

export const ALL_FILTERS = [...STATUS_FILTERS, ...WATCH_FILTERS, ...EXTRA_FILTERS]

export function filterLabel(id) {
  return ALL_FILTERS.find((item) => item.id === id)?.label || ''
}

export function matchesBucket(line, bucket) {
  if (bucket === 'all') return true
  if (bucket === 'special') return Boolean(line.special)
  if (bucket === 'overdue') return isOverdue(line)
  if (bucket === 'late') return isLateIndent(line)
  if (bucket === 'po-open') return ['open', 'partial'].includes(materialBucket(line))
  return materialBucket(line) === bucket
}

export function bucketCounts(lines) {
  const counts = Object.fromEntries(ALL_FILTERS.map((item) => [item.id, 0]))
  for (const line of lines) {
    for (const item of ALL_FILTERS) if (matchesBucket(line, item.id)) counts[item.id] += 1
  }
  return counts
}

export const PERIODS = [
  { id: 30, label: 'Open + last 30 days' },
  { id: 90, label: 'Open + last 90 days' },
  { id: 0, label: 'Everything' },
]

// Items still open (or marked special) always show; the period only trims finished ones.
export function inPeriod(line, days) {
  if (!days) return true
  if (line.special || materialBucket(line) !== 'received') return true
  const iso = line.dates?.receipt || line.poDate || line.requisitionDate || line.updatedAt
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
  for (const step of STEPS) {
    if (!sameDay(line.dates?.[step.key], fields[step.key])) return false
  }
  if (fields.q && !matchesQuery(line, fields.q)) return false
  return true
}

export function matchesQuery(line, query) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return true
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
    line.plant,
    line.transport?.transporter,
    line.transport?.lrNumber,
  ].join(' ').toLowerCase()
  return needle.split(/\s+/).every((word) => blob.includes(word))
}

const PRIORITY = { late: 0, waiting: 1, partial: 1, indent: 2, received: 3 }

export const SORTS = [
  { id: 'priority', label: 'Needs attention first' },
  { id: 'eta', label: 'Arrival date' },
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
]

function eta(line) {
  return line.dates?.hyderabad || line.dates?.receipt || line.dates?.sapDelivery || line.dates?.expectedPo || '9999-99-99'
}

function started(line) {
  return line.requisitionDate || line.poDate || String(line.updatedAt || '').slice(0, 10) || ''
}

export function sortLines(lines, sort = 'priority') {
  const today = todayISO()
  return [...lines].sort((a, b) => {
    const special = Number(Boolean(b.special)) - Number(Boolean(a.special))
    if (sort === 'priority') {
      if (special) return special
      const overdue = Number(isOverdue(b, today)) - Number(isOverdue(a, today))
      if (overdue) return overdue
      const tone = PRIORITY[statusTone(a)] - PRIORITY[statusTone(b)]
      if (tone) return tone
      return eta(a).localeCompare(eta(b)) || started(a).localeCompare(started(b))
    }
    if (sort === 'eta') return eta(a).localeCompare(eta(b))
    if (sort === 'oldest') return started(a).localeCompare(started(b))
    return started(b).localeCompare(started(a))
  })
}

export function siblingsOf(lines, line) {
  if (!line) return []
  if (line.poNumber) return lines.filter((item) => item.poNumber === line.poNumber)
  if (line.indentNo) return lines.filter((item) => item.indentNo === line.indentNo)
  return [line]
}

export function currentStage(line) {
  return line.stages?.find((stage) => stage.current) || null
}

export function progressOf(line) {
  const done = line.stages?.filter((stage) => stage.done).length || 0
  return { done, total: line.stages?.length || 6, pct: Math.round((done / (line.stages?.length || 6)) * 100) }
}
