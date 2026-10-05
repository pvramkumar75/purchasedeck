import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createDemoStore, normalizeStore } from './logic.js'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const storePath = process.env.STORE_FILE || (process.env.VERCEL ? '/tmp/material-tracking-store.json' : path.join(dataDir, 'store.json'))
const BLOB_NAME = 'material-tracking/store.json'
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

async function readBlob() {
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
    // Creating the store for the first time: never overwrite one that exists.
    try {
      await put(BLOB_NAME, text, { ...options, allowOverwrite: false })
    } catch (error) {
      throw new StoreConflict(error.message)
    }
    return
  }
  if (!conditionalWrites) {
    await put(BLOB_NAME, text, { ...options, allowOverwrite: true })
    return
  }
  const style = etagStyle
  try {
    await put(BLOB_NAME, text, { ...options, ifMatch: ETAG_STYLES[style](version) })
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) throw new StoreConflict(error.message, style)
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
  const text = JSON.stringify(store)
  if (useBlob()) await writeBlob(text, version)
  else writeFile(text)
}

const readRaw = () => (useBlob() ? readBlob() : readFile())

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
    const fresh = createDemoStore()
    try {
      await save(fresh, null)
    } catch (error) {
      if (!(error instanceof StoreConflict) || depth > 1) throw error
    }
    return load(depth + 1)
  }
  const store = parse(raw)
  // Older stores are upgraded (hashed sessions, generated passwords) on first read.
  // A failed upgrade write is fine: the next successful save stores it anyway.
  if (store.needsSave && depth === 0) {
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

// Runs a change against the latest store and saves it. If someone else saved in
// between, the change is replayed on their version instead of overwriting it.
export async function mutate(change) {
  const started = Date.now()
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const { store, version, text } = await load()
    const result = await change(store)
    try {
      await save(store, version)
      return { store, result }
    } catch (error) {
      if (!(error instanceof StoreConflict)) throw error
      const now = await readRaw()
      if (now && now.text === text && conditionalWrites) {
        // Nobody else saved, yet the write was refused: the etag spelling is wrong.
        // Only the writer that used the current spelling moves on to the next one.
        if (error.style === etagStyle) etagStyle += 1
        if (etagStyle >= ETAG_STYLES.length) {
          conditionalWrites = false
          console.warn('Blob conditional writes are not matching; saving without the etag check.')
        }
        continue
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
