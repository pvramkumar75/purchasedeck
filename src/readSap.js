// Turns an SAP export into { report, records, read } in the browser.
// Returns null when the file is not ME5A, ME2L, or MB51.
export async function readSapFile(buffer) {
  let result
  try {
    result = await inWorker(buffer)
  } catch {
    // Some browsers block module workers; read on the page instead.
    const [xlsx, { compactRecords, parseWorkbook }] = await Promise.all([import('xlsx'), import('../shared/parse.js')])
    const parsed = parseWorkbook(new Uint8Array(buffer), xlsx)
    result = { report: parsed.report, records: parsed.report ? compactRecords(parsed.report, parsed.records) : [], read: parsed.records.length }
  }
  return result.report ? result : null
}

function inWorker(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sapWorker.js', import.meta.url), { type: 'module' })
    const done = (fn, value) => {
      worker.terminate()
      fn(value)
    }
    worker.onmessage = (event) => (event.data.ok ? done(resolve, event.data) : done(reject, new Error(event.data.error)))
    worker.onerror = (event) => done(reject, new Error(event.message || 'The file could not be read.'))
    // Copy so the caller keeps its buffer for the raw-file fallback.
    worker.postMessage({ buffer: buffer.slice(0) })
  })
}
