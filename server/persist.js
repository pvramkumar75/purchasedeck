import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'
import { VARIANT, createDemoStore, normalizeStore } from './logic.js'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const storePath = process.env.STORE_FILE || (process.env.VERCEL ? `/tmp/material-tracking-store${SUFFIX}.json` : path.join(dataDir, `store${SUFFIX}.json`))
// Each app keeps its own board, so two apps can share one database without meeting.
const SUFFIX = VARIANT.id === 'ALL' ? '' : `-${VARIANT.id.toLowerCase()}`
const BLOB_NAME = `material-tracking${SUFFIX}/store.json`
const ROW_ID = `main${SUFFIX}`
const ATTEMPTS = 10
// Stay well inside Vercel's 30 second function limit.
const DEADLINE_MS = 20000

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

class StoreConflict extends Error {
  constructor(message, style = null) {
    super(message)
    this.style = style
  }
}

// ---------- Supabase (main store) ----------

// Names match what Vercel's Supabase integration sets. Only a secret (service role)
// key is used: the publishable key is public and must never be able to read the board.
const supabaseUrl = () => String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const supabaseKey = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const useSupabase = () => Boolean(supabaseUrl() && supabaseKey())

function supabaseHeaders(extra = {}) {
  const key = supabaseKey()
  // New "sb_secret_" keys go in the apikey header only; legacy JWT keys also need Authorization.
  return {
    apikey: key,
    ...(key.startsWith('sb_') ? {} : { Authorization: `Bearer ${key}` }),
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function supabaseFetch(query, options = {}) {
  const { timeout = 20000, ...rest } = options
  const started = Date.now()
  const response = await fetch(`${supabaseUrl()}/rest/v1/app_store${query}`, {
    ...rest,
    headers: supabaseHeaders(rest.headers),
    signal: AbortSignal.timeout(timeout),
  })
  const took = Date.now() - started
  if (took > 3000) console.warn(`Slow Supabase ${rest.method || 'GET'} (${took} ms, ${rest.body ? Math.round(rest.body.length / 1024) : 0} KB sent)`)
  if (!response.ok && response.status !== 409) {
    const body = await response.text().catch(() => '')
    if (/PGRST205|app_store/.test(body) && response.status === 404) {
      throw new HttpError(503, 'The Supabase table is not set up yet. Run supabase/setup.sql in the Supabase SQL editor.')
    }
    const error = new Error(`Supabase ${response.status}: ${body.slice(0, 200)}`)
    error.name = 'StoreError'
    throw error
  }
  return response
}

// Documents are stored gzipped as one string ("gz:<base64>"): several times smaller
// to send, and Postgres stores a string without having to parse megabytes of JSON.
// Rows saved before this change are plain JSON and are still read as they are.
function packDoc(text) {
  return JSON.stringify(`gz:${zlib.gzipSync(text, { level: 6 }).toString('base64')}`)
}

function unpackDoc(doc) {
  if (typeof doc === 'string' && doc.startsWith('gz:')) return zlib.gunzipSync(Buffer.from(doc.slice(3), 'base64')).toString('utf8')
  return JSON.stringify(doc)
}

// Each server instance keeps the last copy; an unchanged board costs one tiny query.
let memo = null

async function readSupabase() {
  // Without a copy to compare against, asking for the version first only adds a round trip.
  if (memo) {
    const head = await (await supabaseFetch(`?id=eq.${ROW_ID}&select=version`, { timeout: 10000 })).json()
    if (!head.length) return null
    if (memo.version === String(head[0].version)) return memo
  }
  const rows = await (await supabaseFetch(`?id=eq.${ROW_ID}&select=doc,version`, { timeout: 30000 })).json()
  if (!rows.length) return null
  memo = { text: unpackDoc(rows[0].doc), version: String(rows[0].version) }
  return memo
}

async function writeSupabase(text, version) {
  const now = new Date().toISOString()
  const doc = packDoc(text)
  if (!version) {
    const response = await supabaseFetch('', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: `{"id":"${ROW_ID}","version":1,"updated_at":"${now}","doc":${doc}}`,
      timeout: 40000,
    })
    if (response.status === 409) throw new StoreConflict('The store already exists.')
    memo = { text, version: '1' }
    return '1'
  }
  const next = String(Number(version) + 1)
  const response = await supabaseFetch(`?id=eq.${ROW_ID}&version=eq.${Number(version)}&select=version`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: `{"version":${next},"updated_at":"${now}","doc":${doc}}`,
    timeout: 40000,
  })
  const rows = await response.json()
  if (!rows.length) throw new StoreConflict('Someone else saved first.')
  memo = { text, version: next }
  return next
}

// ---------- uploaded file rows, kept outside the board ----------
// A big MB51 can hold megabytes of rows. Keeping them in their own rows (Supabase)
// or files (local) means everyday saves only rewrite the small board document.

const recordsDir = () => path.join(path.dirname(storePath), 'records')
const recordKey = (id) => `rec${SUFFIX}:${String(id).replace(/[^a-z0-9]/gi, '')}`
const inList = (ids) => `in.(${ids.map((id) => `"${recordKey(id)}"`).join(',')})`

export function keepsRecordsApart() {
  return kind() === 'supabase' || kind() === 'file'
}

export async function putRecords(id, records) {
  const text = JSON.stringify(records)
  if (kind() === 'supabase') {
    await supabaseFetch('', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: `{"id":"${recordKey(id)}","version":1,"updated_at":"${new Date().toISOString()}","doc":${packDoc(text)}}`,
      timeout: 40000,
    })
    return
  }
  fs.mkdirSync(recordsDir(), { recursive: true })
  fs.writeFileSync(path.join(recordsDir(), `${recordKey(id).slice(recordKey(id).indexOf(':') + 1)}.json`), text)
}

export async function getRecords(ids) {
  const out = {}
  if (!ids.length) return out
  if (kind() === 'supabase') {
    const rows = await (await supabaseFetch(`?id=${encodeURIComponent(inList(ids))}&select=id,doc`, { timeout: 40000 })).json()
    for (const row of rows) out[row.id.slice(row.id.indexOf(':') + 1)] = JSON.parse(unpackDoc(row.doc))
    return out
  }

  for (const id of ids) {
    const file = path.join(recordsDir(), `${recordKey(id).slice(recordKey(id).indexOf(':') + 1)}.json`)
    if (fs.existsSync(file)) out[id] = JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  return out
}

export async function dropRecords(ids) {
  if (!ids?.length) return
  try {
    if (kind() === 'supabase') {
      await supabaseFetch(`?id=${encodeURIComponent(inList(ids))}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
      return
    }
    for (const id of ids) fs.rmSync(path.join(recordsDir(), `${recordKey(id).slice(recordKey(id).indexOf(':') + 1)}.json`), { force: true })
  } catch (error) {
    // Leftover rows only take space; the board no longer points at them.
    console.error('Old file rows could not be removed.', error)
  }
}

// Older boards kept each file's rows inline; move them out once.
async function moveRecordsOut(store) {
  const inline = store.uploads.filter((upload) => Array.isArray(upload.records))
  if (!inline.length || !keepsRecordsApart()) return false
  for (const upload of inline) {
    await putRecords(upload.id, upload.records)
    delete upload.records
    upload.stored = true
  }
  return true
}

// ---------- Vercel Blob (old store, kept for importing) ----------

const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN)

// The etag that `get` reports is passed back to `put` as ifMatch. In case this
// Blob store wants it written differently, try the other common spellings, and
// as a last resort fall back to plain overwrites instead of failing every save.
const ETAG_STYLES = [
  (etag) => etag,
  (etag) => etag.replace(/^W\//, '').replace(/"/g, ''),
  (etag) => `"${etag.replace(/^W\//, '').replace(/"/g, '')}"`,
]
let etagStyle = 0
let conditionalWrites = true

export async function readBlob() {
  const { get } = await import('@vercel/blob')
  const result = await get(BLOB_NAME, { access: 'private', useCache: false })
  if (!result) return null
  if (result.statusCode !== 200 || !result.stream) throw new Error(`Blob read returned ${result.statusCode}`)
  const text = await new Response(result.stream).text()
  return { text, version: result.blob.etag || null }
}

async function writeBlob(text, version) {
  const { put, BlobPreconditionFailedError } = await import('@vercel/blob')
  const options = { access: 'private', addRandomSuffix: false, contentType: 'application/json' }
  if (!version) {
    try {
      await put(BLOB_NAME, text, { ...options, allowOverwrite: false })
    } catch (error) {
      throw new StoreConflict(error.message)
    }
    return null
  }
  if (!conditionalWrites) {
    await put(BLOB_NAME, text, { ...options, allowOverwrite: true })
    return null
  }
  const style = etagStyle
  try {
    await put(BLOB_NAME, text, { ...options, ifMatch: ETAG_STYLES[style](version) })
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) throw new StoreConflict(error.message, style)
    throw error
  }
  return null
}

// ---------- local file (development) ----------

function readFile() {
  if (!fs.existsSync(storePath)) return null
  const text = fs.readFileSync(storePath, 'utf8')
  return { text, version: String(fs.statSync(storePath).mtimeMs) }
}

function writeFile(text) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true })
  const temp = `${storePath}.${process.pid}.tmp`
  fs.writeFileSync(temp, text)
  fs.renameSync(temp, storePath)
  return String(fs.statSync(storePath).mtimeMs)
}

// ---------- shared ----------

export function storageKind() {
  if (useSupabase()) return 'supabase'
  if (useBlob()) return 'blob'
  return process.env.VERCEL ? 'temporary' : 'file'
}

const kind = () => storageKind()
const readRaw = () => (kind() === 'supabase' ? readSupabase() : kind() === 'blob' ? readBlob() : readFile())

async function save(store, version) {
  const text = JSON.stringify(store)
  if (kind() === 'supabase') return writeSupabase(text, version)
  if (kind() === 'blob') return writeBlob(text, version)
  return writeFile(text)
}

function parse(raw) {
  try {
    return normalizeStore(JSON.parse(raw.text))
  } catch (error) {
    // Never replace a store that exists but cannot be read; that would wipe the board.
    throw new Error(`The saved store could not be parsed: ${error.message}`)
  }
}

async function load(depth = 0) {
  const raw = await readRaw()
  if (!raw) {
    try {
      await save(createDemoStore(), null)
    } catch (error) {
      if (!(error instanceof StoreConflict) || depth > 1) throw error
    }
    return load(depth + 1)
  }
  const store = parse(raw)
  // Older stores are upgraded (hashed sessions, generated passwords, file rows moved
  // out) on first read. A failed upgrade write is fine: the next save stores it anyway.
  const moved = depth === 0 ? await moveRecordsOut(store) : false
  if ((store.needsSave || moved) && depth === 0) {
    try {
      await save(store, raw.version)
      return load(depth + 1)
    } catch (error) {
      if (!(error instanceof StoreConflict)) throw error
    }
  }
  return { store, version: raw.version, text: raw.text }
}

export async function readStore() {
  return (await load()).store
}

export async function readVersioned() {
  const { store, version } = await load()
  return { store, version }
}

// Runs a change against the latest store and saves it. If someone else saved in
// between, the change is replayed on their version instead of overwriting it.
export async function mutate(change) {
  const started = Date.now()
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const { store, version, text } = await load()
    const result = await change(store)
    try {
      const saved = await save(store, version)
      return { store, result, version: saved }
    } catch (error) {
      if (!(error instanceof StoreConflict)) throw error
      if (kind() === 'blob' && conditionalWrites) {
        const now = await readRaw()
        if (now && now.text === text) {
          // Nobody else saved, yet Blob refused the write: the etag spelling is wrong.
          // Only the writer that used the current spelling moves on to the next one.
          if (error.style === etagStyle) etagStyle += 1
          if (etagStyle >= ETAG_STYLES.length) {
            conditionalWrites = false
            console.warn('Blob conditional writes are not matching; saving without the etag check.')
          }
          continue
        }
      }
      if (attempt === ATTEMPTS || Date.now() - started > DEADLINE_MS) {
        throw new HttpError(503, 'Several people are saving at once. Try again in a moment.')
      }
      // Random, growing back-off so simultaneous writers spread out instead of colliding again.
      await new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(1500, 60 * 2 ** attempt)))
    }
  }
  throw new HttpError(503, 'The board could not be saved. Try again in a moment.')
}
