import { useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { usePersistentState } from '../lib/persist.jsx'
import { Banner, Loading, Empty, Toast, Modal, Spinner } from '../components/ui.jsx'
import { IconPantry, IconBarcode, IconCamera, IconClose } from '../components/icons.jsx'
import { PANTRY_CATEGORIES, categoryEmoji, normalizeCategory } from '../lib/util.js'

const keyOf = (i) => `${i.name.toLowerCase()}|${i.category}`

export default function Pantry() {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState('manual') // 'manual' | 'barcode' | 'photo'

  useEffect(() => {
    api.getPantry().then((d) => setItems(d.items)).catch((e) => setError(e.message))
  }, [])

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1600) }

  const persist = async (next) => {
    setItems(next)
    setSaving(true)
    try { await api.savePantry(next) } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const addItems = (incoming) => {
    const clean = incoming
      .map((i) => ({
        id: 'pit_' + Math.random().toString(36).slice(2, 10),
        name: (i.name || '').trim(),
        category: normalizeCategory(i.category),
        quantity: (i.quantity || '').toString().trim(),
        source: i.source || 'manual',
        barcode: i.barcode || null,
        addedAt: new Date().toISOString(),
      }))
      .filter((i) => i.name)
    if (!clean.length) return
    const seen = new Set((items || []).map(keyOf))
    const merged = [...(items || [])]
    let added = 0
    for (const it of clean) {
      if (!seen.has(keyOf(it))) { seen.add(keyOf(it)); merged.push(it); added++ }
    }
    persist(merged)
    flash(added ? `Added ${added} item${added !== 1 ? 's' : ''}` : 'Already in your pantry')
  }

  const editItem = (id, patch) => persist(items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const removeItem = (id) => persist(items.filter((i) => i.id !== id))

  const grouped = useMemo(() => {
    const g = {}
    for (const it of items || []) (g[it.category] ||= []).push(it)
    return PANTRY_CATEGORIES.filter((c) => g[c]?.length).map((c) => [c, g[c].sort((a, b) => a.name.localeCompare(b.name))])
  }, [items])

  if (items === null) return <Loading label="Opening your pantry…" />

  const cookFromPantry = () => {
    if (!items.length) return
    navigate('/generate', { state: { pantryItems: items.map((i) => i.name), onlyPantry: true } })
  }

  return (
    <div>
      <div className="row-between">
        <div>
          <div className="section-title">Pantry</div>
          <h1 className="page-h">What's in your kitchen</h1>
        </div>
        {saving && <span className="muted" style={{ fontSize: 12 }}><Spinner /> saving</span>}
      </div>
      <p className="page-sub">Keep a running list of what you have on hand — add items by hand, scan a barcode, or snap a photo. Then cook using what you've already got.</p>

      {error && <Banner kind="error">{error}</Banner>}

      {/* Add methods */}
      <div className="card">
        <div className="chips" style={{ marginBottom: 14 }}>
          <button className={`chip ${mode === 'manual' ? 'on' : ''}`} onClick={() => setMode('manual')}>Add by hand</button>
          <button className={`chip ${mode === 'barcode' ? 'on' : ''}`} onClick={() => setMode('barcode')}><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Scan barcode</span></button>
          <button className={`chip ${mode === 'photo' ? 'on' : ''}`} onClick={() => setMode('photo')}>Snap a photo</button>
        </div>
        {mode === 'manual' && <ManualAdd onAdd={(it) => addItems([it])} />}
        {mode === 'barcode' && <BarcodeButton onAdd={addItems} />}
        {mode === 'photo' && <PhotoButton onAdd={addItems} />}
      </div>

      {/* Cook CTA */}
      {items.length > 0 && (
        <button className="btn btn-primary btn-block" style={{ marginBottom: 16 }} onClick={cookFromPantry}>
          🍳 Cook from my pantry ({items.length} item{items.length !== 1 ? 's' : ''})
        </button>
      )}

      {/* Grouped list */}
      {items.length === 0 ? (
        <div className="card"><Empty emoji="🥫" title="Your pantry is empty">Add what you have and it'll show up here, grouped by category.</Empty></div>
      ) : (
        <div className="stack">
          {grouped.map(([cat, list]) => (
            <div className="card" key={cat}>
              <div className="row-between" style={{ marginBottom: 6 }}>
                <strong style={{ fontSize: 15 }}>{categoryEmoji(cat)} {cat}</strong>
                <span className="pill-count">{list.length}</span>
              </div>
              {list.map((it) => (
                <PantryRow key={it.id} item={it} onEdit={(patch) => editItem(it.id, patch)} onRemove={() => removeItem(it.id)} />
              ))}
            </div>
          ))}
        </div>
      )}

      <Toast message={toast} />
    </div>
  )
}

// ---- Manual entry ----------------------------------------------------------
function ManualAdd({ onAdd }) {
  const [name, setName] = usePersistentState('pantry.draft.name', '')
  const [category, setCategory] = usePersistentState('pantry.draft.category', '')
  const [touchedCat, setTouchedCat] = useState(false)
  const [quantity, setQuantity] = usePersistentState('pantry.draft.quantity', '')

  const onName = (v) => {
    setName(v)
    if (!touchedCat) setCategory(normalizeCategory(v))
  }
  const submit = () => {
    if (!name.trim()) return
    onAdd({ name, category: category || normalizeCategory(name), quantity, source: 'manual' })
    setName(''); setQuantity(''); setCategory(''); setTouchedCat(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" placeholder="e.g. Black beans" value={name}
          onChange={(e) => onName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <input className="input" style={{ width: 96 }} placeholder="Qty" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <select className="select" value={category || normalizeCategory(name)} onChange={(e) => { setCategory(e.target.value); setTouchedCat(true) }}>
          {PANTRY_CATEGORIES.map((c) => <option key={c} value={c}>{categoryEmoji(c)} {c}</option>)}
        </select>
        <button className="btn btn-primary" onClick={submit} disabled={!name.trim()}>Add</button>
      </div>
    </div>
  )
}

// ---- Barcode ---------------------------------------------------------------
function BarcodeButton({ onAdd }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Point your camera at a product barcode. We'll look up the name automatically.</p>
      <button className="btn btn-dark" onClick={() => setOpen(true)}><IconBarcode /> Open barcode scanner</button>
      {open && <BarcodeScanner onAdd={onAdd} onClose={() => setOpen(false)} />}
    </div>
  )
}

function BarcodeScanner({ onAdd, onClose }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const busyRef = useRef(false)
  const pendingRef = useRef(false)
  const lastRef = useRef({ code: '', at: 0 })
  const [err, setErr] = useState('')
  const [pending, setPending] = useState(null) // { found, name, category, image, upc }
  const [manual, setManual] = useState('')

  useEffect(() => { pendingRef.current = !!pending }, [pending])

  const lookup = async (code) => {
    busyRef.current = true
    try {
      const res = await api.lookupBarcode(code)
      setPending(res.found ? res : { found: false, upc: code })
    } catch (e) {
      setPending({ found: false, upc: code, error: e.message })
    } finally {
      busyRef.current = false
    }
  }

  useEffect(() => {
    let cancelled = false
    // Load the barcode reader on demand so it isn't in the main bundle.
    import('@zxing/browser')
      .then(({ BrowserMultiFormatReader }) => {
        if (cancelled) return
        const reader = new BrowserMultiFormatReader()
        return reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (cancelled || !result) return
          if (busyRef.current || pendingRef.current) return
          const code = result.getText()
          const now = Date.now()
          if (code === lastRef.current.code && now - lastRef.current.at < 3000) return
          lastRef.current = { code, at: now }
          lookup(code)
        })
      })
      .then((controls) => {
        controlsRef.current = controls
        if (cancelled && controls) controls.stop()
      })
      .catch((e) => { if (!cancelled) setErr(cameraMessage(e)) })
    return () => {
      cancelled = true
      try { controlsRef.current?.stop() } catch {}
    }
  }, [])

  const accept = () => {
    if (pending?.found) onAdd([{ name: pending.name, category: pending.category, quantity: pending.quantity, source: 'barcode', barcode: pending.upc }])
    setPending(null)
  }

  return (
    <Modal title="Scan a barcode" onClose={onClose}>
      {err ? (
        <Banner kind="warn">{err} You can type the barcode number instead.</Banner>
      ) : (
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
          <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
          <div style={{ position: 'absolute', inset: '30% 12%', border: '2px solid rgba(255,255,255,0.8)', borderRadius: 10 }} />
        </div>
      )}

      {pending && (
        <div className="card" style={{ marginTop: 12 }}>
          {pending.found ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {pending.image && <img src={pending.image} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{pending.name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{categoryEmoji(normalizeCategory(pending.category))} {normalizeCategory(pending.category)}{pending.quantity ? ` · ${pending.quantity}` : ''}</div>
              </div>
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 14 }}>No match for <span className="mono">{pending.upc}</span>. Add it by hand from the “Add by hand” tab.</div>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            {pending.found && <button className="btn btn-primary btn-sm" onClick={accept}>Add to pantry</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>{pending.found ? 'Skip' : 'Keep scanning'}</button>
          </div>
        </div>
      )}

      <div className="divider-label">or enter the number</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input className="input" placeholder="Barcode digits" value={manual} inputMode="numeric"
          onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && manual.trim()) { lookup(manual.replace(/\D/g, '')); setManual('') } }} />
        <button className="btn btn-ghost" disabled={!manual.trim()} onClick={() => { lookup(manual.replace(/\D/g, '')); setManual('') }}>Look up</button>
      </div>
    </Modal>
  )
}

// ---- Photo -----------------------------------------------------------------
function PhotoButton({ onAdd }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Take a photo of your cabinet, fridge, or counter and we'll identify what's there.</p>
      <button className="btn btn-dark" onClick={() => setOpen(true)}><IconCamera /> Snap a photo</button>
      {open && <PhotoIdentify onAdd={onAdd} onClose={() => setOpen(false)} />}
    </div>
  )
}

function PhotoIdentify({ onAdd, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState(null) // array of { name, category, quantity, on }

  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
      })
      .catch((e) => setErr(cameraMessage(e)))
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()) }
  }, [])

  const identifyFromDataUrl = async (dataUrl) => {
    setBusy(true); setErr('')
    try {
      const [meta, b64] = dataUrl.split(',')
      const media = /data:(.*?);/.exec(meta)?.[1] || 'image/jpeg'
      const { items } = await api.identifyPantry({ imageBase64: b64, mediaType: media })
      if (!items.length) setErr('No items recognized. Try better lighting or add by hand.')
      setFound(items.map((i) => ({ ...i, category: normalizeCategory(i.category), on: true })))
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const capture = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) { setErr('Camera not ready yet.'); return }
    const canvas = document.createElement('canvas')
    canvas.width = v.videoWidth; canvas.height = v.videoHeight
    canvas.getContext('2d').drawImage(v, 0, 0)
    identifyFromDataUrl(canvas.toDataURL('image/jpeg', 0.8))
  }

  const onUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => identifyFromDataUrl(reader.result)
    reader.readAsDataURL(file)
  }

  const addSelected = () => {
    onAdd(found.filter((i) => i.on).map((i) => ({ name: i.name, category: i.category, quantity: i.quantity, source: 'photo' })))
    onClose()
  }

  return (
    <Modal title="Identify from a photo" onClose={onClose}>
      {!found && (
        <>
          {err && <Banner kind="warn">{err}</Banner>}
          {!err && (
            <div style={{ borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
              <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
            </div>
          )}
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={capture} disabled={busy || !!err}>{busy ? <><Spinner /> Reading…</> : 'Capture & identify'}</button>
            <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
              Upload photo
              <input type="file" accept="image/*" hidden onChange={onUpload} />
            </label>
          </div>
        </>
      )}

      {found && (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>Found {found.length} item{found.length !== 1 ? 's' : ''}. Untick anything wrong, tweak categories, then add.</p>
          <div className="stack">
            {found.map((it, i) => (
              <div key={i} className="check-row" style={{ padding: '8px 0' }}>
                <span className={`checkbox ${it.on ? 'on' : ''}`} onClick={() => setFound((f) => f.map((x, idx) => (idx === i ? { ...x, on: !x.on } : x)))}>{it.on ? '✓' : ''}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input className="input" style={{ padding: '6px 10px' }} value={it.name} onChange={(e) => setFound((f) => f.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))} />
                  <select className="select" style={{ padding: '6px 10px', marginTop: 6 }} value={it.category} onChange={(e) => setFound((f) => f.map((x, idx) => (idx === i ? { ...x, category: e.target.value } : x)))}>
                    {PANTRY_CATEGORIES.map((c) => <option key={c} value={c}>{categoryEmoji(c)} {c}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={addSelected} disabled={!found.some((i) => i.on)}>Add selected</button>
            <button className="btn btn-ghost" onClick={() => setFound(null)}>Retake</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ---- A single pantry row (inline edit) ------------------------------------
function PantryRow({ item, onEdit, onRemove }) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="check-row" style={{ padding: '10px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" style={{ padding: '6px 10px' }} defaultValue={item.name} onBlur={(e) => onEdit({ name: e.target.value.trim() || item.name })} />
            <input className="input" style={{ padding: '6px 10px', width: 84 }} defaultValue={item.quantity} placeholder="Qty" onBlur={(e) => onEdit({ quantity: e.target.value.trim() })} />
          </div>
        ) : (
          <div>
            <span style={{ fontWeight: 500 }}>{item.name}</span>
            {item.quantity && <span className="mono muted" style={{ fontSize: 12.5 }}> · {item.quantity}</span>}
          </div>
        )}
      </div>
      <button className="linklike" style={{ fontSize: 12.5 }} onClick={() => setEditing((v) => !v)}>{editing ? 'done' : 'edit'}</button>
      <button className="linklike tomato" style={{ fontSize: 12.5 }} onClick={onRemove}>remove</button>
    </div>
  )
}

function cameraMessage(e) {
  const n = e?.name || ''
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Camera permission was blocked.'
  if (n === 'NotFoundError') return 'No camera was found on this device.'
  return 'Camera not available on this device/browser.'
}
