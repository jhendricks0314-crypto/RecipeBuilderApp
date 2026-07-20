import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api.js'
import { usePersistentState } from '../lib/persist.jsx'
import { useAuth } from '../lib/auth.jsx'
import { Banner, Loading, Empty, Toast, Spinner, Modal, RecipeIcon } from '../components/ui.jsx'
import { money, fromNow } from '../lib/util.js'

export default function ShoppingList() {
  const routerState = useLocation().state
  const [lists, setLists] = useState(null)
  const [active, setActive] = useState(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [zip, setZip] = usePersistentState('shop.zip', '') // remember pricing ZIP
  const [pricing, setPricing] = useState(false)
  const [emailing, setEmailing] = useState(false)
  // Building a new list now lives here too, so picking recipes and shopping
  // for them are one screen instead of two.
  const [recipes, setRecipes] = useState(null)
  const [picked, setPicked] = usePersistentState('shop.picked', {})
  const [building, setBuilding] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    api.listRecipes().then((d) => setRecipes(d.recipes)).catch(() => setRecipes([]))
  }, [])

  // Arriving from Generate ("Save & build shopping list") or the cookbook's
  // multi-select: preselect those recipes, and build straight away when asked.
  const handoff = useRef(false)
  useEffect(() => {
    const ids = routerState?.recipeIds
    if (!ids?.length || handoff.current) return
    handoff.current = true
    const pre = {}
    ids.forEach((id) => { pre[id] = true })
    setPicked(pre)
    setShowPicker(true)
    if (routerState.autoGenerate) buildListFrom(ids)
  }, [routerState])

  useEffect(() => {
    api.listShoppingLists()
      .then((d) => {
        setLists(d.lists)
        const initial = routerState?.listId ? d.lists.find((l) => l.id === routerState.listId) : d.lists[0]
        setActive(initial || null)
      })
      .catch((e) => setError(e.message))
  }, []) // eslint-disable-line

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1600) }

  const persist = async (next) => {
    setActive(next)
    setLists((ls) => ls.map((l) => (l.id === next.id ? next : l)))
    try { await api.updateShoppingList(next) } catch (e) { setError(e.message) }
  }

  const patchItem = (itemId, patch) => {
    const next = { ...active, items: active.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }
    persist(next)
  }
  const removeItem = (itemId) => persist({ ...active, items: active.items.filter((it) => it.id !== itemId) })

  // Recorded prices (receipts/barcode/manual) always win; anything unpriced gets
  // an AI estimate for this ZIP. The ZIP is saved to the profile and persists.
  const pickedIds = Object.keys(picked).filter((k) => picked[k])

  const buildListFrom = async (ids) => {
    if (!ids?.length) { setError('Pick at least one recipe.'); return }
    setBuilding(true); setError('')
    try {
      const { list } = await api.generateList(ids, [])
      setLists((ls) => [list, ...(ls || [])])
      setActive(list)
      setPicked({})
      setShowPicker(false)
      flash(`Built a list from ${ids.length} recipe${ids.length !== 1 ? 's' : ''}`)
    } catch (e) { setError(e.message) } finally { setBuilding(false) }
  }
  const buildList = () => buildListFrom(pickedIds)

  const priceList = async (force = false) => {
    if (!active) return
    setPricing(true); setError('')
    try {
      const { list, estimated, note } = await api.estimatePrices(active.id, zip.trim() || undefined, force)
      setActive(list)
      setLists((ls) => ls.map((l) => (l.id === list.id ? list : l)))
      flash(note || `Prices updated${estimated ? ` (${estimated} estimated)` : ''}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setPricing(false)
    }
  }

  // Pantry substitution: the user decides. Accepting removes the item from the
  // buy list (they'll make it from what they already have).
  const decideSub = async (sub, accepted) => {
    const next = {
      ...active,
      substitutions: active.substitutions.map((s) =>
        s.itemId === sub.itemId ? { ...s, decision: accepted ? 'accepted' : 'declined' } : s
      ),
      items: accepted
        ? active.items.map((i) => (i.id === sub.itemId ? { ...i, removed: true, substituted: true } : i))
        : active.items,
    }
    setActive(next)
    setLists((ls) => ls.map((l) => (l.id === next.id ? next : l)))
    try { await api.updateShoppingList(next) } catch (e) { setError(e.message) }
    flash(accepted ? `Making it from your pantry instead` : 'Keeping it on the list')
  }

  const left = useMemo(() => active?.items.filter((i) => !i.checked).length || 0, [active])
  const estTotal = useMemo(
    () => active?.items.reduce((sum, i) => sum + (i.checked ? 0 : i.bestPrice || 0), 0) || 0,
    [active]
  )

  if (lists === null) return <Loading label="Loading your lists…" />

  return (
    <div>
      <div className="section-title">Shopping</div>
      <h1 className="page-h">At the store</h1>
      <p className="page-sub">Pick the recipes you're cooking, build one combined list, then check items off as you shop.</p>

      {error && <Banner kind="error">{error}</Banner>}

      {/* Build a new list from saved recipes */}
      <div className="card">
        <button
          onClick={() => setShowPicker((v) => !v)}
          aria-expanded={showPicker}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                   background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
        >
          <span aria-hidden style={{ transform: showPicker ? 'rotate(90deg)' : 'none', transition: 'transform .15s',
                                     color: 'var(--saffron-deep)', fontSize: 13 }}>▶</span>
          <span style={{ flex: 1 }}>
            <strong style={{ display: 'block' }}>Build a new list</strong>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {pickedIds.length
                ? `${pickedIds.length} recipe${pickedIds.length !== 1 ? 's' : ''} selected`
                : 'Choose recipes and combine their ingredients'}
            </span>
          </span>
          {pickedIds.length > 0 && <span className="pill-count">{pickedIds.length}</span>}
        </button>

        {showPicker && (
          <div style={{ marginTop: 14 }}>
            {recipes === null ? (
              <div className="muted" style={{ fontSize: 13 }}><Spinner /> Loading recipes…</div>
            ) : recipes.length === 0 ? (
              <Empty emoji="📖" title="No saved recipes">Generate and save a recipe first.</Empty>
            ) : (
              <>
                <div className="stack">
                  {recipes.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setPicked((p) => ({ ...p, [r.id]: !p[r.id] }))}
                      style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%', textAlign: 'left',
                               background: picked[r.id] ? 'rgba(224,168,46,0.10)' : '#fff',
                               border: `1.5px solid ${picked[r.id] ? 'var(--saffron)' : 'var(--line)'}`,
                               borderRadius: 12, padding: 10, cursor: 'pointer' }}
                    >
                      <span className={`checkbox ${picked[r.id] ? 'on' : ''}`}>{picked[r.id] ? '✓' : ''}</span>
                      <RecipeIcon recipe={r} className="recipe-icon" />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 600, display: 'block' }}>{r.name}</span>
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          {r.ingredients?.length || 0} ingredients · serves {r.servings}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <button className="btn btn-primary btn-block" style={{ marginTop: 14 }}
                  onClick={buildList} disabled={building || !pickedIds.length}>
                  {building
                    ? <><Spinner /> Combining ingredients…</>
                    : `Build list from ${pickedIds.length || 'selected'} recipe${pickedIds.length === 1 ? '' : 's'}`}
                </button>
                {pickedIds.length > 1 && (
                  <div className="hint">Duplicate ingredients across recipes are merged into one line.</div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {lists.length === 0 ? (
        <div className="card"><Empty emoji="🛒" title="No lists yet">Open “Build a new list” above, pick some recipes, and combine them.</Empty></div>
      ) : (
        <>
          {lists.length > 1 && (
            <div className="chips" style={{ marginBottom: 14 }}>
              {lists.map((l) => (
                <button key={l.id} className={`chip ${active?.id === l.id ? 'on' : ''}`} onClick={() => setActive(l)}>
                  {l.title}
                </button>
              ))}
            </div>
          )}

          {active && (
            <div className="card">
              <div className="row-between">
                <div>
                  <h3 style={{ fontSize: 22 }}>{active.title}</h3>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {left} of {active.items.length} left · created {fromNow(active.createdAt)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="muted" style={{ fontSize: 11 }}>Est. remaining</div>
                  <div className="price" style={{ fontSize: 22 }}>{money(estTotal)}</div>
                </div>
              </div>
              {active.recipeNames?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="muted" style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                    Shopping for
                  </div>
                  <div className="chips">
                    {active.recipeNames.map((n, i) => (
                      <span key={i} className="chip" style={{ cursor: 'default', background: 'rgba(224,168,46,0.12)', borderColor: 'var(--saffron)' }}>
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <hr className="perf" />

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                <input className="input" style={{ width: 110, padding: '8px 10px' }} placeholder="ZIP" value={zip}
                  inputMode="numeric" onChange={(e) => setZip(e.target.value)} aria-label="ZIP for pricing" />
                <button className="btn btn-dark btn-sm" onClick={() => priceList(false)} disabled={pricing}>
                  {pricing ? <><Spinner light /> Pricing…</> : '↻ Update prices'}
                </button>
                <button
                  className="btn btn-ghost btn-sm" disabled={pricing}
                  title="Throw away saved estimates and price everything again"
                  onClick={() => { if (confirm('Re-estimate every price on this list? Existing estimates will be replaced.')) priceList(true) }}
                >
                  Re-estimate
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEmailing(true)}>✉ Email list</button>
                <span className="muted" style={{ fontSize: 12 }}>
                  prices stick once set — "Update" only fills in what's missing
                </span>
              </div>

              {/* Pantry substitutions — the user decides */}
              {active.substitutions?.filter((s) => !s.decision).map((sub) => (
                <div key={sub.itemId} className="banner warn" style={{ textAlign: 'left' }}>
                  <strong>Make it instead of buying it?</strong>
                  <div style={{ marginTop: 4 }}>
                    {sub.note || `You could make ${sub.itemName} from what's in your pantry.`}
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                    Uses: {sub.makeFrom.join(', ')}
                  </div>
                  <div className="btn-row" style={{ marginTop: 10 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => decideSub(sub, true)}>
                      Make from pantry — drop {sub.itemName}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => decideSub(sub, false)}>
                      No, buy it
                    </button>
                  </div>
                </div>
              ))}

              <hr className="perf" />

              <div>
                {active.items.map((it) => (
                  <div key={it.id} className={`check-row ${it.checked ? 'done' : ''}`}>
                    <span className={`checkbox ${it.checked ? 'on' : ''}`} onClick={() => patchItem(it.id, { checked: !it.checked })} role="checkbox" aria-checked={it.checked}>
                      {it.checked ? '✓' : ''}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="name" style={{ fontWeight: 600 }}>
                        {it.name}
                        {it.inPantry && <span className="tag" style={{ background: 'rgba(59,122,87,0.15)', color: 'var(--basil)', marginLeft: 6, fontSize: 10.5 }}>in pantry</span>}
                        {it.substituted && <span className="tag" style={{ background: 'rgba(224,168,46,0.18)', color: 'var(--saffron-deep)', marginLeft: 6, fontSize: 10.5 }}>making it</span>}
                      </div>
                      {it.pantryNote && <div className="muted" style={{ fontSize: 12 }}>{it.pantryNote}</div>}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
                        <input
                          className="input" style={{ width: 130, padding: '4px 8px', fontSize: 12.5 }}
                          value={it.quantity || ''} placeholder="amount"
                          onChange={(e) => patchItem(it.id, { quantity: e.target.value })}
                        />
                        {it.priceByStore?.length > 0 ? (
                          <select
                            className="select" style={{ width: 'auto', padding: '4px 8px', fontSize: 12.5 }}
                            value={it.chosenStore || ''}
                            onChange={(e) => {
                              const p = it.priceByStore.find((x) => x.store === e.target.value)
                              // Use that store's SCALED total, not its per-unit price,
                              // so 2.5 lbs stays 2.5 lbs when you switch stores.
                              patchItem(it.id, {
                                chosenStore: e.target.value,
                                bestPrice: p?.lineTotal ?? p?.price ?? it.bestPrice,
                                unitPrice: p?.price ?? it.unitPrice,
                                priceUnit: p?.unit ?? it.priceUnit,
                                packages: p?.packages ?? it.packages,
                                priceSource: p?.source ?? it.priceSource,
                                priceLocked: true,   // your choice sticks
                              })
                            }}
                          >
                            {it.priceByStore.map((p) => (
                              <option key={p.store} value={p.store}>
                                {p.store} · {money(p.lineTotal ?? p.price)}
                                {p.source === 'estimated' ? ' (est)' : ''}
                              </option>
                            ))}
                          </select>
                        ) : it.priceSource === 'estimated' ? (
                          <span className="muted" style={{ fontSize: 12 }}>
                            estimated{it.priceUnit ? ` · ${money(it.unitPrice)} per ${it.priceUnit}` : ''}
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>tap "Update prices"</span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {it.bestPrice != null && (
                        <>
                          <div className="price" style={it.priceSource === 'estimated' ? { opacity: 0.75 } : undefined}>
                            {it.priceSource === 'estimated' ? '~' : ''}{money(it.bestPrice)}
                          </div>
                          {/* Show the maths whenever it isn't just one unit —
                              "2.5 × $5.99/lb" explains a $14.98 line at a glance. */}
                          {it.packages != null && it.packages !== 1 && it.unitPrice != null && (
                            <div className="mono muted" style={{ fontSize: 10.5 }}>
                              {it.packages} × {money(it.unitPrice)}{it.priceUnit ? `/${it.priceUnit}` : ''}
                            </div>
                          )}
                        </>
                      )}
                      <button className="linklike tomato" style={{ fontSize: 12 }} onClick={() => removeItem(it.id)}>remove</button>
                    </div>
                  </div>
                ))}
              </div>

              <hr className="perf" />
              <div className="row-between">
                <button className="linklike" onClick={() => { const next = { ...active, items: active.items.map((i) => ({ ...i, checked: false })) }; persist(next); flash('List reset') }}>
                  Uncheck all
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={async () => {
                    if (!confirm('Delete this shopping list?')) return
                    await api.deleteShoppingList(active.id)
                    const rest = lists.filter((l) => l.id !== active.id)
                    setLists(rest); setActive(rest[0] || null); flash('List deleted')
                  }}
                >
                  Delete list
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {emailing && (
        <EmailListModal list={active} onClose={() => setEmailing(false)} flash={flash} />
      )}

      <Toast message={toast} />
    </div>
  )
}

// Emails the list to someone. The boxes in the email are one-tap toggle links,
// so progress syncs back here — no account needed on their end.
function EmailListModal({ list, onClose, flash }) {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const known = user?.profile?.sharedEmails || []
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())

  const send = async () => {
    setBusy(true); setError('')
    try {
      const res = await api.shareList(list.id, email.trim())
      setResult(res)
      if (res.sent) flash('List sent')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Email this list" onClose={onClose}>
      {error && <Banner kind="error">{error}</Banner>}

      {result ? (
        <>
          <Banner kind={result.sent ? 'info' : 'warn'}>{result.note}</Banner>
          <label className="label">Shareable link</label>
          <input className="input" readOnly value={result.shareUrl} onFocus={(e) => e.target.select()} />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(result.shareUrl); flash('Link copied') }}>
              Copy link
            </button>
            <a className="btn btn-ghost btn-sm" href={`mailto:?subject=${encodeURIComponent('Shopping list: ' + list.title)}&body=${encodeURIComponent(result.shareUrl)}`}>
              Open in mail app
            </a>
            <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
            They get the list with tappable checkboxes — no account needed. Anything they tick off
            shows up here too.
          </p>
          <label className="label">Send to</label>
          <input
            className="input" list="fc-shared-emails" inputMode="email" placeholder="them@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && valid && send()}
          />
          <datalist id="fc-shared-emails">
            {known.map((e) => <option key={e} value={e} />)}
          </datalist>

          {known.length > 0 && (
            <>
              <div className="hint" style={{ marginBottom: 6 }}>Recent</div>
              <div className="chips">
                {known.map((e) => (
                  <button key={e} className={`chip ${email === e ? 'on' : ''}`} onClick={() => setEmail(e)}>{e}</button>
                ))}
              </div>
            </>
          )}

          <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={send} disabled={busy || !valid}>
            {busy ? <Spinner /> : 'Send list'}
          </button>
        </>
      )}
    </Modal>
  )
}
