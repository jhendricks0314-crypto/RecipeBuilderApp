import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { usePersistentState } from '../lib/persist.jsx'
import { Banner, Spinner, Toast } from '../components/ui.jsx'
import { money } from '../lib/util.js'

// Capture a grocery receipt with the camera (or upload a photo), let Claude
// vision read it, review the food-only rows, and contribute them to the shared
// price database that powers shopping-list pricing.
export default function ReceiptScanner() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [camOn, setCamOn] = useState(false)
  // Store name + reviewed rows are cached so a half-finished receipt survives a close.
  const [store, setStore] = usePersistentState('receipt.store', '')
  const [date, setDate] = usePersistentState('receipt.date', () => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = usePersistentState('receipt.items', null) // parsed, editable rows
  const [dropped, setDropped] = usePersistentState('receipt.dropped', [])
  const [toast, setToast] = useState('')

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1800) }

  useEffect(() => () => stopCam(), [])

  const startCam = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
      setCamOn(true)
    } catch {
      setError('Camera access was blocked. You can upload a photo of the receipt instead.')
    }
  }
  const stopCam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCamOn(false)
  }

  const parse = async (base64, mediaType) => {
    if (!store.trim()) { setError('Enter the store name first.'); return }
    setBusy(true); setError('')
    try {
      const res = await api.parseReceipt({ imageBase64: base64, mediaType, store: store.trim() })
      setItems(res.items)
      setDropped(res.droppedNonFood || [])
      if (res.date) setDate(res.date)
      if (!res.items.length) setError('No food items were detected. Try a clearer photo or add rows manually.')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const captureFrame = async () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    stopCam()
    await parse(dataUrl.split(',')[1], 'image/jpeg')
  }

  const onUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => parse(String(reader.result).split(',')[1], file.type || 'image/jpeg')
    reader.readAsDataURL(file)
  }

  // Row editing
  const patchRow = (id, patch) => setItems((its) => its.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  const removeRow = (id) => setItems((its) => its.filter((it) => it.id !== id))
  const addRow = () => setItems((its) => [...(its || []), { id: `new_${Date.now()}`, name: '', price: 0, quantity: 1, unitPrice: 0 }])

  const commit = async () => {
    const clean = items.filter((i) => i.name.trim())
    if (!clean.length) { setError('Add at least one item.'); return }
    setBusy(true); setError('')
    try {
      const { saved } = await api.commitReceipt({
        store: store.trim(),
        date,
        items: clean.map((i) => ({ ...i, unitPrice: Number(i.unitPrice) || Number(i.price) || 0 })),
      })
      flash(`Saved ${saved} item${saved !== 1 ? 's' : ''} to the price database`)
      setItems(null); setDropped([]); setStore(''); setDate(new Date().toISOString().slice(0, 10))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="section-title">Receipt Scanner</div>
      <h1 className="page-h">Scan a receipt</h1>
      <p className="page-sub">Snap your grocery receipt and ForkCast reads the food items and their prices. Those prices quietly power everyone's shopping-list estimates.</p>

      {error && <Banner kind="error">{error}</Banner>}

      {items === null ? (
        <div className="card">
          <div className="field">
            <label className="label">Which store is this receipt from?</label>
            <input className="input" placeholder="e.g. Walmart, Aldi, Harps" value={store} onChange={(e) => setStore(e.target.value)} />
          </div>

          <div style={{ borderRadius: 14, overflow: 'hidden', background: 'var(--ink)', aspectRatio: '3/4', display: camOn ? 'block' : 'none' }}>
            <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>

          {camOn ? (
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={captureFrame} disabled={busy}>
                {busy ? <><Spinner /> Reading…</> : 'Capture & read'}
              </button>
              <button className="btn btn-ghost" onClick={stopCam}>Cancel</button>
            </div>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 13 }}>Hold the receipt flat and fill the frame. For long receipts, capture in sections and add more items by hand.</p>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={startCam} disabled={busy}>📷 Open camera</button>
                <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
                  {busy ? <><Spinner /> Reading…</> : 'Upload photo'}
                  <input type="file" accept="image/*" hidden onChange={onUpload} />
                </label>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="row-between">
            <div>
              <strong>{store}</strong>
              <div className="muted" style={{ fontSize: 13 }}>{items.length} food item{items.length !== 1 ? 's' : ''} detected</div>
            </div>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 'auto' }} />
          </div>

          {dropped.length > 0 && (
            <Banner kind="warn"><span style={{ fontSize: 13 }}>Skipped non-food: {dropped.join(', ')}</span></Banner>
          )}

          <hr className="perf" />
          <div className="stack">
            {items.map((it) => (
              <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="input" style={{ flex: 1 }} placeholder="Item" value={it.name} onChange={(e) => patchRow(it.id, { name: e.target.value })} />
                <input className="input" style={{ width: 58, padding: '8px' }} type="number" min="0" step="1" value={it.quantity} onChange={(e) => patchRow(it.id, { quantity: Number(e.target.value) })} aria-label="quantity" />
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }}>$</span>
                  <input className="input price" style={{ width: 92, padding: '8px 8px 8px 20px' }} type="number" min="0" step="0.01" value={it.price}
                    onChange={(e) => { const price = Number(e.target.value); patchRow(it.id, { price, unitPrice: it.quantity ? price / it.quantity : price }) }} aria-label="price" />
                </div>
                <button className="linklike tomato" style={{ fontSize: 12 }} onClick={() => removeRow(it.id)}>×</button>
              </div>
            ))}
          </div>
          <button className="linklike" style={{ marginTop: 10 }} onClick={addRow}>+ Add a row</button>

          <hr className="perf" />
          <div className="row-between">
            <span className="muted" style={{ fontSize: 13 }}>Total <span className="price">{money(items.reduce((s, i) => s + (Number(i.price) || 0), 0))}</span></span>
            <div className="btn-row">
              <button className="btn btn-ghost btn-sm" onClick={() => { setItems(null); setDropped([]) }}>Discard</button>
              <button className="btn btn-primary btn-sm" onClick={commit} disabled={busy}>{busy ? <Spinner /> : 'Save to database'}</button>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast} />
    </div>
  )
}
