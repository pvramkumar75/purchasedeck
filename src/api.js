const TOKEN_KEY = 'mattrack-buyer-token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request(url, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (options.body) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['x-buyer-token'] = token
  const response = await fetch(url, { ...options, headers })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong.')
    error.status = response.status
    throw error
  }
  return data
}

export const api = {
  bootstrap: () => request('/api/bootstrap'),
  login: (pin) => request('/api/login', { method: 'POST', body: JSON.stringify({ pin }) }),
  logout: () => request('/api/logout', { method: 'POST', body: '{}' }),
  saveLine: (id, body) => request(`/api/lines/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  createLine: (body) => request('/api/lines', { method: 'POST', body: JSON.stringify(body) }),
  deleteLine: (id) => request(`/api/lines/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  savePlantMap: (plantMap) => request('/api/plant-map', { method: 'PUT', body: JSON.stringify({ plantMap }) }),
  uploadBuffer: (filename, buffer) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const size = 0x8000
    for (let index = 0; index < bytes.length; index += size) {
      binary += String.fromCharCode(...bytes.subarray(index, index + size))
    }
    return request('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ filename, base64: btoa(binary) }),
    })
  },
}
