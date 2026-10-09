import { useEffect, useState } from 'react'
import BuyerApp from './BuyerApp.jsx'
import UserApp from './UserApp.jsx'
import { PLANTS, VARIANT } from './model.js'
import { FeedbackProvider, Icon, Logo, ThemeToggle } from './ui.jsx'

function Landing() {
  return (
    <div className="auth">
      <div className="auth-top"><ThemeToggle /></div>
      <div className="auth-card landing">
        <Logo size={52} />
        <h1>{VARIANT.name}</h1>
        <p className="muted">Follow indents from purchase request to factory receipt. Purchase shares a separate link for each plant.</p>
        <div className="landing-plants">
          {PLANTS.map((plant) => (
            <a key={plant.id} href={`/p/${encodeURIComponent(plant.id)}`} className="landing-plant">
              <span>{plant.label}</span>
              <Icon name="chevron" size={16} />
            </a>
          ))}
        </div>
        <p className="muted small">Each plant link asks for the password purchase gave you.</p>
        <a className="btn ghost wide" href="/buyer"><Icon name="key" size={16} /> Purchase desk</a>
      </div>
    </div>
  )
}

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

  let page = <Landing />
  if (path.startsWith('/buyer')) page = <BuyerApp go={go} />
  const scoped = path.match(/^\/p\/([^/]+)(?:\/m\/(.+))?$/)
  if (scoped) {
    page = (
      <UserApp
        go={go}
        plantId={decodeURIComponent(scoped[1])}
        lineId={scoped[2] ? decodeURIComponent(scoped[2]) : null}
      />
    )
  }
  return <FeedbackProvider>{page}</FeedbackProvider>
}
