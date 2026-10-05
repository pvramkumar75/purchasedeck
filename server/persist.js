import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createDemoStore, normalizeStore } from './logic.js'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const storePath = process.env.STORE_FILE || (process.env.VERCEL ? '/tmp/material-tracking-store.json' : path.join(dataDir, 'store.json'))
const BLOB_NAME = 'material-tracking/store.json'
const ATTEMPTS = 10

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

class StoreConflict extends Error {}

const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN)

function serialize(store) {
  return JSON.stringify(store)
}

// One cached copy per server instance so unchanged reads come back as 304s.
let cached = null

async function readBlob() {
  const { get } = await import('@vercel/blob')
  // Keep our own reference: another request may replace `cached` while this one waits.
  const known = cached
  const result = await get(BLOB_NAME, {
    access: 'private',
    useCache: false,
    ...(known ? { ifNoneMatch: known.etag } : {}),
  })
  if (!result) return null
  if (result.statusCode === 304 && known) return { text: known.text, version: known.etag }
  if (result.statusCode !== 200 || !result.stream) throw new Error(`Blob read returned ${result.statusCode}`)
  const text = await new Response(result.stream).text()
  cached = { etag: result.blob.etag, text }
  return { text, version: result.blob.etag }
}

async function writeBlob(text, version) {
  const { put, BlobPreconditionFailedError } = await import('@vercel/blob')
  try {
    const result = await put(BLOB_NAME, text, {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'application/json',
      ...(version ? { ifMatch: version } : { allowOverwrite: false }),
    })
    cached = result.etag ? { etag: result.etag, text } : null
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError || !version) throw new StoreConflict(error.message)
    throw error
  }
}

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
}

async function save(store, version) {
  const text = serialize(store)
  if (useBlob()) await writeBlob(text, version)
  else writeFile(text)
}

async function load() {
  const raw = useBlob() ? await readBlob() : readFile()
  if (!raw) {
    const fresh = createDemoStore()
    try {
      await save(fresh, null)
    } catch (error) {
      if (!(error instanceof StoreConflict)) throw error
      return load()
    }
    return { store: fresh, version: useBlob() ? cached?.etag || null : null }
  }
  let parsed
  try {
    parsed = JSON.parse(raw.text)
  } catch (error) {
    // Never replace a store that exists but cannot be read; that would wipe the board.
    throw new Error(`The saved store could not be parsed: ${error.message}`)
  }
  const store = normalizeStore(parsed)
  if (store.needsSave) {
    try {
      await save(store, raw.version)
    } catch (error) {
      // Another instance migrated it first; reading again picks up their copy.
      if (!(error instanceof StoreConflict)) throw error
    }
    return load()
  }
  return { store, version: raw.version }
}

export async function readStore() {
  return (await load()).store
}

// Runs a change against the latest store and saves it. If someone else saved in
// between, the change is replayed on their version instead of overwriting it.
export async function mutate(change) {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const { store, version } = await load()
    const result = await change(store)
    try {
      await save(store, version)
      return { store, result }
    } catch (error) {
      if (!(error instanceof StoreConflict) || attempt === ATTEMPTS) throw error
      // Random, growing back-off so simultaneous writers spread out instead of colliding again.
      await new Promise((resolve) => setTimeout(resolve, Math.random() * Math.min(1500, 60 * 2 ** attempt)))
    }
  }
  throw new Error('The store could not be saved.')
}
