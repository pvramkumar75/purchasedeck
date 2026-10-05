import { pretty } from './model.js'

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
  const middle = line.stages.filter((stage) => stage.key !== 'indent')
  return (
    <ol className="tl">
      <li className="tl-row done">
        <span className="tl-node" />
        <div>
          <strong>Indent raised</strong>
          <small>
            Indent {line.indentNo || '—'}
            {line.indentItem ? ` · Item ${line.indentItem}` : ''}
            {line.poNumber ? ` · PO ${line.poNumber}` : ''}
          </small>
        </div>
        <time>{pretty(line.dates.indent)}</time>
      </li>
      <li className="tl-row progress">
        <span className="tl-node hollow" />
        <div className="progress-block">
          <strong>In progress</strong>
          <ol className="sub">
            {middle.map((stage) => (
              <li key={stage.key} className={stage.current ? 'current' : stage.done ? 'done' : ''}>
                <span className="sub-node">{stage.current ? <Truck /> : stage.done ? <Check /> : null}</span>
                <span className="sub-label">{stage.label}</span>
                <time>{pretty(stage.date)}</time>
              </li>
            ))}
          </ol>
        </div>
      </li>
      <li className="tl-row">
        <span className="tl-node hollow" />
        <div>
          <strong>Expected dispatch</strong>
          <small>From {line.vendorName || 'supplier to be updated'}</small>
        </div>
        <time>{pretty(line.dates.etd)}</time>
      </li>
      <li className="tl-row">
        <span className="tl-node hollow" />
        <div>
          <strong>Expected arrival</strong>
          <small>
            To {line.company}
            {line.plant ? ` · Plant ${line.plant}` : ''}
          </small>
        </div>
        <time>{pretty(line.dates.expectedArrival || line.dates.eta || line.dates.sapDelivery)}</time>
      </li>
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
