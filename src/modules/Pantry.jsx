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
          <button className={`chip ${mode === 'photo' ? 'on' : ''}`} onClick={() => setMode('photo')}>Scan / photo</button>
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
  const scanningRef = useRef(false)
  const foundRef = useRef(new Map())   // normalized name -> { name, category, quantity, sightings, on }

  const [err, setErr] = useState('')
  const [scanning, setScanning] = useState(false)
  const [frames, setFrames] = useState(0)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState(null)      // review list (after stopping)
  const [live, setLive] = useState([])          // what we've spotted so far

  // Camera on while the modal is open.
  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
      })
      .catch((e) => setErr(cameraMessage(e)))
    return () => {
      cancelled = true
      scanningRef.current = false
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const key = (name) => (name || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/s\b/g, '').replace(/\s+/g, ' ').trim()

  // Merge one frame's results into the running set. Seeing an item in more than
  // one frame raises confidence — this is what fixes the "grapes only at some
  // angles" problem: we take the UNION across the whole sweep.
  const merge = (items) => {
    const map = foundRef.current
    for (const it of items) {
      const k = key(it.name)
      if (!k) continue
      const prev = map.get(k)
      if (prev) prev.sightings += 1
      else map.set(k, { name: it.name, category: normalizeCategory(it.category), quantity: it.quantity || '', sightings: 1, on: true })
    }
    setLive([...map.values()].sort((a, b) => b.sightings - a.sightings))
  }

  // Grab a frame, downscaled to keep each request fast.
  const grabFrame = () => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const maxW = 1024
    const scale = Math.min(1, maxW / v.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(v.videoWidth * scale)
    canvas.height = Math.round(v.videoHeight * scale)
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.7)
  }

  const identify = async (dataUrl) => {
    const [meta, b64] = dataUrl.split(',')
    const media = /data:(.*?);/.exec(meta)?.[1] || 'image/jpeg'
    const { items } = await api.identifyPantry({ imageBase64: b64, mediaType: media })
    return items || []
  }

  // Continuous sweep: one frame at a time (sequential, so requests never pile up).
  const startScan = async () => {
    setErr(''); setScanning(true); scanningRef.current = true
    while (scanningRef.current) {
      const frame = grabFrame()
      if (!frame) { await sleep(400); continue }
      try {
        const items = await identify(frame)
        if (!scanningRef.current) break
        merge(items)
        setFrames((n) => n + 1)
      } catch (e) {
        // One bad frame shouldn't end the sweep.
        if (!scanningRef.current) break
        setErr(e.message)
      }
      await sleep(1200) // breathe between frames
    }
  }

  const stopScan = () => {
    scanningRef.current = false
    setScanning(false)
    const all = [...foundRef.current.values()].sort((a, b) => b.sightings - a.sightings)
    if (!all.length) { setErr('Nothing recognized. Try more light, or add by hand.'); return }
    setFound(all)
  }

  // Single shot / upload still available.
  const captureOnce = async () => {
    const frame = grabFrame()
    if (!frame) { setErr('Camera not ready yet.'); return }
    setBusy(true); setErr('')
    try {
      merge(await identify(frame))
      setFrames((n) => n + 1)
      const all = [...foundRef.current.values()].sort((a, b) => b.sightings - a.sightings)
      if (!all.length) setErr('No items recognized. Try better lighting or add by hand.')
      else setFound(all)
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const onUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      setBusy(true); setErr('')
      try {
        merge(await identify(reader.result))
        const all = [...foundRef.current.values()].sort((a, b) => b.sightings - a.sightings)
        if (!all.length) setErr('No items recognized in that photo.')
        else setFound(all)
      } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
    }
    reader.readAsDataURL(file)
  }

  const addSelected = () => {
    onAdd(found.filter((i) => i.on).map((i) => ({ name: i.name, category: i.category, quantity: i.quantity, source: 'photo' })))
    onClose()
  }

  const rescan = () => {
    setFound(null)
    setErr('')
  }

  return (
    <Modal title={found ? 'Review what I found' : 'Scan your pantry'} onClose={onClose}>
      {!found && (
        <>
          {err && <Banner kind="warn">{err}</Banner>}
          <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000', aspectRatio: '4/3' }}>
            <video ref={videoRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
            {scanning && (
              <div style={{
                position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(22,35,28,0.75)', color: '#fff', padding: '6px 12px', borderRadius: 999,
                fontSize: 12.5, fontWeight: 700,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--tomato)' }} />
                Scanning · {frames} frame{frames !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          <p className="muted" style={{ fontSize: 13.5, marginBottom: 8 }}>
            {scanning
              ? 'Sweep the camera slowly across your shelves. Items are added as they\'re spotted — different angles catch different things.'
              : 'Press start, then pan slowly across your pantry or fridge.'}
          </p>

          {live.length > 0 && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <div className="row-between" style={{ marginBottom: 6 }}>
                <span className="label" style={{ margin: 0 }}>Spotted so far</span>
                <span className="pill-count">{live.length}</span>
              </div>
              <div className="chips">
                {live.slice(0, 24).map((i) => (
                  <span key={i.name} className="chip" style={{ cursor: 'default' }}>
                    {categoryEmoji(i.category)} {i.name}
                    {i.sightings > 1 && <span className="mono muted" style={{ marginLeft: 4, fontSize: 11 }}>×{i.sightings}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="btn-row">
            {!scanning ? (
              <button className="btn btn-primary" onClick={startScan} disabled={busy || !!streamRef.current === false}>
                ● Start scan
              </button>
            ) : (
              <button className="btn btn-danger" onClick={stopScan}>■ Stop scan</button>
            )}
            {!scanning && (
              <>
                <button className="btn btn-ghost" onClick={captureOnce} disabled={busy}>
                  {busy ? <><Spinner /> Reading…</> : 'Single shot'}
                </button>
                <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
                  Upload photo
                  <input type="file" accept="image/*" hidden onChange={onUpload} />
                </label>
              </>
            )}
            {!scanning && live.length > 0 && (
              <button className="btn btn-dark" onClick={() => setFound([...foundRef.current.values()].sort((a, b) => b.sightings - a.sightings))}>
                Review {live.length}
              </button>
            )}
          </div>
        </>
      )}

      {found && (
        <>
          {err && <Banner kind="warn">{err}</Banner>}
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            Found {found.length} item{found.length !== 1 ? 's' : ''} across {frames} frame{frames !== 1 ? 's' : ''}.
            Untick anything wrong, fix names or categories, then add.
          </p>
          <div className="stack">
            {found.map((it, i) => (
              <div key={i} className="check-row" style={{ padding: '8px 0' }}>
                <span className={`checkbox ${it.on ? 'on' : ''}`} onClick={() => setFound((f) => f.map((x, idx) => (idx === i ? { ...x, on: !x.on } : x)))}>{it.on ? '✓' : ''}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <input className="input" style={{ padding: '6px 10px' }} value={it.name} onChange={(e) => setFound((f) => f.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))} />
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                    <select className="select" style={{ padding: '6px 10px' }} value={it.category} onChange={(e) => setFound((f) => f.map((x, idx) => (idx === i ? { ...x, category: e.target.value } : x)))}>
                      {PANTRY_CATEGORIES.map((c) => <option key={c} value={c}>{categoryEmoji(c)} {c}</option>)}
                    </select>
                    {it.sightings > 1 && <span className="muted mono" style={{ fontSize: 11 }}>seen ×{it.sightings}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn btn-primary" onClick={addSelected} disabled={!found.some((i) => i.on)}>
              Add {found.filter((i) => i.on).length} to pantry
            </button>
            <button className="btn btn-ghost" onClick={rescan}>Scan more</button>
          </div>
        </>
      )}
    </Modal>
  )
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
