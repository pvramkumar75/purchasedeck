import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createDemoStore, normalizeStore } from './logic.js'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const storePath = process.env.VERCEL ? '/tmp/material-tracking-store.json' : path.join(dataDir, 'store.json')
const BLOB_NAME = 'material-tracking/store.json'

function readFileStore() {
  try {
    if (fs.existsSync(storePath)) return normalizeStore(JSON.parse(fs.readFileSync(storePath, 'utf8')))
  } catch (error) {
    console.error('Store could not be read, starting from sample data.', error)
  }
  return createDemoStore()
}

function writeFileStore(store) {
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true })
    const copy = { ...store, sessions: (store.sessions || []).slice(-30) }
    fs.writeFileSync(storePath, JSON.stringify(copy, null, 2))
  } catch (error) {
    console.error('Could not persist the board on disk.', error)
  }
}

async function readBlob() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null
  const { get } = await import('@vercel/blob')
  const result = await get(BLOB_NAME, { access: 'private', useCache: false })
  if (!result || result.statusCode !== 200 || !result.stream) return null
  return normalizeStore(await new Response(result.stream).json())
}

async function writeBlob(store) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return
  const { put } = await import('@vercel/blob')
  const copy = { ...store, sessions: (store.sessions || []).slice(-30) }
  await put(BLOB_NAME, JSON.stringify(copy), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

export async function readStore() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const remote = await readBlob()
    if (remote) return remote
    const demo = createDemoStore()
    await writeBlob(demo)
    return demo
  }
  const local = readFileStore()
  writeFileStore(local)
  return local
}

export async function writeStore(store) {
  writeFileStore(store)
  await writeBlob(store)
  return store
}
