export const COMPANIES = ['TPL', 'TCL-JDM', 'TCL-JDCL']

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
  if (!sameDay(line.dates?.eta, fields.eta)) return false
  if (!sameDay(line.dates?.etd, fields.etd)) return false
  if (!sameDay(line.dates?.readiness, fields.readiness)) return false
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
    const aDate = a.dates?.eta || a.dates?.expectedArrival || a.dates?.sapDelivery || '9999-99-99'
    const bDate = b.dates?.eta || b.dates?.expectedArrival || b.dates?.sapDelivery || '9999-99-99'
    return aDate.localeCompare(bDate) || String(a.indentNo).localeCompare(String(b.indentNo)) || String(a.indentItem).localeCompare(String(b.indentItem), undefined, { numeric: true })
  })
}

export function siblingsOf(lines, line) {
  if (!line) return []
  if (line.poNumber) return lines.filter((item) => item.poNumber === line.poNumber)
  if (line.indentNo) return lines.filter((item) => item.indentNo === line.indentNo)
  return [line]
}

