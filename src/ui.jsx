import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

// ---------- icons ----------

const PATHS = {
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3',
  bell: 'M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9zm4 11a2 2 0 0 0 4 0',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2m0 18v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M1 12h2m18 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16m0 5v-5h5M3 12a9 9 0 0 1 15.5-6.2L21 8m0-5v5h-5',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m14-7-5-5-5 5m5-5v12',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm9 18 6-6-6-6',
  down: 'm6 9 6 6 6-6',
  back: 'm15 18-6-6 6-6',
  star: 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8m-4-6-4-4-4 4m4-4v13',
  sliders: 'M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6',
  truck: 'M1 3h15v13H1zm15 5h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm13 0a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  box: 'M21 16V8l-9-5-9 5v8l9 5zM3.3 7 12 12l8.7-5M12 22V12',
  grid: 'M3 3h7v7H3zm11 0h7v7h-7zm0 11h7v7h-7zM3 14h7v7H3z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.2-1.3L14.3 3h-4l-.4 2.4a7.5 7.5 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7.5 7.5 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4m0 4h.01',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zm11 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.9 17.9A10.1 10.1 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22M14.1 14.1a3 3 0 1 1-4.2-4.2',
  trash: 'M3 6h18m-2 0-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6M8 13h8M8 17h5',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-16v6l4 2',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  arrowRight: 'M5 12h14m-6-6 6 6-6 6',
  install: 'M12 3v12m-5-5 5 5 5-5M5 21h14',
}

export function Icon({ name, size = 18, className = '', fill = false, strokeWidth = 2 }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] || ''} />
    </svg>
  )
}

export function Logo({ size = 36 }) {
  return (
    <span className="logo" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="box" size={Math.round(size * 0.56)} strokeWidth={2.2} />
    </span>
  )
}

// ---------- theme ----------

const THEME_KEY = 'mattrack-theme'

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || ''
  } catch {
    return ''
  }
}

export function applyStoredTheme() {
  const theme = readTheme()
  if (theme) document.documentElement.dataset.theme = theme
}

export function ThemeToggle() {
  const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const [theme, setTheme] = useState(() => readTheme() || (systemDark() ? 'dark' : 'light'))
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* the choice just won't be remembered */
    }
  }
  return (
    <button type="button" className="icon-btn" onClick={flip} title={theme === 'dark' ? 'Light theme' : 'Dark theme'} aria-label="Switch colour theme">
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  )
}

// ---------- toasts and confirm ----------

const FeedbackContext = createContext(null)

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [ask, setAsk] = useState(null)
  const seq = useRef(0)

  const dismiss = useCallback((id) => setToasts((list) => list.filter((item) => item.id !== id)), [])

  const toast = useCallback((message, options = {}) => {
    seq.current += 1
    const id = seq.current
    const item = { id, message, tone: options.tone || 'success', action: options.action }
    setToasts((list) => [...list.slice(-3), item])
    setTimeout(() => dismiss(id), options.duration || (options.action ? 6500 : 3800))
    return id
  }, [dismiss])

  const confirm = useCallback((options) => new Promise((resolve) => {
    setAsk({ ...options, resolve })
  }), [])

  const answer = (value) => {
    ask?.resolve(value)
    setAsk(null)
  }

  useEffect(() => {
    if (!ask) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') answer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast ${item.tone}`}>
            <Icon name={item.tone === 'error' ? 'alert' : 'check'} size={16} />
            <span>{item.message}</span>
            {item.action && (
              <button type="button" onClick={() => { dismiss(item.id); item.action.run() }}>
                {item.action.label}
              </button>
            )}
            <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      {ask && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) answer(false) }}>
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <h3 id="confirm-title">{ask.title}</h3>
            {ask.body && <p>{ask.body}</p>}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => answer(false)}>{ask.cancelLabel || 'Cancel'}</button>
              <button type="button" className={`btn${ask.danger ? ' danger' : ''}`} autoFocus onClick={() => answer(true)}>
                {ask.confirmLabel || 'Continue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  )
}

export function useFeedback() {
  return useContext(FeedbackContext)
}

// ---------- small hooks and pieces ----------

export function useNow(interval = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(timer)
  }, [interval])
  return now
}

export function ago(iso, now = Date.now()) {
  if (!iso) return ''
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// Closes a popover when the user clicks elsewhere or presses Escape.
export function useDismiss(open, setOpen) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])
  return ref
}

// "/" jumps to the search box, like most modern web apps.
export function useSlashFocus(ref) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey) return
      const tag = document.activeElement?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      event.preventDefault()
      ref.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ref])
}

export function SearchBox({ value, onChange, placeholder, inputRef, autoFocus }) {
  return (
    <label className="search">
      <Icon name="search" size={16} />
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={placeholder}
      />
      {value ? (
        <button type="button" className="search-x" aria-label="Clear search" onClick={() => onChange('')}>
          <Icon name="x" size={14} />
        </button>
      ) : (
        <kbd>/</kbd>
      )}
    </label>
  )
}

export function Chips({ items, value, onChange, label }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`chip${value === item.id ? ' on' : ''}${item.tone ? ` chip-${item.tone}` : ''}`}
          aria-pressed={value === item.id}
          onClick={() => onChange(item.id)}
        >
          {item.dot && <i className={`dot tone-${item.dot}`} />}
          {item.label}
          {item.count != null && <span className="chip-count">{item.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Skeleton({ rows = 4 }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => <div key={index} className="skeleton" />)}
    </div>
  )
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`toggle${disabled ? ' disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      {label && <span className="toggle-label">{label}</span>}
    </label>
  )
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}
