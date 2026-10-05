import { useEffect, useState } from 'react'
import { TONES, isOverdue, materialBucket, pretty, progressOf, short, statusTone } from './model.js'
import { Icon, ago, useDismiss } from './ui.jsx'

function seenKey(scope) {
  return `mattrack-seen-notice-${scope}`
}

function readSeen(scope) {
  try {
    return localStorage.getItem(seenKey(scope)) || ''
  } catch {
    return ''
  }
}

export function NoticeBell({ notices, onOpen, scope = 'buyer' }) {
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => readSeen(scope))
  const ref = useDismiss(open, setOpen)
  const list = notices || []
  const unread = list.filter((notice) => notice.at > seen).length
  const toggle = () => {
    setOpen((value) => !value)
    const now = new Date().toISOString()
    setSeen(now)
    try {
      localStorage.setItem(seenKey(scope), now)
    } catch {
      /* unread count resets on reload */
    }
  }
  return (
    <div className="popover-wrap" ref={ref}>
      <button type="button" className="icon-btn" onClick={toggle} aria-expanded={open} aria-label={`Special updates${unread ? `, ${unread} new` : ''}`} title="Special updates">
        <Icon name="bell" />
        {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="popover notice-panel">
          <div className="popover-head">
            <strong>Special updates</strong>
            <span className="muted small">{list.length} total</span>
          </div>
          {list.length === 0 && <p className="muted small pad">Nothing yet. Marked items report changes here.</p>}
          <div className="notice-list">
            {list.map((notice) => (
              <button
                type="button"
                key={notice.id}
                className={`notice-item${notice.at > seen ? ' fresh' : ''}`}
                onClick={() => {
                  setOpen(false)
                  if (notice.lineId) onOpen(notice.lineId)
                }}
              >
                <Icon name="star" size={14} fill />
                <span>{notice.text}</span>
                <time>{ago(notice.at)}</time>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function SpecialPanel({ line, onMark }) {
  const [note, setNote] = useState(line.special?.note || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(Boolean(line.special))
  useEffect(() => {
    setNote(line.special?.note || '')
    setError('')
    setOpen(Boolean(line.special))
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
    <section className={`special-box${line.special ? ' on' : ''}`}>
      <button type="button" className="special-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <Icon name="star" size={16} fill={Boolean(line.special)} />
        <span>
          <strong>{line.special ? 'Special effort' : 'Ask for special effort'}</strong>
          <small>
            {line.special
              ? `Marked ${pretty(line.special.at)} by ${line.special.by === 'buyer' ? 'purchase' : 'the plant'}${line.special.note ? ` · “${line.special.note}”` : ''}`
              : 'Both sides get a notice when this item changes.'}
          </small>
        </span>
        <Icon name="down" size={16} className={open ? 'flip' : ''} />
      </button>
      {open && (
        <div className="special-body">
          <label className="field">
            Note
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this needs special effort" maxLength={240} />
          </label>
          <div className="special-actions">
            <div className="split-btn">
              <button type="button" className="btn small" disabled={busy} onClick={() => run(true, 'item')}>{line.special ? 'Update item' : 'Mark item'}</button>
              {line.indentNo && <button type="button" className="btn small soft" disabled={busy} onClick={() => run(true, 'indent')}>Whole indent</button>}
              {line.poNumber && <button type="button" className="btn small soft" disabled={busy} onClick={() => run(true, 'po')}>Whole PO</button>}
            </div>
            {line.special && (
              <div className="split-btn">
                <button type="button" className="btn small ghost" disabled={busy} onClick={() => run(false, 'item')}>Demark item</button>
                {line.indentNo && <button type="button" className="btn small ghost" disabled={busy} onClick={() => run(false, 'indent')}>Demark indent</button>}
                {line.poNumber && <button type="button" className="btn small ghost" disabled={busy} onClick={() => run(false, 'po')}>Demark PO</button>}
              </div>
            )}
          </div>
          {error && <p className="error small">{error}</p>}
        </div>
      )}
    </section>
  )
}

export function StatusBadge({ line }) {
  const tone = statusTone(line)
  const overdue = isOverdue(line)
  const label = {
    indent: 'Awaiting PO',
    late: 'Late indent',
    waiting: 'Not received',
    partial: 'Partly received',
    received: 'Received',
  }[tone]
  return (
    <span className="badges">
      <span className={`status-badge tone-${tone}`}>{label}</span>
      {overdue && <span className="status-badge tone-late">Overdue</span>}
      {line.special && <span className="status-badge tone-special"><Icon name="star" size={11} fill /> Special</span>}
    </span>
  )
}

export function MiniTrack({ line }) {
  const { done, total, pct } = progressOf(line)
  return (
    <div className="mini" title={`${done} of ${total} steps done`}>
      <div className="mini-steps" aria-hidden="true">
        {line.stages.map((stage) => (
          <i key={stage.key} className={stage.current ? 'current' : stage.done ? 'done' : ''} />
        ))}
      </div>
      <span className="mini-label">{line.statusLabel}</span>
      <em>{pct}%</em>
    </div>
  )
}

export function TrackingRail({ stages, onToggle }) {
  return (
    <ol className="rail">
      {stages.map((stage) => {
        const body = (
          <>
            <span className="rail-node">
              {stage.done ? <Icon name="check" size={14} strokeWidth={3} /> : stage.current ? <Icon name="truck" size={14} /> : null}
            </span>
            <span className="rail-label">{stage.short}</span>
            <span className="rail-date">{stage.date ? short(stage.date) : ''}</span>
          </>
        )
        return (
          <li key={stage.key} className={`rail-step${stage.done ? ' done' : ''}${stage.current ? ' current' : ''}`}>
            {onToggle ? (
              <button type="button" onClick={() => onToggle(stage.key)} title={`${stage.done ? 'Untick' : 'Tick'} ${stage.label}`}>{body}</button>
            ) : (
              <div title={stage.label}>{body}</div>
            )}
          </li>
        )
      })}
    </ol>
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
            {line.requisitioner ? ` · ${line.requisitioner}` : ''}
          </small>
        </div>
        <time>{pretty(line.dates.indent)}</time>
      </li>
      {line.awaitingPo && (
        <li className={`tl-row${line.dates.expectedPo ? '' : ' faint'}`}>
          <span className="tl-node hollow" />
          <div>
            <strong>Expected PO</strong>
            <small>{line.dates.expectedPo ? 'Tentative, set by purchase' : 'Not set yet'}</small>
          </div>
          <time>{pretty(line.dates.expectedPo)}</time>
        </li>
      )}
      {line.stages.map((stage) => (
        <li key={stage.key} className={`tl-row${stage.done ? ' done' : ''}${stage.current ? ' current' : ''}`}>
          <span className={stage.done ? 'tl-node' : 'tl-node hollow'} />
          <div>
            <strong>{stage.label}</strong>
            {stage.key === 'orderPlaced' && (
              <small>{line.poNumber ? `PO ${line.poNumber}${line.poItem ? ` / ${line.poItem}` : ''}` : 'PO not yet placed'}</small>
            )}
            {stage.current && <small className="now">Current step</small>}
          </div>
          <time>{pretty(stage.date)}</time>
        </li>
      ))}
    </ol>
  )
}

export function ToneKey() {
  return (
    <p className="tone-key">
      {TONES.map((tone) => (
        <span key={tone.id}><i className={`dot tone-${tone.id}`} /> {tone.label}</span>
      ))}
    </p>
  )
}

// Horizontal stacked bar of how many lines sit in each status; segments are clickable.
export function StackBar({ lines, onPick, tall }) {
  const parts = [
    ['indent', 'Awaiting PO', lines.filter((line) => statusTone(line) === 'indent').length],
    ['late', 'Late indent', lines.filter((line) => statusTone(line) === 'late').length],
    ['waiting', 'Not received', lines.filter((line) => materialBucket(line) === 'open').length],
    ['partial', 'Partly received', lines.filter((line) => materialBucket(line) === 'partial').length],
    ['received', 'Received', lines.filter((line) => materialBucket(line) === 'received').length],
  ]
  const total = lines.length || 1
  return (
    <div className={`stack${tall ? ' tall' : ''}`} role="img" aria-label={parts.map(([, label, count]) => `${label} ${count}`).join(', ')}>
      {parts.filter(([, , count]) => count > 0).map(([tone, label, count]) => {
        const style = { flexGrow: count / total }
        return onPick ? (
          <button type="button" key={tone} className={`stack-seg tone-${tone}`} style={style} title={`${label}: ${count}`} onClick={(event) => { event.stopPropagation(); onPick(tone) }} />
        ) : (
          <span key={tone} className={`stack-seg tone-${tone}`} style={style} title={`${label}: ${count}`} />
        )
      })}
      {lines.length === 0 && <span className="stack-seg empty" style={{ flexGrow: 1 }} />}
    </div>
  )
}

export function EmptyState({ title, text, action }) {
  return (
    <div className="empty">
      <div className="empty-art" aria-hidden="true"><Icon name="box" size={34} strokeWidth={1.6} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}
