const TOKEN_KEY = 'mattrack-buyer-token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export function plantTokenKey(plantId) {
  return `mattrack-plant-${plantId}`
}

export function getPlantToken(plantId) {
  return sessionStorage.getItem(plantTokenKey(plantId)) || ''
}

export function setPlantToken(plantId, token) {
  if (token) sessionStorage.setItem(plantTokenKey(plantId), token)
  else sessionStorage.removeItem(plantTokenKey(plantId))
}

async function request(url, options = {}, auth = { buyer: true, plantId: '' }) {
  const headers = { ...(options.headers || {}) }
  if (options.body) headers['Content-Type'] = 'application/json'
  if (auth.buyer !== false) {
    const token = getToken()
    if (token) headers['x-buyer-token'] = token
  }
  if (auth.plantId) {
    const token = getPlantToken(auth.plantId)
    if (token) headers['x-plant-token'] = token
  }
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
  plantBootstrap: (plantId) => request('/api/bootstrap', {}, { buyer: false, plantId }),
  plantLogin: (plant, password) => request('/api/plant-login', { method: 'POST', body: JSON.stringify({ plant, password }) }, { buyer: false }),
  savePasswords: (passwords) => request('/api/plant-passwords', { method: 'POST', body: JSON.stringify({ passwords }) }),
  login: (pin) => request('/api/login', { method: 'POST', body: JSON.stringify({ pin }) }),
  logout: () => request('/api/logout', { method: 'POST', body: '{}' }),
  saveLine: (id, body) => request('/api/save', { method: 'POST', body: JSON.stringify({ ...body, id }) }),
  createLine: (body) => request('/api/lines', { method: 'POST', body: JSON.stringify(body) }),
  deleteLine: (id, board) => request('/api/remove', { method: 'POST', body: JSON.stringify({ id, board }) }),
  savePlantMap: (plantMap) => request('/api/plant-map', { method: 'PUT', body: JSON.stringify({ plantMap }) }),
  uploadBuffer: (filename, buffer, plant) => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const size = 0x8000
    for (let index = 0; index < bytes.length; index += size) {
      binary += String.fromCharCode(...bytes.subarray(index, index + size))
    }
    return request('/api/upload', {
      method: 'POST',
      body: JSON.stringify({ filename, base64: btoa(binary), plant }),
    })
  },
}
