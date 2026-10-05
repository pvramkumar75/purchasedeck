import { useEffect, useMemo, useState } from 'react'
import { api, getPlantToken, setPlantToken } from './api.js'
import { COMPANIES, STATUS_FILTERS, companiesForPlant, inPeriod, matchFields, materialBucket, plantLabel, pretty, qty, siblingsOf, sortForBoard, statusTone } from './model.js'
import { EmptyState, MiniTrack, NoticeBell, SpecialPanel, Timeline, TrackingRail } from './visuals.jsx'

const EMPTY = { q: '', indent: '', item: '', supplier: '', orderPlaced: '', ready: '', transit: '', hyderabad: '', receipt: '', unloaded: '' }
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

function Detail({ line, siblings, go, openLine, homePath, onMark }) {
  const close = () => {
    if (window.history.state?.view === 'detail') window.history.back()
    else go(homePath)
  }
  const copy = async () => {
    const url = window.location.href
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
      <div className="status-hero">
        <p className="eyebrow">{line.company}</p>
        <h2>{line.statusLabel}</h2>
        <TrackingRail stages={line.stages} />
      </div>
      <h3 className="item-name">{line.shortText}</h3>
      <p className="lede">
        <button type="button" className="code" onClick={() => openLine(line.id)}>
          {line.material || 'No code'}
        </button>
      </p>
      <div className="money">
        <div>
          <span>Order value</span>
          <strong>{line.orderValue != null ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(line.orderValue) : '—'}</strong>
        </div>
        <div>
          <span>{line.awaitingPo ? 'Expected PO' : 'Hyderabad'}</span>
          <strong>{pretty(line.awaitingPo ? line.dates.expectedPo : line.dates.hyderabad)}</strong>
        </div>
      </div>
      <Timeline line={line} />
      <SpecialPanel line={line} onMark={onMark} />
      <dl className="facts">
        <div><dt>Quantity</dt><dd>{qty(line.orderQty ?? line.quantity, line.unit)}</dd></div>
        <div><dt>Still to receive</dt><dd>{line.openQty == null ? '—' : qty(line.openQty, line.unit)}</dd></div>
        <div><dt>Received</dt><dd>{qty(line.receivedQty, line.unit)}</dd></div>
        <div><dt>Expected PO</dt><dd>{pretty(line.dates.expectedPo)}</dd></div>
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
              onClick={() => openLine(item.id)}
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

function PlantLock({ plantId, onUnlock }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const known = COMPANIES.includes(plantId)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api.plantLogin(plantId, password)
      setPlantToken(plantId, result.token)
      onUnlock()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" width="40" height="40" />
          <span>
            <strong>{known ? plantLabel(plantId) : 'Material Tracking'}</strong>
            <small>Plant status</small>
          </span>
        </a>
      </header>
      <main className="wrap narrow">
        <form className="login" onSubmit={submit}>
          <h1>{known ? plantLabel(plantId) : 'Unknown plant'}</h1>
          <p>{known ? 'Enter the password purchase shared for this plant.' : 'Ask purchase for the correct plant link.'}</p>
          {known && (
            <label className="field">
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
            </label>
          )}
          {error && <p className="error">{error}</p>}
          {known && <button className="btn" type="submit" disabled={busy}>{busy ? 'Checking…' : 'View materials'}</button>}
        </form>
      </main>
    </div>
  )
}

export default function UserApp({ go, lineId, plantId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [days, setDays] = useState(30)
  const [company, setCompany] = useState('ALL')
  const [fields, setFields] = useState(EMPTY)
  const [bucket, setBucket] = useState('all')
  const [unlocked, setUnlocked] = useState(() => COMPANIES.includes(plantId) && Boolean(getPlantToken(plantId)))
  const allowed = companiesForPlant(plantId)
  const homePath = `/p/${encodeURIComponent(plantId)}`

  useEffect(() => {
    setUnlocked(COMPANIES.includes(plantId) && Boolean(getPlantToken(plantId)))
    setData(null)
    setCompany('ALL')
  }, [plantId])

  useEffect(() => {
    if (!unlocked) return undefined
    let live = true
    api.plantBootstrap(plantId)
      .then((next) => {
        if (live) setData(next)
      })
      .catch((err) => {
        if (!live) return
        if (err.status === 401) {
          setPlantToken(plantId, '')
          setUnlocked(false)
          return
        }
        setError(err.message)
      })
    return () => {
      live = false
    }
  }, [plantId, unlocked])

  useEffect(() => {
    if (!unlocked) return undefined
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      api.plantBootstrap(plantId).then(setData).catch(() => {})
    }, 45000)
    return () => clearInterval(timer)
  }, [plantId, unlocked])

  useEffect(() => {
    const selected = data?.lines.find((line) => line.id === lineId)
    document.title = selected ? `${selected.shortText} · ${plantLabel(plantId)}` : `${plantLabel(plantId)} · Material Tracking`
    if (lineId) window.scrollTo(0, 0)
  }, [lineId, data, plantId])

  const filtered = useMemo(() => {
    const lines = data?.lines || []
    return lines.filter((line) => inPeriod(line, days) && matchFields(line, fields))
  }, [data, days, fields])

  const units = allowed

  const visible = useMemo(() => {
    const scoped = filtered.filter((line) => allowed.includes(line.company) && (bucket === 'all' || (bucket === 'special' ? line.special : materialBucket(line) === bucket)))
    const rows = company === 'ALL' ? scoped : scoped.filter((line) => line.company === company)
    return sortForBoard(rows)
  }, [filtered, company, allowed, bucket])

  const selected = data?.lines.find((line) => line.id === lineId) || null
  const siblings = siblingsOf(data?.lines || [], selected)
  const activeFilters = Object.values(fields).some(Boolean)
  const set = (key) => (event) => setFields((current) => ({ ...current, [key]: event.target.value }))
  const openLine = (id) => go(`${homePath}/m/${encodeURIComponent(id)}`, { view: 'detail' })

  if (!unlocked) return <PlantLock plantId={plantId} onUnlock={() => setUnlocked(true)} />

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={homePath} onClick={(event) => { event.preventDefault(); go(homePath) }}>
          <img src="/favicon.svg" alt="" width="40" height="40" />
          <span>
            <strong>{plantLabel(plantId)}</strong>
            <small>Material status</small>
          </span>
        </a>
        <div className="top-actions">
          <NoticeBell notices={data?.notices || []} onOpen={openLine} />
          <InstallButton />
        </div>
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
                    <strong>{plantLabel(name)}</strong>
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
            {plantId === 'TCL' ? 'This link covers TCL-JDM and TCL-JDCL.' : `This link is only for ${plantLabel(plantId)}.`}
          </p>
          <section className="panel">
            <div className="section-head">
              <h2>Materials</h2>
              <PeriodMenu days={days} onChange={setDays} />
            </div>
            <p className="tone-key">
              <span><i className="indent" /> Indent, within 7 working days</span>
              <span><i className="late" /> Indent older than 7 working days</span>
              <span><i className="waiting" /> PO, material not received</span>
              <span><i className="partial" /> Partial receipt</span>
              <span><i className="received" /> Fully received</span>
            </p>
            <div className="plant-pick" role="group" aria-label="Status filters">
              {STATUS_FILTERS.map((item) => (
                <button type="button" key={item.id} className={bucket === item.id ? 'on' : ''} onClick={() => setBucket(item.id)}>
                  {item.label}
                </button>
              ))}
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
                Order placed
                <input type="date" value={fields.orderPlaced} onChange={set('orderPlaced')} />
              </label>
              <label className="field">
                Ready for dispatch
                <input type="date" value={fields.ready} onChange={set('ready')} />
              </label>
              <label className="field">
                In transit
                <input type="date" value={fields.transit} onChange={set('transit')} />
              </label>
              <label className="field">
                Arrived at Hyderabad
                <input type="date" value={fields.hyderabad} onChange={set('hyderabad')} />
              </label>
              <label className="field">
                Received at factory
                <input type="date" value={fields.receipt} onChange={set('receipt')} />
              </label>
              <label className="field">
                Unloaded
                <input type="date" value={fields.unloaded} onChange={set('unloaded')} />
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
                  className={`row tone-${statusTone(line)}${line.special ? ' special' : ''}${line.id === lineId ? ' on' : ''}`}
                  onClick={() => openLine(line.id)}
                >
                  <div>
                    <MiniTrack stages={line.stages} statusLabel={line.statusLabel} />
                    <div className="row-title">
                      <h3>{line.shortText}</h3>
                    </div>
                    <p className="meta">
                      <span className="code-inline">{line.material || '—'}</span>
                      {' · '}
                      Indent {line.indentNo || '—'} / {line.indentItem || '—'}
                      {line.poNumber ? ` · PO ${line.poNumber}` : ''}
                      {' · '}
                      {line.company === 'Unassigned' ? `Plant ${line.plant || 'unassigned'}` : line.company}
                      {line.vendorName ? ` · ${line.vendorName}` : ''}
                      {line.special ? ' · Special' : ''}
                    </p>
                  </div>
                  <div className="row-side">
                    <span>{line.awaitingPo ? 'Expected PO' : 'Hyderabad'}</span>
                    <strong>{pretty(line.awaitingPo ? line.dates.expectedPo : line.dates.hyderabad)}</strong>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </section>
        {selected && (
          <Detail
            line={selected}
            siblings={siblings}
            go={go}
            openLine={openLine}
            homePath={homePath}
            onMark={async (body) => setData(await api.markSpecial({ ...body, id: selected.id }, plantId))}
          />
        )}
      </main>
      <footer className="foot wrap">
        <span>Status published for indentors. Install this page on a phone or computer.</span>
        <a href="/buyer">Purchase desk</a>
      </footer>
    </div>
  )
}
