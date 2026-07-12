import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api.js'
import { usePersistentState } from '../lib/persist.jsx'
import { Banner, Loading, Empty, Toast, Spinner } from '../components/ui.jsx'
import { money, fromNow } from '../lib/util.js'

export default function ShoppingList() {
  const routerState = useLocation().state
  const [lists, setLists] = useState(null)
  const [active, setActive] = useState(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [zip, setZip] = usePersistentState('shop.zip', '') // remember pricing ZIP
  const [pricing, setPricing] = useState(false)

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
      <div className="section-title">Shopping List</div>
      <h1 className="page-h">At the store</h1>
      <p className="page-sub">Check off items as you go, adjust amounts for what you already have, and switch stores when the price is better elsewhere.</p>

      {error && <Banner kind="error">{error}</Banner>}

      {lists.length === 0 ? (
        <div className="card"><Empty emoji="🛒" title="No lists yet">Head to “Build List”, pick some recipes, and generate a shopping list.</Empty></div>
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
              <hr className="perf" />

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                <input className="input" style={{ width: 110, padding: '8px 10px' }} placeholder="ZIP" value={zip}
                  inputMode="numeric" onChange={(e) => setZip(e.target.value)} aria-label="ZIP for pricing" />
                <button className="btn btn-dark btn-sm" onClick={() => priceList(false)} disabled={pricing}>
                  {pricing ? <><Spinner light /> Pricing…</> : '↻ Update prices'}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  recorded prices first, estimates for the rest
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
                              patchItem(it.id, { chosenStore: e.target.value, bestPrice: p?.price ?? it.bestPrice })
                            }}
                          >
                            {it.priceByStore.map((p) => (
                              <option key={p.store} value={p.store}>
                                {p.store} · {money(p.price)}
                              </option>
                            ))}
                          </select>
                        ) : it.priceSource === 'estimated' ? (
                          <span className="muted" style={{ fontSize: 12 }}>
                            estimated{it.estimateUnit ? ` · ${it.estimateUnit}` : ''}
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>tap "Update prices"</span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {it.bestPrice != null && (
                        <div className="price" style={it.priceSource === 'estimated' ? { opacity: 0.75 } : undefined}>
                          {it.priceSource === 'estimated' ? '~' : ''}{money(it.bestPrice)}
                        </div>
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

      <Toast message={toast} />
    </div>
  )
}
