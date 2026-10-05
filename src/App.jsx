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
  const match = path.match(/^\/m\/(.+)$/)
  const lineId = match ? decodeURIComponent(match[1]) : null
  return <UserApp go={go} lineId={lineId} />
}
