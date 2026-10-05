import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { COMPANIES, inPeriod, matchFields, pretty, qty, siblingsOf, sortForBoard } from './model.js'
import { EmptyState, MiniTrack, PayBadge, Timeline, TrackingRail } from './visuals.jsx'

const EMPTY = { q: '', indent: '', item: '', supplier: '', eta: '', etd: '', readiness: '' }
const PERIODS = [
  [30, 'Last 30 days'],
  [90, 'Last 90 days'],
  [0, 'All dates'],
]

function statsFor(rows) {
  return {
    total: rows.length,
    waiting: rows.filter((row) => row.awaitingPo).length,
    transit: rows.filter((row) => row.undelivered).length,
    arrived: rows.filter((row) => row.flags.receipt).length,
  }
}

function InstallButton() {
  const [promptEvent, setPromptEvent] = useState(null)
  const [hint, setHint] = useState('')
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault()
      setPromptEvent(event)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  if (standalone) return null

  const install = async () => {
    if (promptEvent) {
      promptEvent.prompt()
      await promptEvent.userChoice
      setPromptEvent(null)
      return
    }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
    setHint(ios ? 'On iPhone or iPad, tap Share, then Add to Home Screen.' : 'In the browser menu, choose Install app or Add to Home Screen.')
  }

  return (
    <div className="install">
      <button type="button" className="btn" onClick={install}>
        Install app
      </button>
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

function PeriodMenu({ days, onChange }) {
  const [open, setOpen] = useState(false)
  const label = PERIODS.find(([value]) => value === days)?.[1] || 'Last 30 days'
  return (
    <div className="period">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="clock" aria-hidden="true">⏱</span>
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul>
          {PERIODS.map(([value, name]) => (
            <li key={value}>
              <button
                type="button"
                className={value === days ? 'on' : ''}
                onClick={() => {
                  onChange(value)
                  setOpen(false)
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Detail({ line, siblings, go }) {
  const close = () => {
    if (window.history.state?.view === 'detail') window.history.back()
    else go('/')
  }
  const copy = async () => {
    const url = `${window.location.origin}/m/${encodeURIComponent(line.id)}`
    if (navigator.share) {
      try {
        await navigator.share({ title: line.shortText, url })
        return
      } catch {
        /* clipboard fallback */
      }
    }
    await navigator.clipboard.writeText(url)
  }
  const groupLabel = line.poNumber ? `Items on PO ${line.poNumber}` : `Items on indent ${line.indentNo || line.id}`

  return (
    <article className="detail">
      <div className="detail-top">
        <button type="button" className="btn ghost" onClick={close}>
          All materials
        </button>
        <button type="button" className="btn ghost" onClick={copy}>
          Share item
        </button>
      </div>
      <p className="eyebrow">{line.company}</p>
      <h2>{line.shortText}</h2>
      <p className="lede">
        <button type="button" className="code" onClick={() => go(`/m/${encodeURIComponent(line.id)}`, { view: 'detail' })}>
          {line.material || 'No code'}
        </button>
        <PayBadge status={line.payment.status} />
      </p>
      <div className="money">
        <div>
          <span>Payment</span>
          <strong>{line.payment.status === 'paid' ? 'Paid' : line.payment.status === 'partial' ? 'Part paid' : 'Unpaid'}</strong>
        </div>
        <div>
          <span>Order value</span>
          <strong>{line.orderValue != null ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(line.orderValue) : '—'}</strong>
        </div>
        <div>
          <span>Expected arrival</span>
          <strong>{pretty(line.dates.expectedArrival || line.dates.eta || line.dates.sapDelivery)}</strong>
        </div>
      </div>
      <TrackingRail stages={line.stages} />
      <Timeline line={line} />
      <dl className="facts">
        <div><dt>Quantity</dt><dd>{qty(line.orderQty ?? line.quantity, line.unit)}</dd></div>
        <div><dt>Still to receive</dt><dd>{line.openQty == null ? '—' : qty(line.openQty, line.unit)}</dd></div>
        <div><dt>Received</dt><dd>{qty(line.receivedQty, line.unit)}</dd></div>
        <div><dt>Supplier</dt><dd>{line.vendorName || '—'}</dd></div>
        <div><dt>Indent</dt><dd>{line.indentNo ? `${line.indentNo} / ${line.indentItem || '—'}` : '—'}</dd></div>
        <div><dt>PO item</dt><dd>{line.poNumber ? `${line.poNumber} / ${line.poItem || '—'}` : '—'}</dd></div>
        <div><dt>Requisitioner</dt><dd>{line.requisitioner || '—'}</dd></div>
        <div><dt>SAP delivery</dt><dd>{pretty(line.dates.sapDelivery)}</dd></div>
      </dl>
      {line.remark && <p className="remark">Note from purchase: {line.remark}</p>}
      <section className="siblings">
        <h3>
          {groupLabel}
          <span>{siblings.length}</span>
        </h3>
        <div className="sib-list">
          {siblings.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === line.id ? 'sib on' : 'sib'}
              onClick={() => go(`/m/${encodeURIComponent(item.id)}`, { view: 'detail' })}
            >
              <strong>{item.shortText}</strong>
              <span>
                {item.material} · Item {item.poItem || item.indentItem || '—'}
              </span>
              <MiniTrack stages={item.stages} statusLabel={item.statusLabel} />
            </button>
          ))}
        </div>
      </section>
    </article>
  )
}

export default function UserApp({ go, lineId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [days, setDays] = useState(30)
  const [company, setCompany] = useState('ALL')
  const [fields, setFields] = useState(EMPTY)

  useEffect(() => {
    let live = true
    api.bootstrap()
      .then((next) => {
        if (live) setData(next)
      })
      .catch((err) => {
        if (live) setError(err.message)
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const selected = data?.lines.find((line) => line.id === lineId)
    document.title = selected ? `${selected.shortText} · Material Tracking` : 'Material Tracking'
    if (lineId) window.scrollTo(0, 0)
  }, [lineId, data])

  const filtered = useMemo(() => {
    const lines = data?.lines || []
    return lines.filter((line) => inPeriod(line, days) && matchFields(line, fields))
  }, [data, days, fields])

  const units = useMemo(() => {
    const names = [...COMPANIES]
    if (filtered.some((line) => line.company === 'Unassigned')) names.push('Unassigned')
    return names
  }, [filtered])

  const visible = useMemo(() => {
    const rows = company === 'ALL' ? filtered : filtered.filter((line) => line.company === company)
    return sortForBoard(rows)
  }, [filtered, company])

  const selected = data?.lines.find((line) => line.id === lineId) || null
  const siblings = siblingsOf(data?.lines || [], selected)
  const activeFilters = Object.values(fields).some(Boolean)
  const set = (key) => (event) => setFields((current) => ({ ...current, [key]: event.target.value }))

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); go('/') }}>
          <img src="/favicon.svg" alt="" width="40" height="40" />
          <span>
            <strong>Material Tracking</strong>
            <small>Live indent status</small>
          </span>
        </a>
        <InstallButton />
      </header>
      <main className={`wrap shell${selected ? ' has-detail' : ''}`}>
        <section className="list-pane">
          <div className="units" role="tablist" aria-label="Units">
            {units.map((name) => {
              const rows = filtered.filter((line) => line.company === name)
              const stats = statsFor(rows)
              return (
                <button
                  type="button"
                  key={name}
                  role="tab"
                  aria-selected={company === name}
                  data-co={name}
                  className={company === name ? 'unit on' : 'unit'}
                  onClick={() => setCompany((current) => (current === name ? 'ALL' : name))}
                >
                  <div className="unit-head">
                    <strong>{name}</strong>
                    <span>{stats.total}</span>
                  </div>
                  <ul>
                    <li><b>{stats.waiting}</b> awaiting PO</li>
                    <li><b>{stats.transit}</b> PO not received</li>
                    <li><b>{stats.arrived}</b> at factory</li>
                  </ul>
                </button>
              )
            })}
          </div>
          <p className="unit-note">
            {company === 'ALL' ? 'Showing every unit. Tap a card to focus that unit.' : `Showing ${company}. Tap the card again to see every unit.`}
          </p>
          <section className="panel">
            <div className="section-head">
              <h2>Materials</h2>
              <PeriodMenu days={days} onChange={setDays} />
            </div>
            <div className="filters">
              <label className="field span">
                Search
                <input value={fields.q} onChange={set('q')} placeholder="Indent, PO, material, supplier" />
              </label>
              <label className="field">
                Indent number
                <input value={fields.indent} onChange={set('indent')} inputMode="numeric" />
              </label>
              <label className="field">
                Item number / code
                <input value={fields.item} onChange={set('item')} placeholder="10 or RM-2201" />
              </label>
              <label className="field">
                Supplier
                <input value={fields.supplier} onChange={set('supplier')} />
              </label>
              <label className="field">
                ETA
                <input type="date" value={fields.eta} onChange={set('eta')} />
              </label>
              <label className="field">
                ETD
                <input type="date" value={fields.etd} onChange={set('etd')} />
              </label>
              <label className="field">
                Readiness
                <input type="date" value={fields.readiness} onChange={set('readiness')} />
              </label>
            </div>
            <div className="result-line">
              <p aria-live="polite">{error ? error : data ? `${visible.length} material${visible.length === 1 ? '' : 's'}` : 'Loading materials…'}</p>
              {activeFilters && (
                <button type="button" className="text-btn" onClick={() => setFields(EMPTY)}>
                  Clear filters
                </button>
              )}
            </div>
            {!data && !error && <p className="muted">Loading materials…</p>}
            {data && visible.length === 0 && (
              <EmptyState
                title={data.lines.length ? 'No materials in this view' : 'No materials yet'}
                text={data.lines.length ? 'Widen the date range or clear an indent, supplier, or date.' : 'Purchase has not published a status yet.'}
              />
            )}
            <div className="rows">
              {visible.map((line) => (
                <button
                  type="button"
                  key={line.id}
                  className={line.id === lineId ? 'row on' : 'row'}
                  onClick={() => go(`/m/${encodeURIComponent(line.id)}`, { view: 'detail' })}
                >
                  <div>
                    <div className="row-title">
                      <h3>{line.shortText}</h3>
                      <PayBadge status={line.payment.status} />
                    </div>
                    <p className="meta">
                      <span className="code-inline">{line.material || '—'}</span>
                      {' · '}
                      Indent {line.indentNo || '—'} / {line.indentItem || '—'}
                      {line.poNumber ? ` · PO ${line.poNumber}` : ''}
                      {' · '}
                      {line.company === 'Unassigned' ? `Plant ${line.plant || 'unassigned'}` : line.company}
                      {line.vendorName ? ` · ${line.vendorName}` : ''}
                    </p>
                    <MiniTrack stages={line.stages} statusLabel={line.statusLabel} />
                  </div>
                  <div className="row-side">
                    <span>ETA</span>
                    <strong>{pretty(line.dates.eta || line.dates.expectedArrival || line.dates.sapDelivery)}</strong>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </section>
        {selected && (
          <Detail line={selected} siblings={siblings} go={go} />
        )}
      </main>
      <footer className="foot wrap">
        <span>Status published for indentors. Install this page on a phone or computer.</span>
        <a href="/buyer">Purchase desk</a>
      </footer>
    </div>
  )
}
