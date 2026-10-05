const TOKEN_KEY = 'mattrack-buyer-token'
// Vercel refuses request bodies above about 4.5 MB.
const MAX_BODY = 4_300_000

function read(storage, key) {
  try {
    return storage.getItem(key) || ''
  } catch {
    return ''
  }
}

function write(storage, key, value) {
  try {
    if (value) storage.setItem(key, value)
    else storage.removeItem(key)
  } catch {
    /* private mode: the session simply won't be remembered */
  }
}

export function getToken() {
  return read(localStorage, TOKEN_KEY)
}

export function setToken(token) {
  write(localStorage, TOKEN_KEY, token)
}

export function plantTokenKey(plantId) {
  return `mattrack-plant-${plantId}`
}

// Plant sign-ins last until the server-side session expires (30 days), so an
// installed app does not ask for the password every time it opens.
export function getPlantToken(plantId) {
  return read(localStorage, plantTokenKey(plantId)) || read(sessionStorage, plantTokenKey(plantId))
}

export function setPlantToken(plantId, token) {
  write(localStorage, plantTokenKey(plantId), token)
  write(sessionStorage, plantTokenKey(plantId), '')
}

const FRIENDLY = {
  413: 'That file is too large to send. Export fewer rows, or save it as CSV and try again.',
  429: 'Too many attempts. Wait a few minutes and try again.',
  502: 'The server is restarting. Try again in a moment.',
  503: 'The server is busy. Try again in a moment.',
  504: 'The server took too long. Try again in a moment.',
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
  let response
  try {
    response = await fetch(url, { ...options, headers })
  } catch {
    const error = new Error(navigator.onLine === false ? 'You are offline. Check the connection and try again.' : 'The server could not be reached. Try again.')
    error.status = 0
    throw error
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || FRIENDLY[response.status] || 'Something went wrong.')
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

function toBase64(bytes) {
  let binary = ''
  const size = 0x8000
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size))
  }
  return btoa(binary)
}

async function gzip(bytes) {
  if (typeof CompressionStream === 'undefined') return null
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

const post = (url, body, auth) => request(url, { method: 'POST', body: JSON.stringify(body || {}) }, auth)

export const api = {
  bootstrap: () => request('/api/bootstrap'),
  plantBootstrap: (plantId) => request('/api/bootstrap', {}, { buyer: false, plantId }),
  plantLogin: (plant, password) => post('/api/plant-login', { plant, password }, { buyer: false }),
  plantLogout: (plantId) => post('/api/plant-logout', {}, { buyer: false, plantId }),
  savePasswords: (passwords) => post('/api/plant-passwords', { passwords }),
  changePin: (current, next) => post('/api/buyer-pin', { current, next }),
  login: (pin) => post('/api/login', { pin }),
  logout: () => post('/api/logout'),
  saveLine: (id, changes) => post('/api/save', { ...changes, id }),
  bulk: (ids, step, done, date) => post('/api/bulk', { ids, step, done, date }),
  createLine: (body) => post('/api/lines', body),
  deleteLine: (id) => post('/api/remove', { id }),
  savePlantMap: (plantMap) => request('/api/plant-map', { method: 'PUT', body: JSON.stringify({ plantMap }) }),
  removeUpload: (id) => post('/api/upload-remove', { id }),
  clearUploads: (plant) => post('/api/upload-clear', { plant }),
  markSpecial: (body, plantId) => post('/api/special', body, plantId ? { buyer: false, plantId } : { buyer: true }),
  uploadBuffer: async (filename, buffer, plant) => {
    const bytes = new Uint8Array(buffer)
    // Spreadsheets are already compressed; text exports shrink a lot with gzip.
    const packed = /\.(csv|txt|tsv|xls)$/i.test(filename) ? await gzip(bytes).catch(() => null) : null
    const useGzip = packed && packed.length < bytes.length
    const base64 = toBase64(useGzip ? packed : bytes)
    if (base64.length > MAX_BODY) {
      const error = new Error(`${filename} is too large to send (${(bytes.length / 1048576).toFixed(1)} MB). Export fewer rows or save it as CSV.`)
      error.status = 413
      throw error
    }
    return post('/api/upload', { filename, base64, plant, encoding: useGzip ? 'gzip' : undefined })
  },
}
