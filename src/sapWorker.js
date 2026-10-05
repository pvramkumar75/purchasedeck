// Reads an SAP export off the main thread so big MB51 files don't freeze the page.
import * as xlsx from 'xlsx'
import { compactRecords, parseWorkbook } from '../shared/parse.js'

self.onmessage = (event) => {
  try {
    const parsed = parseWorkbook(new Uint8Array(event.data.buffer), xlsx)
    self.postMessage({
      ok: true,
      report: parsed.report,
      records: parsed.report ? compactRecords(parsed.report, parsed.records) : [],
      read: parsed.records.length,
    })
  } catch (error) {
    self.postMessage({ ok: false, error: String(error?.message || error) })
  }
}
