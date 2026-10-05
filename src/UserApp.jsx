import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, getPlantToken, setPlantToken } from './api.js'
import {
  COMPANIES,
  PERIODS,
  SORTS,
  STEPS,
  bucketCounts,
  companiesForPlant,
  inPeriod,
  inr,
  isOverdue,
  matchFields,
  matchesBucket,
  plantLabel,
  pretty,
  qty,
  siblingsOf,
  sortLines,
  statusTone,
} from './model.js'
import { Icon, Logo, SearchBox, Skeleton, ThemeToggle, ago, copyText, useFeedback, useNow, useSlashFocus } from './ui.jsx'
import { EmptyState, MiniTrack, NoticeBell, SpecialPanel, StackBar, StatusBadge, StatusFilters, Timeline, ToneKey, TrackingRail, TransportCard, TransportLine } from './visuals.jsx'

const EMPTY = { q: '', indent: '', item: '', supplier: '', ...Object.fromEntries(STEPS.map((step) => [step.key, ''])) }

function InstallButton() {
  const [promptEvent, setPromptEvent] = useState(null)
  const { toast } = useFeedback()
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
    toast(ios ? 'On iPhone or iPad, tap Share, then Add to Home Screen.' : 'In the browser menu, choose Install app or Add to Home Screen.', { tone: 'info', duration: 6000 })
  }

  return (
    <button type="button" className="icon-btn" onClick={install} title="Install app" aria-label="Install app">
      <Icon name="install" />
    </button>
  )
}

function Detail({ line, siblings, onClose, openLine, onMark }) {
  const { toast } = useFeedback()
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const share = async () => {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: line.shortText, url })
        return
      } catch {
        /* clipboard fallback */
      }
    }
    if (await copyText(url)) toast('Link copied. It opens after the plant password.')
  }
  const groupLabel = line.poNumber ? `Items on PO ${line.poNumber}` : `Items on indent ${line.indentNo || line.id}`
  const overdue = isOverdue(line)

  return (
    <article className="detail" aria-label={line.shortText}>
      <div className="detail-bar">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Back to all materials"><Icon name="back" /></button>
        <button type="button" className="btn small ghost" onClick={share}><Icon name="share" size={14} /> Share</button>
      </div>
      <div className="detail-head">
        <p className="eyebrow">{plantLabel(line.company)}</p>
        <h2>{line.shortText}</h2>
        <StatusBadge line={line} />
        <p className="meta mono">{line.material || 'No code'}</p>
      </div>
      <TrackingRail stages={line.stages} />
      <div className="hero-stats">
        <div>
          <span>Now</span>
          <strong>{line.statusLabel}</strong>
        </div>
        <div>
          <span>{line.awaitingPo ? 'Expected PO' : 'At Hyderabad'}</span>
          <strong>{pretty(line.awaitingPo ? line.dates.expectedPo : line.dates.hyderabad)}</strong>
        </div>
        <div>
          <span>SAP delivery</span>
          <strong className={overdue ? 'warn' : ''}>{pretty(line.dates.sapDelivery)}{overdue ? ' · overdue' : ''}</strong>
        </div>
        {line.orderValue != null && (
          <div>
            <span>Order value</span>
            <strong>{inr(line.orderValue)}</strong>
          </div>
        )}
      </div>
      {line.transport && <TransportCard transport={line.transport} />}
      {line.remark && <p className="remark"><Icon name="file" size={14} /> <span><strong>Note from purchase:</strong> {line.remark}</span></p>}
      <Timeline line={line} />
      <SpecialPanel line={line} onMark={onMark} />
      <dl className="facts">
        <div><dt>Quantity</dt><dd>{qty(line.orderQty ?? line.quantity, line.unit)}</dd></div>
        <div><dt>Still to receive</dt><dd>{line.openQty == null ? '—' : qty(line.openQty, line.unit)}</dd></div>
        <div><dt>Received</dt><dd>{qty(line.receivedQty, line.unit)}</dd></div>
        <div><dt>Supplier</dt><dd>{line.vendorName || '—'}</dd></div>
        <div><dt>Indent</dt><dd>{line.indentNo ? `${line.indentNo} / ${line.indentItem || '—'}` : '—'}</dd></div>
        <div><dt>PO item</dt><dd>{line.poNumber ? `${line.poNumber} / ${line.poItem || '—'}` : '—'}</dd></div>
        <div><dt>Requisitioner</dt><dd>{line.requisitioner || '—'}</dd></div>
        <div><dt>Updated</dt><dd>{ago(line.updatedAt)}</dd></div>
      </dl>
      {siblings.length > 1 && (
        <section className="siblings">
          <h3>{groupLabel} <span className="count">{siblings.length}</span></h3>
          <div className="sib-list">
            {siblings.map((item) => (
              <button type="button" key={item.id} className={`sib tone-${statusTone(item)}${item.id === line.id ? ' on' : ''}`} onClick={() => openLine(item.id)}>
                <strong>{item.shortText}</strong>
                <span className="meta">{item.material} · Item {item.poItem || item.indentItem || '—'}</span>
                <MiniTrack line={item} />
              </button>
            ))}
          </div>
        </section>
      )}
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
    <div className="auth">
      <div className="auth-top"><ThemeToggle /></div>
      <form className="auth-card" onSubmit={submit}>
        <Logo size={48} />
        <h1>{known ? plantLabel(plantId) : 'Unknown plant'}</h1>
        <p className="muted">{known ? 'Enter the password purchase shared for this plant. You stay signed in on this device for 30 days.' : 'This link is not right. Ask purchase for the plant link.'}</p>
        {known && (
          <label className="field">
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus autoComplete="current-password" />
          </label>
        )}
        {error && <p className="error"><Icon name="alert" size={15} /> {error}</p>}
        {known && <button className="btn wide" type="submit" disabled={busy || !password}>{busy ? 'Checking…' : 'View materials'}</button>}
      </form>
    </div>
  )
}

function PeriodSelect({ value, onChange }) {
  return (
    <label className="select-pill">
      <Icon name="clock" size={15} />
      <select value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label="Period">
        {PERIODS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
  )
}

export default function UserApp({ go, lineId, plantId }) {
  const now = useNow(20000)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [days, setDays] = useState(30)
  const [company, setCompany] = useState('ALL')
  const [fields, setFields] = useState(EMPTY)
  const [bucket, setBucket] = useState('all')
  const [sort, setSort] = useState('priority')
  const [showFilters, setShowFilters] = useState(false)
  const [unlocked, setUnlocked] = useState(() => COMPANIES.includes(plantId) && Boolean(getPlantToken(plantId)))
  const searchRef = useRef(null)
  const versionRef = useRef(null)
  useSlashFocus(searchRef)
  const allowed = useMemo(() => companiesForPlant(plantId), [plantId])
  const homePath = `/p/${encodeURIComponent(plantId)}`

  useEffect(() => {
    setUnlocked(COMPANIES.includes(plantId) && Boolean(getPlantToken(plantId)))
    setData(null)
    versionRef.current = null
    setCompany('ALL')
  }, [plantId])

  const lock = useCallback(() => {
    setPlantToken(plantId, '')
    setUnlocked(false)
    setData(null)
    versionRef.current = null
  }, [plantId])

  const load = useCallback(async (manual) => {
    if (manual) setRefreshing(true)
    try {
      const next = await api.plantBootstrap(plantId, versionRef.current)
      if (next) {
        versionRef.current = next.version || null
        setData(next)
      }
      setLoadedAt(next?.serverTime || new Date().toISOString())
      setError('')
    } catch (err) {
      if (err.status === 401) lock()
      else setError(err.message)
    } finally {
      setRefreshing(false)
    }
  }, [plantId, lock])

  useEffect(() => {
    if (!unlocked) return undefined
    load()
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
  }, [unlocked, load])

  useEffect(() => {
    const selected = data?.lines.find((line) => line.id === lineId)
    document.title = selected ? `${selected.shortText} · ${plantLabel(plantId)}` : `${plantLabel(plantId)} · Material Tracking`
    if (lineId) window.scrollTo(0, 0)
  }, [lineId, data, plantId])

  const lines = useMemo(() => data?.lines || [], [data])
  const filtered = useMemo(() => lines.filter((line) => inPeriod(line, days) && matchFields(line, fields)), [lines, days, fields])
  const scoped = useMemo(() => filtered.filter((line) => allowed.includes(line.company) && (company === 'ALL' || line.company === company)), [filtered, allowed, company])
  const counts = useMemo(() => bucketCounts(scoped), [scoped])
  const visible = useMemo(() => sortLines(scoped.filter((line) => matchesBucket(line, bucket)), sort), [scoped, bucket, sort])

  const selected = lines.find((line) => line.id === lineId) || null
  const siblings = siblingsOf(lines, selected)
  const advancedCount = Object.entries(fields).filter(([key, value]) => key !== 'q' && value).length
  const set = (key) => (event) => setFields((current) => ({ ...current, [key]: event.target.value }))
  const openLine = (id) => go(`${homePath}/m/${encodeURIComponent(id)}`, { view: 'detail' })
  const closeLine = useCallback(() => {
    if (window.history.state?.view === 'detail') window.history.back()
    else go(homePath)
  }, [go, homePath])

  const signOut = async () => {
    try { await api.plantLogout(plantId) } catch { /* local sign-out still happens */ }
    lock()
  }

  if (!unlocked) return <PlantLock plantId={plantId} onUnlock={() => setUnlocked(true)} />

  return (
    <div className="app plant">
      <header className="topbar">
        <a className="brand" href={homePath} onClick={(event) => { event.preventDefault(); go(homePath) }}>
          <Logo />
          <span><strong>{plantLabel(plantId)}</strong><small>Material status</small></span>
        </a>
        <div className="top-actions">
          <button type="button" className={`sync${refreshing ? ' spinning' : ''}`} onClick={() => load(true)} title="Refresh now">
            <Icon name="refresh" size={15} />
            <span>{loadedAt ? ago(loadedAt, now) : 'Loading'}</span>
          </button>
          <NoticeBell notices={data?.notices || []} onOpen={openLine} scope={`plant-${plantId}`} />
          <InstallButton />
          <ThemeToggle />
          <button type="button" className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out"><Icon name="logout" /></button>
        </div>
      </header>

      <main className={`wrap split-view${selected ? ' has-detail' : ''}`}>
        <section className="list-pane">
          {allowed.length > 1 ? (
            <div className="units" role="tablist" aria-label="Units">
              {allowed.map((name) => {
                const rows = filtered.filter((line) => line.company === name)
                return (
                  <button
                    type="button"
                    key={name}
                    role="tab"
                    aria-selected={company === name}
                    className={`unit${company === name ? ' on' : ''}`}
                    onClick={() => setCompany((current) => (current === name ? 'ALL' : name))}
                  >
                    <span className="unit-head"><strong>{plantLabel(name)}</strong><span>{rows.length}</span></span>
                    <StackBar lines={rows} />
                  </button>
                )
              })}
            </div>
          ) : null}

          <div className="list-head">
            <h1>Materials</h1>
            <PeriodSelect value={days} onChange={setDays} />
          </div>

          {data && (
            <section className="summary">
              {[
                ['indent', 'Indent – no PO yet', counts.indent, 'indent'],
                ['po-open', 'PO placed – not fully received', counts['po-open'], 'waiting'],
                ['overdue', 'Past SAP delivery date', counts.overdue, 'late'],
                ['received', 'Fully received', counts.received, 'received'],
              ].map(([id, label, value, tone]) => (
                <button type="button" key={id} className={`mini-kpi tone-${tone}${bucket === id ? ' on' : ''}`} onClick={() => setBucket((current) => (current === id ? 'all' : id))}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </button>
              ))}
            </section>
          )}

          <div className="toolbar">
            <SearchBox value={fields.q} onChange={(value) => setFields((current) => ({ ...current, q: value }))} placeholder="Search indent, PO, material, supplier" inputRef={searchRef} />
            <button type="button" className={`btn ghost small${showFilters ? ' active' : ''}`} onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}>
              <Icon name="sliders" size={15} /> Filters{advancedCount ? <span className="chip-count">{advancedCount}</span> : null}
            </button>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort">
              {SORTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>

          {showFilters && (
            <div className="filter-panel">
              <label className="field">Indent number<input value={fields.indent} onChange={set('indent')} inputMode="numeric" /></label>
              <label className="field">Item or code<input value={fields.item} onChange={set('item')} placeholder="10 or RM-2201" /></label>
              <label className="field">Supplier<input value={fields.supplier} onChange={set('supplier')} /></label>
              {STEPS.map((step) => (
                <label className="field" key={step.key}>{step.label} on<input type="date" value={fields[step.key]} onChange={set(step.key)} /></label>
              ))}
              {advancedCount > 0 && <button type="button" className="text-btn small" onClick={() => setFields((current) => ({ ...EMPTY, q: current.q }))}>Clear these filters</button>}
            </div>
          )}

          <StatusFilters value={bucket} onChange={setBucket} counts={counts} />

          <div className="list-meta">
            <span aria-live="polite">{error || (data ? `${visible.length} material${visible.length === 1 ? '' : 's'}` : 'Loading…')}</span>
            {(advancedCount > 0 || fields.q || bucket !== 'all' || company !== 'ALL') && (
              <button type="button" className="text-btn small" onClick={() => { setFields(EMPTY); setBucket('all'); setCompany('ALL') }}>Clear all</button>
            )}
          </div>

          {!data && !error && <Skeleton rows={5} />}
          {data && visible.length === 0 && (
            <EmptyState
              title={lines.length ? 'No materials in this view' : 'No materials yet'}
              text={lines.length ? 'Try “Everything”, another status, or clear the search.' : 'Purchase has not published a status yet.'}
            />
          )}
          <div className="rows">
            {visible.map((line) => (
              <button
                type="button"
                key={line.id}
                className={`row plain tone-${statusTone(line)}${line.special ? ' special' : ''}${line.id === lineId ? ' on' : ''}`}
                onClick={() => openLine(line.id)}
              >
                <span className="row-main">
                  <span className="row-title">
                    <strong>{line.shortText}</strong>
                    <StatusBadge line={line} />
                  </span>
                  <span className="meta">
                    <span className="mono">{line.material || '—'}</span>
                    {' · '}Indent {line.indentNo || '—'}/{line.indentItem || '—'}
                    {line.poNumber ? ` · PO ${line.poNumber}` : ''}
                    {allowed.length > 1 ? ` · ${plantLabel(line.company)}` : ''}
                    {line.vendorName ? ` · ${line.vendorName}` : ''}
                  </span>
                  {line.transport && line.flags.transit && !line.flags.receipt && <TransportLine transport={line.transport} />}
                  <MiniTrack line={line} />
                </span>
                <span className="row-side">
                  <small>{line.awaitingPo ? 'Expected PO' : 'At Hyderabad'}</small>
                  <strong>{pretty(line.awaitingPo ? line.dates.expectedPo : line.dates.hyderabad)}</strong>
                </span>
              </button>
            ))}
          </div>
          {data && <ToneKey />}
        </section>

        {selected && (
          <Detail
            line={selected}
            siblings={siblings}
            onClose={closeLine}
            openLine={openLine}
            onMark={async (body) => {
              const next = await api.markSpecial({ ...body, id: selected.id }, plantId)
              versionRef.current = next.version || null
              setData(next)
            }}
          />
        )}
      </main>
      <footer className="foot wrap">
        <span>Status published by purchase. Install this page on your phone for quick access.</span>
      </footer>
    </div>
  )
}
