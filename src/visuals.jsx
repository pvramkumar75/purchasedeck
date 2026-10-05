import { useEffect, useState } from 'react'
import { pretty } from './model.js'

const SEEN_KEY = 'mattrack-seen-notice'

function unreadCount(notices) {
  const seen = localStorage.getItem(SEEN_KEY) || ''
  return (notices || []).filter((notice) => notice.at > seen).length
}

export function NoticeBell({ notices, onOpen }) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(() => unreadCount(notices))
  useEffect(() => setUnread(unreadCount(notices)), [notices])
  const toggle = () => {
    setOpen((value) => !value)
    localStorage.setItem(SEEN_KEY, new Date().toISOString())
    setUnread(0)
  }
  return (
    <div className="notice-wrap">
      <button type="button" className="btn ghost" onClick={toggle}>
        Special updates{unread > 0 ? ` (${unread})` : ''}
      </button>
      {open && (
        <div className="notice-panel">
          <strong>Special notifications</strong>
          {(notices || []).length === 0 && <p>No special updates yet.</p>}
          {(notices || []).map((notice) => (
            <button type="button" key={notice.id} className="notice" onClick={() => { setOpen(false); onOpen(notice.lineId) }}>
              <span>{notice.text}</span>
              <time>{pretty(notice.at)}</time>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function SpecialPanel({ line, onMark }) {
  const [note, setNote] = useState(line.special?.note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    setNote(line.special?.note || '')
    setError('')
  }, [line.id, line.special?.at, line.special?.note])
  const run = async (on, scope) => {
    setBusy(true)
    setError('')
    try {
      await onMark({ on, scope, note })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="special-box">
      <div className="section-head">
        <h3>Special effort</h3>
        {line.special && <span className="special-badge">Special</span>}
      </div>
      <p className="hint">{line.special ? `Marked ${pretty(line.special.at)} by ${line.special.by === 'buyer' ? 'purchase' : 'the plant'}. Updates on this item appear as special notifications.` : 'Mark this when purchase should give it special attention. Both sides see later updates as special notifications.'}</p>
      <label className="field">
        Note
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this needs special effort" />
      </label>
      <div className="editor-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => run(true, 'item')}>{line.special ? 'Update item' : 'Mark item'}</button>
        {line.indentNo && <button type="button" className="btn ghost" disabled={busy} onClick={() => run(true, 'indent')}>Mark indent</button>}
        {line.poNumber && <button type="button" className="btn ghost" disabled={busy} onClick={() => run(true, 'po')}>Mark PO</button>}
        {line.special && <button type="button" className="text-btn" disabled={busy} onClick={() => run(false, 'item')}>Clear item</button>}
        {line.special && line.indentNo && <button type="button" className="text-btn" disabled={busy} onClick={() => run(false, 'indent')}>Clear indent</button>}
        {line.special && line.poNumber && <button type="button" className="text-btn" disabled={busy} onClick={() => run(false, 'po')}>Clear PO</button>}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export function Truck() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path fill="currentColor" d="M2.5 7.5h11v7.2h-11z" />
      <path fill="currentColor" d="M13.5 10h3.6l3.4 2.8v2h-7z" />
      <circle cx="7" cy="17.2" r="1.7" fill="currentColor" />
      <circle cx="17" cy="17.2" r="1.7" fill="currentColor" />
    </svg>
  )
}

export function Check() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M5 12.5 9.2 17 19 7" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MiniTrack({ stages, statusLabel }) {
  const done = stages.filter((stage) => stage.done).length
  return (
    <div className="mini">
      <div className="minidots" aria-hidden="true">
        {stages.map((stage) => (
          <i key={stage.key} className={stage.current ? 'current' : stage.done ? 'done' : ''} />
        ))}
      </div>
      <span>{statusLabel}</span>
      <em>
        {done}/{stages.length}
      </em>
    </div>
  )
}

export function TrackingRail({ stages }) {
  return (
    <div className="rail-scroll">
      <div className="rail-track">
        {stages.map((stage, index) => (
          <div key={stage.key} className={`rail-step${stage.done ? ' done' : ''}${stage.current ? ' current' : ''}`}>
            <div className="rail-node" title={stage.label}>
              {stage.current ? <Truck /> : stage.done ? <Check /> : <span className="hollow" />}
            </div>
            {index < stages.length - 1 && <i className="rail-bar" />}
          </div>
        ))}
      </div>
      <div className="rail-pills">
        {stages.map((stage) => (
          <span key={stage.key} className={`pill${stage.done ? ' done' : ''}${stage.current ? ' current' : ''}`}>
            {stage.short}
          </span>
        ))}
      </div>
    </div>
  )
}

export function Timeline({ line }) {
  return (
    <ol className="tl">
      <li className="tl-row done">
        <span className="tl-node" />
        <div>
          <strong>Indent raised</strong>
          <small>
            Indent {line.indentNo || '—'}
            {line.indentItem ? ` · Item ${line.indentItem}` : ''}
          </small>
        </div>
        <time>{pretty(line.dates.indent)}</time>
      </li>
      {line.stages.map((stage) => (
        <li key={stage.key} className={`tl-row${stage.done ? ' done' : ''}${stage.current ? ' current' : ''}`}>
          <span className={stage.done ? 'tl-node' : 'tl-node hollow'} />
          <div>
            <strong>{stage.label}</strong>
            {stage.key === 'orderPlaced' && (
              <small>
                {line.poNumber ? `PO ${line.poNumber}${line.poItem ? ` / ${line.poItem}` : ''}` : 'PO not yet placed'}
                {stage.current ? ' · Current step' : ''}
              </small>
            )}
            {stage.current && stage.key !== 'orderPlaced' && <small>Current step</small>}
          </div>
          <time>{pretty(stage.date)}</time>
        </li>
      ))}
    </ol>
  )
}

export function EmptyState({ title, text }) {
  return (
    <div className="empty">
      <svg className="empty-art" viewBox="0 0 360 210" aria-hidden="true">
        <ellipse cx="86" cy="48" rx="26" ry="12" fill="none" stroke="#9aa6b2" strokeWidth="3" />
        <ellipse cx="262" cy="64" rx="34" ry="14" fill="none" stroke="#9aa6b2" strokeWidth="3" />
        <ellipse cx="180" cy="186" rx="92" ry="12" fill="#e7e4de" />
        <path d="M78 118 180 74l102 44-102 42z" fill="#f0b15a" />
        <path d="M78 118 180 160v34L78 152z" fill="#d8893a" />
        <path d="M282 118 180 160v34l102-42z" fill="#e39a42" />
        <path d="M116 100 180 70l64 30-64 28z" fill="#f7d7a6" />
        <path d="M180 70 146 46l-30 16 64 30z" fill="#f8e4c6" />
        <path d="M180 70 214 46l30 16-64 30z" fill="#f3cb90" />
      </svg>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  )
}
