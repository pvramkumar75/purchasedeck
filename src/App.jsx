import { useEffect, useState } from 'react'
import BuyerApp from './BuyerApp.jsx'
import UserApp from './UserApp.jsx'

export default function App() {
  const [path, setPath] = useState(window.location.pathname)

  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  const go = (to, state = {}) => {
    window.history.pushState(state, '', to)
    setPath(new URL(to, window.location.origin).pathname)
  }

  if (path.startsWith('/buyer')) return <BuyerApp go={go} />
  const scoped = path.match(/^\/p\/([^/]+)(?:\/m\/(.+))?$/)
  if (scoped) {
    return (
      <UserApp
        go={go}
        plantId={decodeURIComponent(scoped[1])}
        lineId={scoped[2] ? decodeURIComponent(scoped[2]) : null}
      />
    )
  }
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/buyer">
          <img src="/favicon.svg" alt="" width="40" height="40" />
          <span>
            <strong>Material Tracking</strong>
            <small>Plant links are shared by purchase</small>
          </span>
        </a>
      </header>
      <main className="wrap narrow">
        <section className="login">
          <h1>Open your plant link</h1>
          <p>Purchase sends a separate link for TPL, TCL-JDM, TCL-JDCL, or TCL (JDM+JDCL). That link shows only your plant.</p>
          <a className="btn" href="/buyer">Purchase desk</a>
        </section>
      </main>
    </div>
  )
}
