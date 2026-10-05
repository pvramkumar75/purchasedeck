import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, getToken, setToken } from './api.js'
import { readSapFile } from './readSap.js'
import {
  PLANTS,
  SORTS,
  STEPS,
  bucketCounts,
  currentStage,
  isLateIndent,
  isOverdue,
  matchesBucket,
  matchesQuery,
  plantLabel,
  pretty,
  qty,
  sortLines,
  statusTone,
  todayISO,
} from './model.js'
import { Chips, Icon, Logo, SearchBox, Skeleton, ThemeToggle, Toggle, ago, copyText, useFeedback, useNow, useSlashFocus } from './ui.jsx'
import { EmptyState, MiniTrack, NoticeBell, SpecialPanel, StackBar, StatusBadge, StatusFilters, ToneKey, TrackingRail, TransportLine } from './visuals.jsx'

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'grid' },
  { id: 'lines', label: 'Milestones', icon: 'list' },
  { id: 'upload', label: 'SAP upload', icon: 'upload' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
]

// ---------- sign in ----------

function Login({ onDone }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api.login(pin)
      setToken(result.token)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="auth">
      <div className="auth-top"><ThemeToggle /></div>
      <form className="auth-card" onSubmit={submit}>
        <Logo size={48} />
        <h1>Purchase desk</h1>
        <p className="muted">Update milestones, load SAP reports, and share plant links.</p>
        <label className="field">
          PIN
          <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} autoFocus autoComplete="current-password" />
        </label>
        {error && <p className="error"><Icon name="alert" size={15} /> {error}</p>}
        <button className="btn wide" type="submit" disabled={busy || !pin}>{busy ? 'Checking…' : 'Open desk'}</button>
        <a className="muted small center" href="/">Looking for a plant link?</a>
      </form>
    </div>
  )
}

// ---------- milestone editor ----------

const TEXT_KEYS = ['company', 'manualPoNumber', 'manualVendorName', 'remark', 'expectedPoDate', 'transporterName', 'driverPhone', 'lrNumber']
const STEP_FIELDS = STEPS.flatMap((step) => [`${step.key}Done`, `${step.key}Date`])

function editorState(line) {
  return {
    ...line.editor,
    orderMode: line.editor.orderPlacedFollowsSap ? 'sap' : 'manual',
    receiptMode: line.editor.receiptFollowsSap ? 'sap' : 'manual',
  }
}

const sapValue = (state, mode, key) => (state[mode] === 'sap' ? null : Boolean(state[key]))

// Only what the buyer actually changed is sent, so other people's edits survive.
function changesBetween(base, form) {
  const out = {}
  for (const key of [...TEXT_KEYS, ...STEP_FIELDS]) {
    if (key === 'orderPlacedDone' || key === 'receiptDone') continue
    if ((form[key] ?? '') !== (base[key] ?? '')) out[key] = form[key] ?? ''
  }
  if (sapValue(form, 'orderMode', 'orderPlacedDone') !== sapValue(base, 'orderMode', 'orderPlacedDone')) {
    out.orderPlacedDone = sapValue(form, 'orderMode', 'orderPlacedDone')
  }
  if (sapValue(form, 'receiptMode', 'receiptDone') !== sapValue(base, 'receiptMode', 'receiptDone')) {
    out.receiptDone = sapValue(form, 'receiptMode', 'receiptDone')
  }
  return out
}

function previewStages(line, form) {
  let currentSet = false
  return line.stages.map((stage) => {
    const done = Boolean(form[`${stage.key}Done`])
    const current = !done && !currentSet
    if (current) currentSet = true
    return { ...stage, done, current, date: form[`${stage.key}Date`] || null }
  })
}

function Editor({ line, onSaved, onClose, onDirty, onRemoved }) {
  const { toast, confirm } = useFeedback()
  const [base, setBase] = useState(() => editorState(line))
  const [form, setForm] = useState(base)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const changes = changesBetween(base, form)
  const dirty = Object.keys(changes).length > 0

  useEffect(() => {
    const next = editorState(line)
    setBase(next)
    setForm(next)
    setError('')
  }, [line.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // A background refresh only replaces the form when nothing is being edited.
  useEffect(() => {
    if (dirty) return
    const next = editorState(line)
    setBase(next)
    setForm(next)
  }, [line]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])

  const patch = (partial) => setForm((current) => ({ ...current, ...partial }))

  const tick = (key, done) => {
    const update = { [`${key}Done`]: done }
    if (done && !form[`${key}Date`]) update[`${key}Date`] = todayISO()
    if (key === 'orderPlaced') update.orderMode = 'manual'
    if (key === 'receipt') update.receiptMode = 'manual'
    patch(update)
  }

  const savingRef = useRef(false)
  const save = async () => {
    if (!dirty || savingRef.current) return
    savingRef.current = true
    setBusy(true)
    setError('')
    try {
      const next = await api.saveLine(line.id, changes)
      setBase(form)
      onSaved(next)
      toast('Milestones saved')
    } catch (err) {
      setError(err.message)
      if (err.status === 401) onSaved(null, err)
    } finally {
      savingRef.current = false
      setBusy(false)
    }
  }

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const remove = async () => {
    const ok = await confirm({ title: 'Remove this line?', body: `${line.shortText} will disappear from the board and the plant link. A later SAP upload can bring it back.`, confirmLabel: 'Remove line', danger: true })
    if (!ok) return
    setBusy(true)
    try {
      onRemoved(await api.deleteLine(line.id))
      toast('Line removed')
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const knownUnit = PLANTS.some((plant) => plant.id === form.company)
  const stages = previewStages(line, form)

  return (
    <section className="detail editor" aria-label={`Edit ${line.shortText}`}>
      <div className="detail-bar">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="back" /></button>
        <span className="muted small">{dirty ? 'Unsaved changes' : `Updated ${ago(line.updatedAt)}`}</span>
      </div>
      <div className="detail-head">
        <p className="eyebrow">{plantLabel(line.company)}{line.plant ? ` · SAP plant ${line.plant}` : ''}</p>
        <h2>{line.shortText}</h2>
        <StatusBadge line={line} />
        <p className="meta mono">{line.material || '—'} · Indent {line.indentNo || '—'}/{line.indentItem || '—'}{line.poNumber ? ` · PO ${line.poNumber}/${line.poItem || '—'}` : ''}</p>
      </div>

      <TrackingRail stages={stages} onToggle={(key) => tick(key, !form[`${key}Done`])} />

      <dl className="facts">
        <div><dt>Ordered</dt><dd>{qty(line.orderQty ?? line.quantity, line.unit)}</dd></div>
        <div><dt>Still open</dt><dd>{line.openQty == null ? '—' : qty(line.openQty, line.unit)}</dd></div>
        <div><dt>Received</dt><dd>{qty(line.receivedQty, line.unit)}</dd></div>
        <div><dt>SAP delivery</dt><dd className={isOverdue(line) ? 'warn' : ''}>{pretty(line.dates.sapDelivery)}</dd></div>
      </dl>

      <div className="form-grid">
        <label className="field">
          Unit
          <select value={knownUnit ? form.company : ''} onChange={(event) => patch({ company: event.target.value })}>
            <option value="" disabled>Choose plant</option>
            {PLANTS.map((plant) => <option key={plant.id} value={plant.id}>{plant.label}</option>)}
          </select>
        </label>
        {line.awaitingPo && (
          <label className="field">
            Expected PO date
            <input type="date" value={form.expectedPoDate || ''} onChange={(event) => patch({ expectedPoDate: event.target.value })} />
          </label>
        )}
        {line.sapPoNumber ? (
          <div className="field static"><span>PO number</span><strong>{line.sapPoNumber} <em className="pill-sap">SAP</em></strong></div>
        ) : (
          <label className="field">
            PO number, if known
            <input
              value={form.manualPoNumber}
              onChange={(event) => patch({ manualPoNumber: event.target.value, ...(event.target.value && !form.orderPlacedDone ? { orderPlacedDone: true, orderMode: 'manual', orderPlacedDate: form.orderPlacedDate || todayISO() } : {}) })}
            />
          </label>
        )}
        {line.sapVendorName ? (
          <div className="field static"><span>Supplier</span><strong>{line.sapVendorName} <em className="pill-sap">SAP</em></strong></div>
        ) : (
          <label className="field">
            {line.awaitingPo ? 'Supplier (tentative)' : 'Supplier'}
            <input value={form.manualVendorName} onChange={(event) => patch({ manualVendorName: event.target.value })} />
          </label>
        )}
      </div>
      {!knownUnit && <p className="hint warn"><Icon name="alert" size={14} /> SAP plant {line.plant || 'is missing'}. Choose the unit so the right plant link shows it.</p>}

      <h3 className="sub-head">Milestones</h3>
      <p className="hint">Tick a step when it happens. Dates are optional and can be planned ahead; plants see them as tentative.</p>
      <div className="ms-list">
        {STEPS.map((step) => {
          const sap = step.key === 'orderPlaced' || step.key === 'receipt'
          const mode = step.key === 'orderPlaced' ? 'orderMode' : 'receiptMode'
          const transportOpen = step.key === 'transit' && (form.transitDone || form.transporterName || form.driverPhone || form.lrNumber)
          return (
            <div className="ms-block" key={step.key}>
              <div className={`ms-row${form[`${step.key}Done`] ? ' done' : ''}`}>
                <Toggle checked={Boolean(form[`${step.key}Done`])} onChange={(value) => tick(step.key, value)} label={step.label} />
                <input type="date" aria-label={`${step.label} date`} value={form[`${step.key}Date`] || ''} onChange={(event) => patch({ [`${step.key}Date`]: event.target.value })} />
                {sap && (form[mode] === 'sap' ? (
                  <span className="pill-sap" title="Follows SAP until you change it">SAP</span>
                ) : (
                  <button
                    type="button"
                    className="text-btn small"
                    onClick={() => patch(step.key === 'orderPlaced'
                      ? { orderMode: 'sap', orderPlacedDone: form.orderPlacedAuto }
                      : { receiptMode: 'sap', receiptDone: form.receiptAuto })}
                  >
                    Follow SAP
                  </button>
                ))}
              </div>
              {transportOpen && (
                <div className="transport-form">
                  <p className="transport-title"><Icon name="truck" size={14} /> Transport details <span className="muted">· shown to the plant</span></p>
                  <div className="form-grid three">
                    <label className="field">
                      Transporter name
                      <input value={form.transporterName || ''} maxLength={120} onChange={(event) => patch({ transporterName: event.target.value })} placeholder="e.g. VRL Logistics" />
                    </label>
                    <label className="field">
                      Driver phone number
                      <input type="tel" inputMode="tel" value={form.driverPhone || ''} maxLength={20} onChange={(event) => patch({ driverPhone: event.target.value })} placeholder="98xxxxxxxx" />
                    </label>
                    <label className="field">
                      LR No.
                      <input value={form.lrNumber || ''} maxLength={40} onChange={(event) => patch({ lrNumber: event.target.value })} placeholder="Lorry receipt number" />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <label className="field">
        Note for the plant
        <textarea rows="2" maxLength={500} value={form.remark} onChange={(event) => patch({ remark: event.target.value })} placeholder="Shown on the plant link" />
      </label>

      <SpecialPanel line={line} onMark={async (body) => onSaved(await api.markSpecial({ ...body, id: line.id }))} />

      {error && <p className="error"><Icon name="alert" size={15} /> {error}</p>}
      <div className={`save-bar${dirty ? ' show' : ''}`}>
        <button type="button" className="btn" onClick={save} disabled={!dirty || busy}>
          <Icon name="check" size={16} /> {busy ? 'Saving…' : 'Save'}
          <kbd className="on-dark">Ctrl S</kbd>
        </button>
        <button type="button" className="btn ghost" disabled={!dirty || busy} onClick={() => setForm(base)}>Discard</button>
        <span className="grow" />
        <button type="button" className="text-btn danger small" onClick={remove} disabled={busy}><Icon name="trash" size={14} /> Remove</button>
      </div>
    </section>
  )
}

// ---------- add line ----------

const BLANK_LINE = { company: 'TPL', indentNo: '', indentItem: '10', material: '', shortText: '', quantity: '', unit: '', vendorName: '', plant: '' }

function AddLine({ onClose, onCreated }) {
  const [form, setForm] = useState(BLANK_LINE)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onCreated(await api.createLine(form))
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <form className="modal wide" onSubmit={submit} aria-label="Add a material line">
        <div className="modal-title">
          <h3>Add a material line</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <p className="muted small">For items not yet in SAP. Enter an indent number or a material code.</p>
        <div className="form-grid three">
          <label className="field">Unit<select value={form.company} onChange={set('company')}>{PLANTS.map((plant) => <option key={plant.id} value={plant.id}>{plant.label}</option>)}</select></label>
          <label className="field">Indent number<input value={form.indentNo} onChange={set('indentNo')} autoFocus /></label>
          <label className="field">Item<input value={form.indentItem} onChange={set('indentItem')} /></label>
          <label className="field">Material code<input value={form.material} onChange={set('material')} /></label>
          <label className="field span2">Description<input value={form.shortText} onChange={set('shortText')} /></label>
          <label className="field">Quantity<input inputMode="decimal" value={form.quantity} onChange={set('quantity')} /></label>
          <label className="field">Unit of measure<input value={form.unit} onChange={set('unit')} placeholder="KG, NOS" /></label>
          <label className="field">SAP plant<input value={form.plant} onChange={set('plant')} placeholder="1100" /></label>
          <label className="field span3">Supplier<input value={form.vendorName} onChange={set('vendorName')} /></label>
        </div>
        {error && <p className="error"><Icon name="alert" size={15} /> {error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn" type="submit" disabled={busy || (!form.indentNo && !form.material)}>{busy ? 'Adding…' : 'Add line'}</button>
        </div>
      </form>
    </div>
  )
}

// ---------- overview ----------

function Overview({ lines, notices, onFilter, onOpen }) {
  const counts = bucketCounts(lines)
  const kpis = [
    { id: 'indent', label: 'Indent – no PO yet', value: counts.indent, tone: 'indent', icon: 'file' },
    { id: 'late', label: 'Indent pending > 7 days', value: counts.late, tone: 'late', icon: 'clock', hint: 'no PO, raised over 7 working days ago' },
    { id: 'po-open', label: 'PO placed – not fully received', value: counts['po-open'], tone: 'waiting', icon: 'truck', hint: `${counts.open} nothing yet · ${counts.partial} part received` },
    { id: 'overdue', label: 'Past SAP delivery date', value: counts.overdue, tone: 'late', icon: 'alert', hint: 'PO not fully received' },
    { id: 'received', label: 'Fully received', value: counts.received, tone: 'received', icon: 'check' },
    { id: 'special', label: 'Special effort', value: counts.special, tone: 'special', icon: 'star' },
  ]
  const units = [...PLANTS.map((plant) => plant.id), ...(lines.some((line) => line.company === 'Unassigned') ? ['Unassigned'] : [])]
  const inFlight = lines.filter((line) => line.poNumber && !line.flags.unloaded)
  const funnel = STEPS.map((step) => ({ ...step, count: inFlight.filter((line) => currentStage(line)?.key === step.key).length }))
  const maxFunnel = Math.max(1, ...funnel.map((step) => step.count))
  const attention = sortLines(lines.filter((line) => line.special || isOverdue(line) || isLateIndent(line))).slice(0, 8)
  const toneBucket = { indent: 'indent', late: 'late', waiting: 'open', partial: 'partial', received: 'received' }

  return (
    <div className="overview">
      <section className="kpis">
        {kpis.map((kpi) => (
          <button type="button" key={kpi.id} className={`kpi tone-${kpi.tone}`} onClick={() => onFilter({ bucket: kpi.bucket || kpi.id })}>
            <span className="kpi-icon"><Icon name={kpi.icon} size={18} fill={kpi.icon === 'star'} /></span>
            <span className="kpi-label">{kpi.label}</span>
            <strong>{kpi.value}</strong>
            {kpi.hint && <small>{kpi.hint}</small>}
          </button>
        ))}
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>By unit</h2><span className="muted small">Click a colour to filter</span></div>
          <div className="unit-bars">
            {units.map((unit) => {
              const rows = lines.filter((line) => line.company === unit)
              return (
                <div className="unit-bar" key={unit}>
                  <button type="button" className="unit-bar-name" onClick={() => onFilter({ plant: unit, bucket: 'all' })}>
                    <strong>{plantLabel(unit)}</strong><span>{rows.length}</span>
                  </button>
                  <StackBar lines={rows} onPick={(tone) => onFilter({ plant: unit, bucket: toneBucket[tone] })} />
                </div>
              )
            })}
          </div>
          <ToneKey />
        </section>

        <section className="card">
          <div className="card-head"><h2>Next step for open POs</h2><span className="muted small">{inFlight.length} in flight</span></div>
          <div className="funnel">
            {funnel.map((step) => (
              <button type="button" key={step.key} className="funnel-row" onClick={() => onFilter({ bucket: `stage:${step.key}` })} disabled={!step.count}>
                <span className="funnel-label">{step.label}</span>
                <span className="funnel-track"><span className="funnel-fill" style={{ width: `${(step.count / maxFunnel) * 100}%` }} /></span>
                <strong>{step.count}</strong>
              </button>
            ))}
          </div>
          <p className="hint">Each PO line is counted at its next step not yet ticked.</p>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Needs attention</h2><span className="muted small">Special, past delivery date, pending {'>'} 7 days</span></div>
          {attention.length === 0 ? <p className="muted pad">Nothing urgent. Well done.</p> : (
            <div className="attention">
              {attention.map((line) => (
                <button type="button" key={line.id} className={`attention-row tone-${statusTone(line)}`} onClick={() => onOpen(line.id)}>
                  <span>
                    <strong>{line.shortText}</strong>
                    <small>{plantLabel(line.company)} · {line.poNumber ? `PO ${line.poNumber}` : `Indent ${line.indentNo || '—'}`}{line.vendorName ? ` · ${line.vendorName}` : ''}</small>
                  </span>
                  <StatusBadge line={line} />
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Recent special updates</h2></div>
          {notices.length === 0 ? <p className="muted pad">No special updates yet.</p> : (
            <ul className="activity">
              {notices.slice(0, 7).map((notice) => (
                <li key={notice.id}>
                  <button type="button" onClick={() => notice.lineId && onOpen(notice.lineId)}>
                    <Icon name="star" size={13} fill />
                    <span>{notice.text}</span>
                    <time>{ago(notice.at)}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

// ---------- milestones list ----------

function LineRow({ line, selected, checked, onOpen, onCheck, onAdvance, busy }) {
  const next = currentStage(line)
  return (
    <div className={`row tone-${statusTone(line)}${selected ? ' on' : ''}${line.special ? ' special' : ''}`}>
      <label className="row-check" onClick={(event) => event.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={(event) => onCheck(line.id, event.target.checked)} aria-label={`Select ${line.shortText}`} />
      </label>
      <button type="button" className="row-main" onClick={() => onOpen(line.id)}>
        <span className="row-title">
          <strong>{line.shortText}</strong>
          <StatusBadge line={line} />
        </span>
        <span className="meta">
          <span className="mono">{line.material || '—'}</span> · {line.company === 'Unassigned' ? `Plant ${line.plant || '—'}` : plantLabel(line.company)}
          {' · '}{line.poNumber ? `PO ${line.poNumber}` : `Indent ${line.indentNo || '—'}`}
          {line.vendorName ? ` · ${line.vendorName}` : ''}
        </span>
        {line.transport && line.flags.transit && !line.flags.receipt && <TransportLine transport={line.transport} />}
        <MiniTrack line={line} />
      </button>
      {next && (
        <button
          type="button"
          className="advance"
          disabled={busy}
          onClick={() => onAdvance(line, next)}
          title={`Tick “${next.label}”${next.date && next.date <= todayISO() ? ` on ${pretty(next.date)}` : ' with today’s date'}`}
        >
          <Icon name="check" size={14} strokeWidth={2.6} /> {next.short}
        </button>
      )}
    </div>
  )
}

function BulkBar({ count, onApply, onClear, busy }) {
  const [step, setStep] = useState('ready')
  const [date, setDate] = useState(todayISO())
  return (
    <div className="bulk-bar" role="region" aria-label="Bulk update">
      <strong>{count} selected</strong>
      <select value={step} onChange={(event) => setStep(event.target.value)} aria-label="Milestone">
        {STEPS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
      <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Date" title="Leave blank to keep each line's date" />
      <button type="button" className="btn small" disabled={busy} onClick={() => onApply(step, true, date)}><Icon name="check" size={14} /> Mark done</button>
      <button type="button" className="btn small ghost" disabled={busy} onClick={() => onApply(step, false)}>Untick</button>
      <button type="button" className="icon-btn" onClick={onClear} aria-label="Clear selection"><Icon name="x" /></button>
    </div>
  )
}

// ---------- upload ----------

const plural = (count, word) => `${count.toLocaleString('en-IN')} ${word}${count === 1 ? '' : 's'}`

function uploadSummary(result) {
  if (result.report !== 'MB51') return `${result.report} · ${plural(result.rows, 'row')}`
  const parts = [`${plural(result.rows, 'receipt')} matched lines on the board`]
  if (result.held) parts.push(`${plural(result.held, 'receipt')} held until ME2L adds those POs`)
  if (result.skipped) parts.push(`${plural(result.skipped, 'older receipt')} for POs not on the board skipped`)
  return `MB51 · ${parts.join(' · ')}`
}

function UploadTab({ data, replaceAll, onUnauthorized }) {
  const { toast, confirm } = useFeedback()
  const [plant, setPlant] = useState('')
  const [drag, setDrag] = useState(false)
  const [queue, setQueue] = useState([])
  const inputRef = useRef(null)
  const running = queue.some((item) => ['reading', 'sending', 'waiting'].includes(item.status))

  // Each source is { name, read() } so dropped files and the bundled samples share one path.
  const sendFiles = async (sources) => {
    if (!plant) {
      toast('Choose the plant first, then add the files.', { tone: 'error' })
      return
    }
    const items = sources.map((source, index) => ({ key: `${Date.now()}-${index}`, name: source.name, status: 'waiting', read: source.read }))
    setQueue((current) => [...items, ...current.filter((item) => item.status === 'done' || item.status === 'error')].slice(0, 12))
    const update = (key, partial) => setQueue((current) => current.map((item) => (item.key === key ? { ...item, ...partial } : item)))
    for (const item of items) {
      update(item.key, { status: 'reading' })
      try {
        const buffer = await item.read()
        // Read the file here in the browser and send only the rows the board needs.
        let parsed = null
        try {
          parsed = await readSapFile(buffer)
        } catch {
          parsed = undefined
        }
        if (parsed === null) throw new Error('This file does not look like ME5A, ME2L, or MB51. Export the list with column headings.')
        update(item.key, { status: 'sending' })
        const result = parsed ? await api.uploadParsed(item.name, parsed, plant) : await api.uploadBuffer(item.name, buffer, plant)
        replaceAll(result)
        update(item.key, { status: 'done', message: uploadSummary(result) })
      } catch (err) {
        if (err.status === 401) onUnauthorized()
        update(item.key, { status: 'error', message: err.message })
      }
    }
  }

  const pick = (fileList) => {
    const files = [...(fileList || [])]
    if (inputRef.current) inputRef.current.value = ''
    if (files.length) sendFiles(files.map((file) => ({ name: file.name, read: () => file.arrayBuffer() })))
  }

  const loadSamples = () => {
    const names = ['ME5A_sample.csv', 'ME2L_sample.csv', 'MB51_sample.csv']
    sendFiles(names.map((name) => ({
      name,
      read: async () => {
        const response = await fetch(`/samples/${name}`)
        if (!response.ok) throw new Error(`${name} could not be loaded.`)
        return response.arrayBuffer()
      },
    })))
  }

  const remove = async (upload) => {
    const ok = await confirm({
      title: `Remove ${upload.filename || upload.report}?`,
      body: `${plantLabel(upload.plant)} is rebuilt from the files that remain. Milestone ticks, notes and special marks stay.`,
      confirmLabel: 'Remove file',
      danger: true,
    })
    if (!ok) return
    try {
      const next = await api.removeUpload(upload.id)
      replaceAll(next)
      toast(next.rebuilt ? `${next.removedFile || next.removed} removed. ${plantLabel(next.plant)} rebuilt.` : `${next.removed} removed. Add the earlier ${plantLabel(next.plant)} files again.`)
    } catch (err) {
      if (err.status === 401) onUnauthorized()
      toast(err.message, { tone: 'error' })
    }
  }

  const clearAll = async () => {
    const ok = await confirm({ title: `Remove every ${plantLabel(plant)} file?`, body: 'Lines from those files leave the board until you add new files. Lines you added by hand stay.', confirmLabel: 'Remove all', danger: true })
    if (!ok) return
    try {
      replaceAll(await api.clearUploads(plant))
      toast(`${plantLabel(plant)} files removed`)
    } catch (err) {
      if (err.status === 401) onUnauthorized()
      toast(err.message, { tone: 'error' })
    }
  }

  const uploads = (data.uploads || []).filter((upload) => !plant || upload.plant === plant)
  const baseline = plant ? data.baselines?.[plant] : null

  return (
    <div className="upload-tab">
      <section className="card">
        <div className="card-head"><h2>Add SAP reports</h2></div>
        <p className="muted">1. Choose the plant. 2. Drop ME5A, ME2L, or MB51 exports (CSV, TXT, or Excel). Files are read in the order you add them.</p>
        <Chips
          label="Plant for this upload"
          value={plant}
          onChange={setPlant}
          items={PLANTS.map((item) => ({ id: item.id, label: item.label, count: (data.uploads || []).filter((upload) => upload.plant === item.id).length }))}
        />
        <div
          className={`drop${drag ? ' on' : ''}${plant ? '' : ' disabled'}`}
          onDragOver={(event) => { event.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={(event) => { event.preventDefault(); setDrag(false); pick(event.dataTransfer.files) }}
          onClick={() => plant && inputRef.current?.click()}
          onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && plant) inputRef.current?.click() }}
          role="button"
          tabIndex={0}
          aria-disabled={!plant}
        >
          <span className="drop-icon"><Icon name="upload" size={26} /></span>
          <strong>{plant ? `Drop files for ${plantLabel(plant)}` : 'Choose a plant above first'}</strong>
          <span className="muted small">or click to browse · ME5A builds indents · ME2L adds POs · MB51 101/103/105 records receipts</span>
          <input ref={inputRef} type="file" accept=".csv,.txt,.tsv,.xlsx,.xls" multiple hidden onChange={(event) => pick(event.target.files)} />
        </div>
        {queue.length > 0 && (
          <ul className="queue">
            {queue.map((item) => (
              <li key={item.key} className={`q-${item.status}`}>
                <Icon name={item.status === 'done' ? 'check' : item.status === 'error' ? 'alert' : 'file'} size={16} />
                <span className="q-name">{item.name}</span>
                <span className="q-msg">{item.status === 'reading' ? 'Reading the file…' : item.status === 'sending' ? 'Saving…' : item.status === 'waiting' ? 'Waiting' : item.message}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="row-actions">
          <button type="button" className="btn ghost small" disabled={!plant || running} onClick={loadSamples}>
            Try the sample reports
          </button>
          <span className="muted small">Templates: <a href="/samples/ME5A_sample.csv" download>ME5A</a> · <a href="/samples/ME2L_sample.csv" download>ME2L</a> · <a href="/samples/MB51_sample.csv" download>MB51</a></span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>{plant ? `${plantLabel(plant)} files` : 'All uploaded files'}</h2>
          {plant && uploads.length > 0 && <button type="button" className="text-btn danger small" onClick={clearAll}>Remove all {plantLabel(plant)} files</button>}
        </div>
        <p className="muted small">Removing a file rebuilds that plant from the files that remain. Each plant keeps its 12 newest files; older ones are folded in permanently.</p>
        {baseline?.lines > 0 && <p className="hint"><Icon name="box" size={14} /> {baseline.lines} lines come from older {plantLabel(plant)} files that were folded in.</p>}
        {uploads.length === 0 ? <p className="muted pad">No files yet.</p> : (
          <ul className="files">
            {uploads.map((upload) => (
              <li key={upload.id}>
                <span className={`file-tag r-${upload.report}`}>{upload.report}</span>
                <span className="file-name">
                  <strong>{upload.filename || upload.report}</strong>
                  <small>{plural(upload.rows || 0, upload.report === 'MB51' ? 'receipt' : 'row')} · {plantLabel(upload.plant) || 'No plant'} · {pretty(upload.at)} · {ago(upload.at)}</small>
                </span>
                <button type="button" className="icon-btn" onClick={() => remove(upload)} aria-label={`Remove ${upload.filename || upload.report}`} title="Remove"><Icon name="trash" size={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------- settings ----------

function PasswordField({ value, onChange, label }) {
  const [show, setShow] = useState(false)
  return (
    <label className="field">
      {label}
      <span className="input-group">
        <input type={show ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" spellCheck="false" />
        <button type="button" className="icon-btn" onClick={() => setShow((current) => !current)} aria-label={show ? 'Hide' : 'Show'}><Icon name={show ? 'eyeOff' : 'eye'} size={16} /></button>
      </span>
    </label>
  )
}

function newPassword(prefix) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  const raw = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('')
  return `${prefix}-${raw.slice(0, 4)}-${raw.slice(4)}`
}

function SettingsTab({ data, replaceAll, onUnauthorized }) {
  const { toast } = useFeedback()
  const [passwords, setPasswords] = useState(data.passwords || {})
  const [plants, setPlants] = useState(() => Object.entries(data.plantMap || {}).map(([plant, company]) => ({ plant, company })))
  const [pin, setPin] = useState({ current: '', next: '', again: '' })
  const [busy, setBusy] = useState('')
  const security = data.security || {}
  const passwordsDirty = PLANTS.some((plant) => (passwords[plant.id] || '') !== (data.passwords?.[plant.id] || ''))
  const mapDirty = JSON.stringify(Object.fromEntries(plants.filter((row) => row.plant.trim()).map((row) => [row.plant.trim(), row.company]))) !== JSON.stringify(data.plantMap || {})

  // Fresh server data only replaces fields that are not being edited.
  useEffect(() => { if (!passwordsDirty) setPasswords(data.passwords || {}) }, [data.passwords]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!mapDirty) setPlants(Object.entries(data.plantMap || {}).map(([plant, company]) => ({ plant, company }))) }, [data.plantMap]) // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (err) => {
    if (err.status === 401) onUnauthorized()
    toast(err.message, { tone: 'error' })
  }

  const linkFor = (id) => `${window.location.origin}/p/${encodeURIComponent(id)}`

  const savePasswords = async () => {
    setBusy('passwords')
    try {
      const next = await api.savePasswords(passwords)
      replaceAll(next)
      setPasswords(next.passwords)
      toast(next.changed?.length ? `Saved. ${next.changed.map(plantLabel).join(', ')} must sign in again.` : 'Passwords saved')
    } catch (err) {
      fail(err)
    } finally {
      setBusy('')
    }
  }

  const savePlants = async () => {
    setBusy('map')
    const plantMap = Object.fromEntries(plants.filter((row) => row.plant.trim()).map((row) => [row.plant.trim(), row.company]))
    try {
      replaceAll(await api.savePlantMap(plantMap))
      toast('Plant mapping saved')
    } catch (err) {
      fail(err)
    } finally {
      setBusy('')
    }
  }

  const changePin = async (event) => {
    event.preventDefault()
    if (pin.next !== pin.again) {
      toast('The new PIN and the repeat do not match.', { tone: 'error' })
      return
    }
    setBusy('pin')
    try {
      await api.changePin(pin.current, pin.next)
      setPin({ current: '', next: '', again: '' })
      toast('PIN changed. Other signed-in desks were signed out.')
      replaceAll(await api.bootstrap())
    } catch (err) {
      if (err.status === 401 && err.message.startsWith('Sign in')) onUnauthorized()
      else toast(err.message, { tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  const importOld = async () => {
    setBusy('import')
    try {
      const next = await api.importBlob()
      replaceAll(next)
      toast(`Imported ${next.imported} lines from the old store${next.kept ? `, kept ${next.kept} added since` : ''}.`)
    } catch (err) {
      fail(err)
    } finally {
      setBusy('')
    }
  }

  const invite = async (id) => {
    const text = `${plantLabel(id)} material status\n${linkFor(id)}\nPassword: ${passwords[id] || ''}`
    if (navigator.share) {
      try {
        await navigator.share({ title: `${plantLabel(id)} material status`, text })
        return
      } catch {
        /* fall back to copying */
      }
    }
    if (await copyText(text)) toast(`${plantLabel(id)} link and password copied`)
  }

  return (
    <div className="settings">
      {(security.defaultPin || security.publishedPasswords?.length > 0 || security.storage === 'temporary') && (
        <section className="card alert-card">
          <Icon name="alert" size={20} />
          <div>
            <strong>Security check</strong>
            <ul>
              {security.defaultPin && <li>The desk still uses the starting PIN. Change it below.</li>}
              {security.publishedPasswords?.length > 0 && <li>{security.publishedPasswords.map(plantLabel).join(', ')} still {security.publishedPasswords.length === 1 ? 'uses a password' : 'use passwords'} that appeared in public code. Generate new ones below.</li>}
              {security.storage === 'temporary' && <li>The server has no database connected, so changes can be lost when it restarts.</li>}
            </ul>
          </div>
        </section>
      )}

      {security.oldBlob && (
        <section className="card">
          <div className="card-head"><h2>Bring back the old data</h2></div>
          <p className="muted small">
            The board now lives in Supabase. The earlier materials, files and notes are still in the old Vercel Blob store, which Vercel
            blocks until its monthly limits reset. Once it opens again, this copies them in. Lines added here since then are kept, and
            passwords, the PIN and sign-ins stay as they are now.
          </p>
          <div className="row-actions">
            <button type="button" className="btn" disabled={busy === 'import'} onClick={importOld}>
              <Icon name="download" size={16} /> {busy === 'import' ? 'Importing…' : 'Import from old store'}
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>Plant links</h2></div>
        <p className="muted small">Each plant has its own link and password. TCL (JDM+JDCL) sees both JDM and JDCL. Changing a password signs that plant out on every device.</p>
        <div className="plant-access">
          {PLANTS.map((plant) => (
            <div className="access-row" key={plant.id}>
              <div className="access-name">
                <strong>{plant.label}</strong>
                <code>{linkFor(plant.id)}</code>
              </div>
              <PasswordField label="Password" value={passwords[plant.id] || ''} onChange={(value) => setPasswords((current) => ({ ...current, [plant.id]: value }))} />
              <div className="access-actions">
                <button type="button" className="icon-btn" title="New random password" aria-label="New random password" onClick={() => setPasswords((current) => ({ ...current, [plant.id]: newPassword(plant.id.replace('TCL-', '')) }))}><Icon name="refresh" size={16} /></button>
                <button type="button" className="icon-btn" title="Copy link" aria-label="Copy link" onClick={async () => { if (await copyText(linkFor(plant.id))) toast(`${plant.label} link copied`) }}><Icon name="link" size={16} /></button>
                <button type="button" className="btn small ghost" onClick={() => invite(plant.id)} disabled={passwordsDirty} title={passwordsDirty ? 'Save the passwords first' : ''}><Icon name="share" size={14} /> Share</button>
              </div>
            </div>
          ))}
        </div>
        <div className="row-actions">
          <button type="button" className="btn" onClick={savePasswords} disabled={!passwordsDirty || busy === 'passwords'}>{busy === 'passwords' ? 'Saving…' : 'Save passwords'}</button>
          {passwordsDirty && <button type="button" className="btn ghost" onClick={() => setPasswords(data.passwords || {})}>Discard</button>}
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Desk PIN</h2></div>
          <form onSubmit={changePin} className="stack-form">
            <PasswordField label="Current PIN" value={pin.current} onChange={(value) => setPin((current) => ({ ...current, current: value }))} />
            <PasswordField label="New PIN (6+ characters)" value={pin.next} onChange={(value) => setPin((current) => ({ ...current, next: value }))} />
            <PasswordField label="Repeat new PIN" value={pin.again} onChange={(value) => setPin((current) => ({ ...current, again: value }))} />
            <button type="submit" className="btn" disabled={busy === 'pin' || !pin.current || pin.next.length < 6}><Icon name="key" size={16} /> Change PIN</button>
          </form>
        </section>

        <section className="card">
          <div className="card-head"><h2>SAP plant → unit</h2></div>
          <p className="muted small">Used when a SAP row has a plant code and purchase has not set the unit by hand.</p>
          <div className="map-rows">
            {plants.map((row, index) => (
              <div className="map-row" key={index}>
                <input value={row.plant} placeholder="1100" aria-label="SAP plant" onChange={(event) => setPlants((current) => current.map((item, i) => (i === index ? { ...item, plant: event.target.value } : item)))} />
                <Icon name="arrowRight" size={16} />
                <select value={row.company} aria-label="Unit" onChange={(event) => setPlants((current) => current.map((item, i) => (i === index ? { ...item, company: event.target.value } : item)))}>
                  {PLANTS.map((plant) => <option key={plant.id} value={plant.id}>{plant.label}</option>)}
                </select>
                <button type="button" className="icon-btn" aria-label="Remove row" onClick={() => setPlants((current) => current.filter((_, i) => i !== index))}><Icon name="x" size={16} /></button>
              </div>
            ))}
          </div>
          <div className="row-actions">
            <button type="button" className="btn ghost small" onClick={() => setPlants((current) => [...current, { plant: '', company: 'TPL' }])}><Icon name="plus" size={14} /> Add plant</button>
            <button type="button" className="btn small" onClick={savePlants} disabled={!mapDirty || busy === 'map'}>Save mapping</button>
          </div>
        </section>
      </div>
    </div>
  )
}

// ---------- desk ----------

function Desk({ onUnauthorized }) {
  const { toast, confirm } = useFeedback()
  const now = useNow(20000)
  const [tab, setTab] = useState('overview')
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [query, setQuery] = useState('')
  const [bucket, setBucket] = useState('all')
  const [plant, setPlant] = useState('all')
  const [sort, setSort] = useState('priority')
  const [checked, setChecked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(null)
  const [adding, setAdding] = useState(false)
  const dirtyRef = useRef(false)
  const setDirty = useCallback((value) => { dirtyRef.current = value }, [])
  const searchRef = useRef(null)
  useSlashFocus(searchRef)

  const versionRef = useRef(null)
  const replaceAll = useCallback((next) => {
    if (!next) return
    versionRef.current = next.version || null
    setData(next)
    setLoadedAt(next.serverTime || new Date().toISOString())
    setLoadError('')
  }, [])

  const fail = useCallback((err) => {
    if (err.status === 401) {
      setToken('')
      onUnauthorized()
      return
    }
    toast(err.message, { tone: 'error' })
  }, [onUnauthorized, toast])

  const load = useCallback(async (manual) => {
    if (manual) setRefreshing(true)
    try {
      const next = await api.bootstrap(versionRef.current)
      if (next) replaceAll(next)
      else setLoadedAt(new Date().toISOString())
    } catch (err) {
      if (err.status === 401) fail(err)
      else setLoadError(err.message)
    } finally {
      setRefreshing(false)
    }
  }, [fail, replaceAll])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 45000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  useEffect(() => {
    const onLeave = (event) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [])

  const guard = async () => {
    if (!dirtyRef.current) return true
    const ok = await confirm({ title: 'Discard unsaved changes?', body: 'The milestones you edited on this line have not been saved.', confirmLabel: 'Discard', danger: true })
    if (ok) dirtyRef.current = false
    return ok
  }

  const open = async (id) => {
    if (id === selectedId) return
    if (!(await guard())) return
    setSelectedId(id)
    setTab('lines')
  }

  const close = async () => {
    if (!(await guard())) return
    setSelectedId(null)
  }

  const goTab = async (next) => {
    if (next !== 'lines' && !(await guard())) return
    if (next !== 'lines') setSelectedId(null)
    setTab(next)
  }

  const lines = data?.lines || []
  const selected = lines.find((line) => line.id === selectedId) || null

  const scoped = useMemo(() => lines.filter((line) => plant === 'all' || line.company === plant), [lines, plant])
  const counts = useMemo(() => bucketCounts(scoped.filter((line) => matchesQuery(line, query))), [scoped, query])
  const worklist = useMemo(() => {
    const rows = scoped.filter((line) => {
      if (bucket.startsWith('stage:')) {
        if (!line.poNumber || currentStage(line)?.key !== bucket.slice(6)) return false
      } else if (!matchesBucket(line, bucket)) return false
      return matchesQuery(line, query)
    })
    return sortLines(rows, sort)
  }, [scoped, bucket, query, sort])

  const toggleCheck = (id, value) => setChecked((current) => {
    const next = new Set(current)
    if (value) next.add(id)
    else next.delete(id)
    return next
  })
  const allChecked = worklist.length > 0 && worklist.every((line) => checked.has(line.id))

  const advance = async (line, stage) => {
    setBusy(true)
    setCooldown(line.id)
    setTimeout(() => setCooldown((current) => (current === line.id ? null : current)), 1500)
    const today = todayISO()
    // A past planned date is kept; a missing or future one becomes today.
    const setDate = !stage.date || stage.date > today
    try {
      replaceAll(await api.bulk([line.id], stage.key, true, setDate ? today : undefined))
      const followsSap = (stage.key === 'orderPlaced' && line.editor.orderPlacedFollowsSap) || (stage.key === 'receipt' && line.editor.receiptFollowsSap)
      const undo = {
        label: 'Undo',
        run: async () => {
          try {
            replaceAll(await api.saveLine(line.id, {
              [`${stage.key}Done`]: followsSap ? null : false,
              ...(setDate ? { [`${stage.key}Date`]: stage.date || '' } : {}),
            }))
            toast('Undone')
          } catch (err) {
            fail(err)
          }
        },
      }
      const addTransport = { label: 'Add LR details', run: () => open(line.id) }
      toast(`${stage.label} ticked · ${line.shortText}`, {
        actions: stage.key === 'transit' && !line.transport ? [addTransport, undo] : [undo],
      })
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const applyBulk = async (step, done, date) => {
    const ids = [...checked]
    setBusy(true)
    try {
      const next = await api.bulk(ids, step, done, done ? date || undefined : undefined)
      replaceAll(next)
      setChecked(new Set())
      toast(`${STEPS.find((item) => item.key === step)?.label} ${done ? 'ticked' : 'unticked'} on ${next.updated} line${next.updated === 1 ? '' : 's'}`)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  const filterFrom = (next) => {
    setBucket(next.bucket ?? 'all')
    setPlant(next.plant ?? 'all')
    setQuery('')
    setSelectedId(null)
    setTab('lines')
  }

  const logout = async () => {
    if (!(await guard())) return
    try { await api.logout() } catch { /* the local token is cleared anyway */ }
    setToken('')
    onUnauthorized()
  }

  const security = data?.security
  const needsSecurity = security && (security.defaultPin || security.publishedPasswords?.length > 0)
  const stageFilter = bucket.startsWith('stage:') ? STEPS.find((step) => step.key === bucket.slice(6)) : null

  return (
    <div className="app buyer">
      <header className="topbar">
        <a className="brand" href="/buyer" onClick={(event) => { event.preventDefault(); goTab('overview') }}>
          <Logo />
          <span><strong>Purchase desk</strong><small>Material tracking</small></span>
        </a>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((item) => (
            <button type="button" key={item.id} className={tab === item.id ? 'on' : ''} onClick={() => goTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}>
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {item.id === 'settings' && needsSecurity && <i className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <button type="button" className={`sync${refreshing ? ' spinning' : ''}`} onClick={() => load(true)} title="Refresh now">
            <Icon name="refresh" size={15} />
            <span>{loadedAt ? ago(loadedAt, now) : 'Loading'}</span>
          </button>
          <NoticeBell notices={data?.notices || []} onOpen={open} scope="buyer" />
          <ThemeToggle />
          <button type="button" className="icon-btn" onClick={logout} title="Sign out" aria-label="Sign out"><Icon name="logout" /></button>
        </div>
      </header>

      <main className="wrap">
        {loadError && !data && (
          <div className="card error-card">
            <Icon name="alert" /> <span>{loadError}</span>
            <button type="button" className="btn small" onClick={() => load(true)}>Try again</button>
          </div>
        )}
        {needsSecurity && tab !== 'settings' && (
          <button type="button" className="banner warn" onClick={() => goTab('settings')}>
            <Icon name="alert" size={16} />
            <span>{security.defaultPin ? 'The desk still uses the starting PIN' : 'Some plant passwords appeared in public code'}. Fix it in Settings.</span>
            <Icon name="chevron" size={16} />
          </button>
        )}
        {!data && !loadError && <Skeleton rows={6} />}

        {data && tab === 'overview' && <Overview lines={lines} notices={data.notices || []} onFilter={filterFrom} onOpen={open} />}

        {data && tab === 'lines' && (
          <div className={`split-view${selected ? ' has-detail' : ''}`}>
            <section className="list-pane">
              <div className="list-head">
                <h1>Milestones</h1>
                <button type="button" className="btn small" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add line</button>
              </div>
              <div className="toolbar">
                <SearchBox value={query} onChange={setQuery} placeholder="Search indent, PO, material, supplier" inputRef={searchRef} />
                <select value={plant} onChange={(event) => setPlant(event.target.value)} aria-label="Unit">
                  <option value="all">All units</option>
                  {PLANTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  {lines.some((line) => line.company === 'Unassigned') && <option value="Unassigned">Unassigned</option>}
                </select>
                <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort">
                  {SORTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </div>
              <StatusFilters value={bucket} onChange={setBucket} counts={counts} />
              {stageFilter && (
                <p className="filter-note">Showing PO lines whose next step is <strong>{stageFilter.label}</strong>. <button type="button" className="text-btn small" onClick={() => setBucket('all')}>Clear</button></p>
              )}
              <div className="list-meta">
                <label className="check-all">
                  <input type="checkbox" checked={allChecked} onChange={(event) => setChecked(event.target.checked ? new Set(worklist.map((line) => line.id)) : new Set())} />
                  <span>{worklist.length} line{worklist.length === 1 ? '' : 's'}</span>
                </label>
                <span className="muted small">Tip: the button on the right ticks the next step</span>
              </div>
              {checked.size > 0 && <BulkBar count={checked.size} busy={busy} onApply={applyBulk} onClear={() => setChecked(new Set())} />}
              <div className="rows">
                {worklist.map((line) => (
                  <LineRow
                    key={line.id}
                    line={line}
                    selected={line.id === selectedId}
                    checked={checked.has(line.id)}
                    onOpen={open}
                    onCheck={toggleCheck}
                    onAdvance={advance}
                    busy={busy || cooldown === line.id}
                  />
                ))}
                {worklist.length === 0 && (
                  <EmptyState
                    title={lines.length ? 'No lines match' : 'The board is empty'}
                    text={lines.length ? 'Try another status, unit, or search.' : 'Upload SAP reports or add a line by hand.'}
                    action={lines.length ? <button type="button" className="btn ghost small" onClick={() => { setBucket('all'); setPlant('all'); setQuery('') }}>Clear filters</button> : null}
                  />
                )}
              </div>
            </section>
            {selected && (
              <Editor
                line={selected}
                onClose={close}
                onDirty={setDirty}
                onSaved={(next, err) => (err ? fail(err) : replaceAll(next))}
                onRemoved={(next) => { dirtyRef.current = false; replaceAll(next); setSelectedId(null) }}
              />
            )}
          </div>
        )}

        {data && tab === 'upload' && <UploadTab data={data} replaceAll={replaceAll} onUnauthorized={() => fail({ status: 401 })} />}
        {data && tab === 'settings' && <SettingsTab data={data} replaceAll={replaceAll} onUnauthorized={() => fail({ status: 401 })} />}
      </main>

      {adding && (
        <AddLine
          onClose={() => setAdding(false)}
          onCreated={(next) => {
            replaceAll(next)
            setAdding(false)
            setSelectedId(next.id)
            toast('Line added')
          }}
        />
      )}
    </div>
  )
}

export default function BuyerApp() {
  const [authed, setAuthed] = useState(Boolean(getToken()))
  useEffect(() => { document.title = 'Purchase desk · Material Tracking' }, [])
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  return <Desk onUnauthorized={() => setAuthed(false)} />
}
