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
  const [remaining, setRemaining] = useState(0)

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

  const refreshPrices = async (force = false) => {
    if (!active) return
    setPricing(true); setError('')
    try {
      const { list, refreshed, remaining } = await api.scrapePrices(active.id, zip.trim() || undefined, force)
      setActive(list)
      setLists((ls) => ls.map((l) => (l.id === list.id ? list : l)))
      setRemaining(remaining)
      flash(remaining > 0 ? `Priced ${refreshed} — ${remaining} left, tap again` : `Prices updated (${refreshed})`)
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? 'Price refresh failed.' : e.message)
    } finally {
      setPricing(false)
    }
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
                <button className="btn btn-dark btn-sm" onClick={() => refreshPrices(false)} disabled={pricing}>
                  {pricing ? <><Spinner light /> Pricing…</> : remaining > 0 ? `Refresh more (${remaining} left)` : '↻ Update live prices'}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>pulls current prices where a source is set up</span>
              </div>
              <hr className="perf" />

              <div>
                {active.items.map((it) => (
                  <div key={it.id} className={`check-row ${it.checked ? 'done' : ''}`}>
                    <span className={`checkbox ${it.checked ? 'on' : ''}`} onClick={() => patchItem(it.id, { checked: !it.checked })} role="checkbox" aria-checked={it.checked}>
                      {it.checked ? '✓' : ''}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="name" style={{ fontWeight: 600 }}>{it.name}</div>
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
                                {p.store} · {money(p.price)}{p.source === 'live' ? ' · live' : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>no price data yet</span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {it.bestPrice != null && <div className="price">{money(it.bestPrice)}</div>}
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
