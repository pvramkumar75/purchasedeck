import { useEffect, useMemo, useState } from 'react'
import { api, getToken, setToken } from './api.js'
import { COMPANIES, pretty, qty } from './model.js'
import { MiniTrack, PayBadge } from './visuals.jsx'

function Login({ onDone }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api.login(pin)
      setToken(result.token)
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" width="40" height="40" />
          <span>
            <strong>Purchase desk</strong>
            <small>Material Tracking</small>
          </span>
        </a>
      </header>
      <main className="wrap narrow">
        <form className="login" onSubmit={submit}>
          <h1>Buyer sign in</h1>
          <p>Indentors use the shared link. This desk is where purchase updates milestones and SAP reports.</p>
          <label className="field">
            PIN
            <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} autoFocus />
          </label>
          <p className="hint">The starting PIN is buyer123. Change it with the BUYER_PIN setting on the server.</p>
          {error && <p className="error">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Open desk'}</button>
        </form>
      </main>
    </div>
  )
}

function editorState(line) {
  return {
    ...line.editor,
    poMadeMode: line.editor.poMadeFollowsSap ? 'sap' : 'manual',
    receiptMode: line.editor.receiptFollowsSap ? 'sap' : 'manual',
  }
}

function MilestoneEditor({ line, onSaved, onDeleted, onUnauthorized, onBack }) {
  const [form, setForm] = useState(() => editorState(line))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setForm(editorState(line))
    setMessage('')
    setError('')
  }, [line])

  const patch = (partial) => setForm((current) => ({ ...current, ...partial }))

  const save = async () => {
    setBusy(true)
    setError('')
    try {
      const body = {
        company: form.company,
        manualPoNumber: form.manualPoNumber,
        manualVendorName: form.manualVendorName,
        remark: form.remark,
        poMadeDone: form.poMadeMode === 'sap' ? null : form.poMadeDone,
        poMadeDate: form.poMadeDate,
        readinessDone: form.readinessDone,
        readinessDate: form.readinessDate,
        etdDone: form.etdDone,
        etdDate: form.etdDate,
        etaDone: form.etaDone,
        etaDate: form.etaDate,
        expectedArrivalDone: form.expectedArrivalDone,
        expectedArrivalDate: form.expectedArrivalDate,
        receiptDone: form.receiptMode === 'sap' ? null : form.receiptDone,
        receiptDate: form.receiptDate,
        paymentStatus: form.paymentStatus,
        paymentDate: form.paymentDate,
      }
      const result = await api.saveLine(line.id, body)
      onSaved(result.line)
      setMessage('Saved')
    } catch (err) {
      if (err.status === 401) onUnauthorized()
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Remove ${line.shortText} from the board?`)) return
    setBusy(true)
    try {
      const result = await api.deleteLine(line.id)
      onDeleted(result)
    } catch (err) {
      if (err.status === 401) onUnauthorized()
      setError(err.message)
      setBusy(false)
    }
  }

  const rows = [
    ['poMade', 'PO made', 'poMadeDone', 'poMadeDate', true],
    ['readiness', 'Readiness', 'readinessDone', 'readinessDate', false],
    ['etd', 'ETD', 'etdDone', 'etdDate', false],
    ['eta', 'ETA', 'etaDone', 'etaDate', false],
    ['expectedArrival', 'Expected arrival', 'expectedArrivalDone', 'expectedArrivalDate', false],
    ['receipt', 'Receipt at factory', 'receiptDone', 'receiptDate', true],
  ]

  return (
    <section className="editor">
      <button type="button" className="btn ghost back-lines" onClick={onBack}>All lines</button>
      <p className="eyebrow">{line.company}</p>
      <h2>{line.shortText}</h2>
      <p className="meta">{line.material} · Indent {line.indentNo || '—'} / {line.indentItem || '—'}</p>
      <dl className="facts">
        <div><dt>PO</dt><dd>{line.sapPoNumber || 'Not in SAP yet'}</dd></div>
        <div><dt>Ordered</dt><dd>{qty(line.orderQty ?? line.quantity, line.unit)}</dd></div>
        <div><dt>Still open</dt><dd>{line.openQty == null ? '—' : qty(line.openQty, line.unit)}</dd></div>
        <div><dt>Goods receipt</dt><dd>{qty(line.receivedQty, line.unit)}</dd></div>
      </dl>
      <label className="field">
        Unit
        <select value={form.company} onChange={(event) => patch({ company: event.target.value })}>
          {COMPANIES.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>
      {line.sapPoNumber ? (
        <p className="hint">PO {line.sapPoNumber} comes from SAP.</p>
      ) : (
        <label className="field">
          PO number
          <input
            value={form.manualPoNumber}
            onChange={(event) => patch({ manualPoNumber: event.target.value, poMadeDone: true, poMadeMode: 'manual' })}
          />
        </label>
      )}
      {line.sapVendorName ? (
        <p className="hint">Supplier {line.sapVendorName} comes from SAP.</p>
      ) : (
        <label className="field">
          Supplier
          <input value={form.manualVendorName} onChange={(event) => patch({ manualVendorName: event.target.value })} />
        </label>
      )}
      {rows.map(([key, label, doneKey, dateKey, sap]) => (
        <div className="ms-row" key={key}>
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(form[doneKey])}
              onChange={(event) => patch({
                [doneKey]: event.target.checked,
                ...(key === 'poMade' ? { poMadeMode: 'manual' } : {}),
                ...(key === 'receipt' ? { receiptMode: 'manual' } : {}),
              })}
            />
            <span>{label}</span>
          </label>
          <input type="date" value={form[dateKey] || ''} onChange={(event) => patch({ [dateKey]: event.target.value })} />
          {sap && form[key === 'poMade' ? 'poMadeMode' : 'receiptMode'] === 'manual' && (
            <button
              type="button"
              className="text-btn"
              onClick={() => patch(key === 'poMade'
                ? { poMadeMode: 'sap', poMadeDone: form.poMadeAuto }
                : { receiptMode: 'sap', receiptDone: form.receiptAuto })}
            >
              Follow SAP
            </button>
          )}
        </div>
      ))}
      {line.dates.sapDelivery && <p className="hint">SAP delivery date {pretty(line.dates.sapDelivery)}</p>}
      <div className="pay-edit">
        <span>Payment</span>
        {['unpaid', 'partial', 'paid'].map((status) => (
          <button
            type="button"
            key={status}
            className={form.paymentStatus === status ? 'on' : ''}
            onClick={() => patch({ paymentStatus: status })}
          >
            {status === 'paid' ? 'Paid' : status === 'partial' ? 'Part paid' : 'Unpaid'}
          </button>
        ))}
        <input type="date" value={form.paymentDate || ''} onChange={(event) => patch({ paymentDate: event.target.value })} />
      </div>
      <label className="field">
        Note for indentors
        <textarea rows="2" value={form.remark} onChange={(event) => patch({ remark: event.target.value })} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="editor-actions">
        <button type="button" className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save milestones'}</button>
        {message && <span className="saved">{message}</span>}
        <button type="button" className="text-btn danger" onClick={remove}>Remove line</button>
      </div>
    </section>
  )
}

function AddLine({ onCreated, onUnauthorized }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ company: 'TPL', indentNo: '', indentItem: '10', material: '', shortText: '', quantity: '', unit: '', vendorName: '', plant: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!open) {
    return <button type="button" className="btn ghost" onClick={() => setOpen(true)}>Add a material line</button>
  }
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api.createLine(form)
      onCreated(result.line)
      setOpen(false)
      setForm({ company: 'TPL', indentNo: '', indentItem: '10', material: '', shortText: '', quantity: '', unit: '', vendorName: '', plant: '' })
    } catch (err) {
      if (err.status === 401) onUnauthorized()
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="add-line" onSubmit={submit}>
      <div className="filters">
        <label className="field">Unit<select value={form.company} onChange={set('company')}>{COMPANIES.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="field">Indent<input value={form.indentNo} onChange={set('indentNo')} /></label>
        <label className="field">Item<input value={form.indentItem} onChange={set('indentItem')} /></label>
        <label className="field">Material code<input value={form.material} onChange={set('material')} /></label>
        <label className="field">Description<input value={form.shortText} onChange={set('shortText')} /></label>
        <label className="field">Qty<input value={form.quantity} onChange={set('quantity')} /></label>
        <label className="field">Unit of measure<input value={form.unit} onChange={set('unit')} /></label>
        <label className="field">Supplier<input value={form.vendorName} onChange={set('vendorName')} /></label>
        <label className="field">Plant<input value={form.plant} onChange={set('plant')} /></label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="editor-actions">
        <button className="btn" type="submit" disabled={busy}>Add line</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

function Desk({ onUnauthorized }) {
  const [tab, setTab] = useState('home')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [editId, setEditId] = useState(null)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [drag, setDrag] = useState(false)
  const [plants, setPlants] = useState([])

  const load = () => {
    api.bootstrap().then((next) => {
      setData(next)
      setPlants(Object.entries(next.plantMap).map(([plant, company]) => ({ plant, company })))
    }).catch((err) => setError(err.message))
  }

  useEffect(() => { load() }, [])

  const lines = data?.lines || []
  const waiting = lines.filter((line) => line.awaitingPo)
  const openPos = lines.filter((line) => line.undelivered)
  const editing = lines.find((line) => line.id === editId) || null
  const worklist = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return lines
    return lines.filter((line) => [line.indentNo, line.material, line.shortText, line.vendorName, line.poNumber, line.company].join(' ').toLowerCase().includes(needle))
  }, [lines, query])

  const replaceAll = (next) => {
    setData(next)
    setPlants(Object.entries(next.plantMap).map(([plant, company]) => ({ plant, company })))
  }

  const uploadFiles = async (fileList) => {
    setNotice('')
    setError('')
    try {
      let last = null
      for (const file of fileList) {
        const buffer = await file.arrayBuffer()
        last = await api.uploadBuffer(file.name, buffer)
        setNotice(`${last.report} · ${last.rows} rows from ${file.name}`)
      }
      if (last) replaceAll(last)
    } catch (err) {
      if (err.status === 401) onUnauthorized()
      setError(err.message)
    }
  }

  const loadSamples = async () => {
    const names = ['ME5A_sample.csv', 'ME2L_sample.csv', 'MB51_sample.csv']
    setNotice('Reading sample reports…')
    try {
      let last = null
      for (const name of names) {
        const response = await fetch(`/samples/${name}`)
        const buffer = await response.arrayBuffer()
        last = await api.uploadBuffer(name, buffer)
      }
      if (last) {
        replaceAll(last)
        setNotice('Sample ME5A, ME2L, and MB51 are on the board. The demo lines were cleared.')
      }
    } catch (err) {
      if (err.status === 401) onUnauthorized()
      setError(err.message)
    }
  }

  const savePlants = async () => {
    const plantMap = {}
    plants.forEach((row) => {
      if (row.plant.trim()) plantMap[row.plant.trim()] = row.company
    })
    try {
      replaceAll(await api.savePlantMap(plantMap))
      setNotice('Plant mapping saved.')
    } catch (err) {
      if (err.status === 401) onUnauthorized()
      setError(err.message)
    }
  }

  const share = async () => {
    const url = `${window.location.origin}/`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Material Tracking', url })
        return
      } catch { /* copy */ }
    }
    await navigator.clipboard.writeText(url)
    setNotice('User link copied.')
  }

  const logout = async () => {
    try { await api.logout() } catch { /* still clear local token */ }
    setToken('')
    onUnauthorized()
  }

  return (
    <div className="app buyer">
      <header className="topbar">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" width="40" height="40" />
          <span>
            <strong>Purchase desk</strong>
            <small>Update status for indentors</small>
          </span>
        </a>
        <button type="button" className="btn ghost" onClick={logout}>Sign out</button>
      </header>
      <nav className="buyer-nav">
        <button type="button" className={tab === 'home' ? 'on' : ''} onClick={() => setTab('home')}>Dashboard</button>
        <button type="button" className={tab === 'edit' ? 'on' : ''} onClick={() => setTab('edit')}>Milestones</button>
        <button type="button" className={tab === 'upload' ? 'on' : ''} onClick={() => setTab('upload')}>SAP upload</button>
      </nav>
      <main className="wrap">
        {error && <p className="error banner">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        {tab === 'home' && (
          <>
            <section className="kpis">
              <article><span>Indents awaiting PO</span><strong>{waiting.length}</strong></article>
              <article><span>POs not received</span><strong>{openPos.length}</strong></article>
              <article><span>Received, payment open</span><strong>{lines.filter((line) => line.flags.receipt && line.payment.status !== 'paid').length}</strong></article>
            </section>
            <section className="share-card">
              <div>
                <h2>Link for indentors</h2>
                <p>They can open it on a computer or install it on a phone. The link is view only.</p>
                <code>{typeof window !== 'undefined' ? window.location.origin : ''}/</code>
              </div>
              <button type="button" className="btn" onClick={share}>Copy user link</button>
            </section>
            <div className="split">
              <section className="panel">
                <div className="section-head"><h2>Indents not converted to PO</h2><span>{waiting.length}</span></div>
                {waiting.length === 0 ? <p className="muted">Every indent in this view has a PO.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Indent</th><th>Item</th><th>Material</th><th>Description</th><th>Qty</th><th>Unit</th><th>Req. date</th><th>Delivery</th><th>By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {waiting.map((line) => (
                          <tr key={line.id} className="click" onClick={() => { setEditId(line.id); setTab('edit') }}>
                            <td>{line.indentNo || '—'}</td>
                            <td>{line.indentItem || '—'}</td>
                            <td>{line.material}</td>
                            <td className="wrap">{line.shortText}</td>
                            <td>{qty(line.quantity, line.unit)}</td>
                            <td>{line.company}</td>
                            <td>{pretty(line.requisitionDate)}</td>
                            <td>{pretty(line.indentDelivery)}</td>
                            <td>{line.requisitioner || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <section className="panel">
                <div className="section-head"><h2>POs not received</h2><span>{openPos.length}</span></div>
                {openPos.length === 0 ? <p className="muted">Every PO in this view has been received at the factory.</p> : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>PO</th><th>Item</th><th>Material</th><th>Supplier</th><th>Open qty</th><th>Unit</th><th>ETA</th><th>Payment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openPos.map((line) => (
                          <tr key={line.id} className="click" onClick={() => { setEditId(line.id); setTab('edit') }}>
                            <td>{line.poNumber}</td>
                            <td>{line.poItem || line.indentItem}</td>
                            <td className="wrap">{line.shortText}<br /><span className="muted">{line.material}</span></td>
                            <td>{line.vendorName || '—'}</td>
                            <td>{qty(line.openQty ?? line.orderQty, line.unit)}</td>
                            <td>{line.company}</td>
                            <td>{pretty(line.dates.eta || line.dates.sapDelivery)}</td>
                            <td><PayBadge status={line.payment.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
        {tab === 'edit' && (
          <div className={`shell${editing ? ' has-detail' : ''}`}>
            <section className="list-pane">
              <div className="section-head"><h2>Milestones</h2></div>
              <AddLine
                onUnauthorized={onUnauthorized}
                onCreated={(line) => {
                  setData((current) => ({ ...current, lines: [line, ...current.lines] }))
                  setEditId(line.id)
                }}
              />
              <label className="field">
                Find a line
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Indent, material, supplier, PO" />
              </label>
              <div className="rows">
                {worklist.map((line) => (
                  <button type="button" key={line.id} className={line.id === editId ? 'row on' : 'row'} onClick={() => setEditId(line.id)}>
                    <div>
                      <div className="row-title">
                        <h3>{line.shortText}</h3>
                        <PayBadge status={line.payment.status} />
                      </div>
                      <p className="meta">{line.material} · {line.company} · Indent {line.indentNo || '—'} {line.poNumber ? `· PO ${line.poNumber}` : ''}</p>
                      <MiniTrack stages={line.stages} statusLabel={line.statusLabel} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
            {editing && (
              <MilestoneEditor
                line={editing}
                onBack={() => setEditId(null)}
                onUnauthorized={onUnauthorized}
                onSaved={(line) => setData((current) => ({ ...current, lines: current.lines.map((item) => item.id === line.id ? line : item) }))}
                onDeleted={(next) => { replaceAll(next); setEditId(null) }}
              />
            )}
          </div>
        )}
        {tab === 'upload' && (
          <section className="panel">
            <h2>SAP reports</h2>
            <p className="lede-copy">Drop ME5A, ME2L, or MB51 exports. Column headings can stay as SAP prints them. CSV and Excel both work. The first real upload clears the sample lines.</p>
            <div
              className={drag ? 'drop on' : 'drop'}
              onDragOver={(event) => { event.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(event) => { event.preventDefault(); setDrag(false); uploadFiles(event.dataTransfer.files) }}
            >
              <strong>Drop ME5A, ME2L, or MB51</strong>
              <p>ME5A builds indents. ME2L attaches POs and open quantity. MB51 movement 101 records factory receipt.</p>
              <label className="btn">
                Choose files
                <input type="file" accept=".csv,.xlsx,.xls" multiple hidden onChange={(event) => uploadFiles(event.target.files)} />
              </label>
            </div>
            <div className="report-cards">
              <article><h3>ME5A</h3><p>Purchase requisitions. A row with no purchasing document stays an indent awaiting PO.</p></article>
              <article><h3>ME2L</h3><p>Purchase orders by vendor. Open quantity is “still to be delivered”.</p></article>
              <article><h3>MB51</h3><p>Goods movements. Receipts match the PO and item.</p></article>
            </div>
            <button type="button" className="btn ghost" onClick={loadSamples}>Load the three sample reports</button>
            <h3>Recent uploads</h3>
            <ul className="uploads">
              {(data?.uploads || []).length === 0 && <li>No SAP file uploaded yet. The board is showing sample lines.</li>}
              {(data?.uploads || []).map((upload) => (
                <li key={upload.at}>{upload.report} · {upload.rows} rows · {pretty(upload.at)}</li>
              ))}
            </ul>
            <h3>Plant to unit</h3>
            <p className="hint">Used when a SAP row has a plant and purchase has not set the unit by hand.</p>
            {plants.map((row, index) => (
              <div className="ms-row" key={`${row.plant}-${index}`}>
                <input value={row.plant} onChange={(event) => setPlants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, plant: event.target.value } : item))} />
                <select value={row.company} onChange={(event) => setPlants((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, company: event.target.value } : item))}>
                  {COMPANIES.map((name) => <option key={name}>{name}</option>)}
                </select>
                <button type="button" className="text-btn" onClick={() => setPlants((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
              </div>
            ))}
            <div className="editor-actions">
              <button type="button" className="btn ghost" onClick={() => setPlants((current) => [...current, { plant: '', company: 'TPL' }])}>Add plant</button>
              <button type="button" className="btn" onClick={savePlants}>Save plant map</button>
            </div>
            <p className="hint">
              Templates: <a href="/samples/ME5A_sample.csv">ME5A</a> · <a href="/samples/ME2L_sample.csv">ME2L</a> · <a href="/samples/MB51_sample.csv">MB51</a>
            </p>
          </section>
        )}
      </main>
    </div>
  )
}

export default function BuyerApp() {
  const [authed, setAuthed] = useState(Boolean(getToken()))
  useEffect(() => { document.title = 'Purchase desk · Material Tracking' }, [])
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  return <Desk onUnauthorized={() => setAuthed(false)} />
}
