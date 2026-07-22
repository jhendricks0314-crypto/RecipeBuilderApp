import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { usePersistentState } from '../lib/persist.jsx'
import { mapPool } from '../lib/pool.js'
import { prepareReceiptFile } from '../lib/receiptFile.js'
import { Banner, Loading, Empty, Toast, Modal, Spinner } from '../components/ui.jsx'
import { money, fromNow } from '../lib/util.js'

// The price database: real prices you've recorded. Shopping lists always prefer
// these over AI estimates. Three ways in: type a price, scan a barcode, or
// photograph a receipt.
export default function Prices() {
  const [prices, setPrices] = useState(null)
  const [storeNames, setStoreNames] = useState([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [mode, setMode] = useState(null) // 'manual' | 'barcode' | 'receipt'

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1800) }

  const load = async (query = '') => {
    try {
      const d = await api.listPrices(query || undefined)
      setPrices(d.prices)
      setStoreNames(d.stores || [])
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  const onAdded = (msg) => { setMode(null); flash(msg); load(q) }

  const remove = async (id) => {
    if (!confirm('Remove this price?')) return
    try { await api.deletePrice(id); setPrices((p) => p.filter((x) => x.id !== id)); flash('Removed') }
    catch (e) { setError(e.message) }
  }

  if (prices === null) return <Loading label="Loading your prices…" />

  return (
    <div>
      <div className="section-title">Price Database</div>
      <h1 className="page-h">What things cost</h1>
      <p className="page-sub">
        Real prices you've recorded. Your shopping lists use these first, and only fall back to
        estimates for items you haven't priced yet.
      </p>

      {error && <Banner kind="error">{error}</Banner>}

      <div className="card">
        <div className="btn-row">
          <button className="btn btn-primary btn-sm" onClick={() => setMode('manual')}>＋ Enter a price</button>
          <button className="btn btn-dark btn-sm" onClick={() => setMode('barcode')}>Scan barcode</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setMode('receipt')}>Scan receipt</button>
        </div>
      </div>

      <div className="card">
        <input
          className="input"
          placeholder="Search prices by item or store…"
          value={q}
          onChange={(e) => { setQ(e.target.value); load(e.target.value) }}
        />
      </div>

      {prices.length === 0 ? (
        <div className="card">
          <Empty emoji="🧾" title="No prices yet">
            Add a price by hand, scan a barcode, or photograph a receipt — every price you record
            makes your shopping lists more accurate.
          </Empty>
        </div>
      ) : (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 6 }}>
            <span className="label" style={{ margin: 0 }}>Recorded prices</span>
            <span className="pill-count">{prices.length}</span>
          </div>
          {prices.map((p) => (
            <div key={p.id} className="check-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {p.store} · {p.date}
                  {p.source && p.source !== 'manual' ? ` · ${p.source}` : ''}
                </div>
              </div>
              <span className="price" style={{ fontSize: 15 }}>{money(p.unitPrice ?? p.price)}</span>
              <button className="linklike tomato" style={{ fontSize: 12 }} onClick={() => remove(p.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      {mode === 'manual' && <ManualPrice stores={storeNames} onClose={() => setMode(null)} onSaved={onAdded} />}
      {mode === 'barcode' && <BarcodePrice stores={storeNames} onClose={() => setMode(null)} onSaved={onAdded} />}
      {mode === 'receipt' && <ReceiptPrice onClose={() => setMode(null)} onSaved={onAdded} />}

      <Toast message={toast} />
    </div>
  )
}

// --- 1. Type a price in ------------------------------------------------------
function ManualPrice({ stores, onClose, onSaved, prefill }) {
  const [name, setName] = useState(prefill?.name || '')
  const [store, setStore] = usePersistentState('price.lastStore', '')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = usePersistentState('price.lastUnit', '1 lb')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true); setError('')
    try {
      await api.addPrice({
        name, store, price: Number(price), quantity: Number(quantity) || 1, unit,
        barcode: prefill?.barcode || null,
        source: prefill ? 'barcode' : 'manual',
      })
      onSaved(`Saved ${name}`)
    } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <Modal title={prefill ? 'Price this item' : 'Enter a price'} onClose={onClose}>
      {error && <Banner kind="error">{error}</Banner>}
      {prefill?.priceHistory?.length > 0 && (
        <Banner kind="info">
          <strong>You've bought this before</strong>
          <div style={{ marginTop: 4 }}>
            {prefill.priceHistory.map((p) => (
              <div key={p.store} style={{ fontSize: 13 }}>
                {p.store} — <span className="price">{money(p.price)}</span>
                <span className="muted"> · {p.date}</span>
              </div>
            ))}
          </div>
        </Banner>
      )}
      <div className="field">
        <label className="label">Item</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Whole milk, 1 gal" autoFocus={!prefill} />
      </div>
      <div className="field">
        <label className="label">Store</label>
        <input className="input" list="fc-stores" value={store} onChange={(e) => setStore(e.target.value)} placeholder="Aldi" />
        <datalist id="fc-stores">{stores.map((s) => <option key={s} value={s} />)}</datalist>
        <div className="hint">Your last store is remembered.</div>
      </div>
      <div className="field">
        <label className="label">What does that price buy?</label>
        <input className="input" list="fc-units" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="1 lb" />
        <datalist id="fc-units">
          {['1 lb', '1 oz', 'each', 'dozen', '16 oz box', '1 gallon', '64 fl oz', '1 bunch', '1 can'].map((u) => <option key={u} value={u} />)}
        </datalist>
        <div className="hint">Lets shopping lists scale it — 2.5 lbs of beef at $5.99/lb shows as $14.98, not $5.99.</div>
      </div>
      <div className="grid-2">
        <div className="field">
          <label className="label">Price paid</label>
          <input className="input" type="number" step="0.01" inputMode="decimal" value={price}
            onChange={(e) => setPrice(e.target.value)} placeholder="3.49" />
        </div>
        <div className="field">
          <label className="label">Quantity</label>
          <input className="input" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>
      <button className="btn btn-primary btn-block" disabled={busy || !name.trim() || !store.trim() || !(Number(price) > 0)} onClick={save}>
        {busy ? <Spinner /> : 'Save price'}
      </button>
    </Modal>
  )
}

// --- 2. Scan a barcode, then price it ---------------------------------------
function BarcodePrice({ stores, onClose, onSaved }) {
  const videoRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState(null) // { name, barcode }
  const [manualCode, setManualCode] = useState('')

  useEffect(() => {
    if (found) return
    let controls
    let stopped = false
    import('@zxing/browser')
      .then(({ BrowserMultiFormatReader }) => {
        if (stopped || !videoRef.current) return
        const reader = new BrowserMultiFormatReader()
        return reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (result && !stopped) { stopped = true; lookup(result.getText()) }
        }).then((c) => { controls = c })
      })
      .catch(() => setError('Camera unavailable — enter the barcode number instead.'))
    return () => { stopped = true; controls?.stop?.() }
  }, [found])

  const lookup = async (code) => {
    setBusy(true); setError('')
    try {
      const d = await api.lookupBarcode(code)
      if (d.found) {
        setFound({ name: d.name, barcode: code, priceHistory: d.priceHistory || [] })
      } else {
        setFound({ name: '', barcode: code })
        setError('Product not recognized — type its name below.')
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (found) {
    return <ManualPrice stores={stores} prefill={found} onClose={onClose} onSaved={onSaved} />
  }

  return (
    <Modal title="Scan a barcode" onClose={onClose}>
      {error && <Banner kind="error">{error}</Banner>}
      <div style={{ borderRadius: 14, overflow: 'hidden', background: '#000', aspectRatio: '4/3', display: 'grid', placeItems: 'center' }}>
        <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
      </div>
      <p className="muted" style={{ fontSize: 13 }}>{busy ? 'Looking it up…' : 'Hold the barcode steady in view.'}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" placeholder="…or type the barcode number" value={manualCode}
          inputMode="numeric" onChange={(e) => setManualCode(e.target.value)} />
        <button className="btn btn-ghost" disabled={busy || !manualCode.trim()} onClick={() => lookup(manualCode.trim())}>Look up</button>
      </div>
    </Modal>
  )
}

// --- 3. Photograph receipts (one or many) -----------------------------------
// Accepts a batch: shoot a receipt at the register, or upload a folder of
// receipts you downloaded from Walmart's lookup tool / purchase history.
// Each is read by Claude, food-only, then reviewed together before saving.
function ReceiptPrice({ onClose, onSaved }) {
  const [store, setStore] = usePersistentState('price.lastStore', '')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [items, setItems] = useState(null)
  const [dropped, setDropped] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total }
  const [error, setError] = useState('')

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setBusy(true); setError('')
    setProgress({ done: 0, total: files.length })

    // Receipts are independent of each other, so read several at once rather
    // than one after another. Three in flight keeps a folder of receipts quick
    // without hammering the API.
    const results = await mapPool(
      files,
      async (file) => {
        // PDFs go through as-is; photos get converted to JPEG and downsized so
        // odd camera formats work and uploads stay quick.
        const { base64, mediaType } = await prepareReceiptFile(file)
        const d = await api.parseReceipt({ imageBase64: base64, mediaType, store })
        return { file, d }
      },
      { concurrency: 3, onProgress: (done, total) => setProgress({ done, total }) }
    )

    const all = []
    const skipped = []
    const failures = []
    let firstStore = store
    let firstDate = null

    results.forEach((r, i) => {
      if (!r?.ok) { failures.push(`${files[i].name}${r?.error?.message ? ` (${r.error.message})` : ''}`); return }
      const { file, d } = r.value
      if (d.store && !firstStore) firstStore = d.store
      if (d.date && !firstDate) firstDate = d.date
      // Tag each row with the receipt it came from, so a batch stays reviewable.
      for (const it of d.items || []) all.push({ ...it, _from: file.name, _store: d.store || firstStore, _date: d.date })
      skipped.push(...(d.droppedNonFood || []))
    })

    setBusy(false); setProgress(null)
    if (firstStore) setStore(firstStore)
    if (firstDate) setDate(firstDate)
    setDropped([...new Set(skipped)])
    if (failures.length) setError(`Couldn't read: ${failures.join(', ')}`)
    if (!all.length) { setError((p) => p || 'No food items found in those receipts.'); return }
    setItems(all)
  }

  const commit = async () => {
    const clean = (items || []).filter((i) => i.name.trim() && Number(i.price) > 0)
    if (!clean.length) { setError('Nothing to save.'); return }
    setBusy(true); setError('')
    try {
      // Group by the store/date each row actually came from, so a batch of
      // receipts from different trips is recorded with the right dates.
      const groups = new Map()
      for (const it of clean) {
        const st = (it._store || store).trim()
        const dt = it._date || date
        const key = `${st}|${dt}`
        if (!groups.has(key)) groups.set(key, { store: st, date: dt, items: [] })
        groups.get(key).items.push({ name: it.name, price: Number(it.price), quantity: Number(it.quantity) || 1 })
      }
      let total = 0
      for (const g of groups.values()) {
        const { saved } = await api.commitReceipt(g)
        total += saved
      }
      onSaved(`Added ${total} price${total !== 1 ? 's' : ''} from ${groups.size} receipt${groups.size !== 1 ? 's' : ''}`)
    } catch (e) { setError(e.message); setBusy(false) }
  }

  const receiptCount = items ? new Set(items.map((i) => i._from)).size : 0

  return (
    <Modal title="Scan receipts" onClose={onClose}>
      {error && <Banner kind="error">{error}</Banner>}

      {!items ? (
        <>
          <div className="field">
            <label className="label">Store <span className="muted" style={{ fontWeight: 400 }}>(optional — read from the receipt)</span></label>
            <input className="input" value={store} onChange={(e) => setStore(e.target.value)} placeholder="Walmart" />
          </div>
          <label className="btn btn-primary btn-block" style={{ cursor: 'pointer' }}>
            {busy
              ? <><Spinner /> Reading {progress ? `${progress.done}/${progress.total}` : ''}…</>
              : '📄 Upload receipts (PDF or photo)'}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,image/*"
              multiple hidden onChange={onFiles} disabled={busy}
            />
          </label>
          <label className="btn btn-ghost btn-block" style={{ cursor: 'pointer', marginTop: 8 }}>
            📷 Take a photo instead
            <input type="file" accept="image/*" capture="environment" hidden onChange={onFiles} disabled={busy} />
          </label>

          <p className="muted" style={{ fontSize: 13 }}>
            <strong>PDF, JPEG, PNG, GIF or WebP</strong> — several at once is fine. Walmart lets you
            download a PDF receipt from your order history, and those read far more accurately than
            a photo. Non-food (paper towels, etc.) is dropped automatically, and you review
            everything before it's saved.
          </p>
        </>
      ) : (
        <>
          <Banner kind="info">
            {items.length} item{items.length !== 1 ? 's' : ''} from {receiptCount} receipt{receiptCount !== 1 ? 's' : ''}.
          </Banner>

          <div className="grid-2">
            <div className="field">
              <label className="label">Store (fallback)</label>
              <input className="input" value={store} onChange={(e) => setStore(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Date (fallback)</label>
              <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="hint" style={{ marginBottom: 10 }}>
            Rows keep the store and date read from their own receipt; these fill any gaps.
          </div>

          {dropped.length > 0 && <Banner kind="info">Skipped non-food: {dropped.join(', ')}</Banner>}

          {items.map((it, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" value={it.name}
                  onChange={(e) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                <input className="input" style={{ width: 90 }} type="number" step="0.01" value={it.price}
                  onChange={(e) => setItems((xs) => xs.map((x, k) => (k === i ? { ...x, price: e.target.value } : x)))} />
                <button className="linklike tomato" onClick={() => setItems((xs) => xs.filter((_, k) => k !== i))}>×</button>
              </div>
              {(it._store || it._date) && (
                <div className="muted" style={{ fontSize: 11 }}>
                  {it._store || store}{it._date ? ` · ${it._date}` : ''}
                </div>
              )}
            </div>
          ))}
          <button className="linklike" onClick={() => setItems((xs) => [...xs, { name: '', price: '', quantity: 1 }])}>+ add row</button>

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={commit} disabled={busy || !store.trim()}>
              {busy ? <Spinner /> : `Save ${items.length} price${items.length !== 1 ? 's' : ''}`}
            </button>
            <button className="btn btn-ghost" onClick={() => { setItems(null); setDropped([]); setError('') }}>Start over</button>
          </div>
        </>
      )}
    </Modal>
  )
}
