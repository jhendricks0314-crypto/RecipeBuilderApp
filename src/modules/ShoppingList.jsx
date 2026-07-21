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
  const [activeId, setActiveId] = usePersistentState('shop.activeId', null)
  const [recipes, setRecipes] = useState(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [zip, setZip] = usePersistentState('shop.zip', '')
  const [pricing, setPricing] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingRecipes, setEditingRecipes] = useState(false)
  const [busy, setBusy] = useState(false)

  const active = lists?.find((l) => l.id === activeId) || null
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1800) }

  useEffect(() => {
    Promise.all([api.listShoppingLists(), api.listRecipes()])
      .then(([l, r]) => {
        setLists(l.lists)
        setRecipes(r.recipes)
        if (!l.lists.find((x) => x.id === activeId)) setActiveId(l.lists[0]?.id || null)
      })
      .catch((e) => setError(e.message))
  }, [])  

  // Arriving from the generator or cookbook with recipes in hand.
  const handoff = useRef(false)
  useEffect(() => {
    const ids = routerState?.recipeIds
    if (!ids?.length || handoff.current || !recipes) return
    handoff.current = true
    setCreating(ids)
  }, [routerState, recipes])

  const persist = async (next) => {
    setLists((ls) => ls.map((l) => (l.id === next.id ? next : l)))
    try { await api.updateShoppingList(next) } catch (e) { setError(e.message) }
  }

  const patchItem = (itemId, patch) => {
    if (!active) return
    persist({ ...active, items: active.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) })
  }

  const priceList = async (force = false) => {
    if (!active) return
    setPricing(true); setError('')
    try {
      const { list, estimated, note } = await api.estimatePrices(active.id, zip.trim() || undefined, force)
      setLists((ls) => ls.map((l) => (l.id === list.id ? list : l)))
      flash(note || `Prices updated${estimated ? ` (${estimated} estimated)` : ''}`)
    } catch (e) { setError(e.message) } finally { setPricing(false) }
  }

  const decideSub = async (sub, accepted) => {
    const next = {
      ...active,
      substitutions: active.substitutions.map((s) => (s.itemId === sub.itemId ? { ...s, decision: accepted ? 'accepted' : 'declined' } : s)),
      items: accepted ? active.items.map((i) => (i.id === sub.itemId ? { ...i, removed: true, substituted: true } : i)) : active.items,
    }
    await persist(next)
    flash(accepted ? 'Making it from your pantry instead' : 'Keeping it on the list')
  }

  const changeRecipes = async (ids) => {
    setBusy(true); setError('')
    try {
      const { list } = await api.setListRecipes(active.id, ids)
      setLists((ls) => ls.map((l) => (l.id === list.id ? list : l)))
      setEditingRecipes(false)
      flash('List updated')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const removeList = async () => {
    if (!confirm(`Delete "${active.title}"? This cannot be undone.`)) return
    await api.deleteShoppingList(active.id)
    const rest = lists.filter((l) => l.id !== active.id)
    setLists(rest); setActiveId(rest[0]?.id || null)
    flash('List deleted')
  }

  if (lists === null) return <Loading label="Loading your lists…" />

  const visible = active?.items.filter((i) => !i.removed) || []
  const left = visible.filter((i) => !i.checked).length
  const total = visible.filter((i) => !i.checked).reduce((s, i) => s + (Number(i.bestPrice) || 0), 0)

  return (
    <div>
      <div className="row-between">
        <div>
          <div className="section-title">Shopping</div>
          <h1 className="page-h">Your lists</h1>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating([])}>＋ New list</button>
      </div>
      <p className="page-sub">Pick recipes, combine their ingredients into one list, then check things off as you shop.</p>

      {error && <Banner kind="error">{error}</Banner>}

      {lists.length === 0 ? (
        <div className="card">
          <Empty emoji="🛒" title="No lists yet">
            Tap <strong>New list</strong>, choose the recipes you're cooking, and give the list a name.
          </Empty>
        </div>
      ) : (
        <>
          {/* Each list is a real card with its own name — not an anonymous chip. */}
          <div className="stack" style={{ marginBottom: 18 }}>
            {lists.map((l) => {
              const items = l.items.filter((i) => !i.removed)
              const done = items.filter((i) => i.checked).length
              const isOpen = l.id === activeId
              return (
                <button
                  key={l.id}
                  onClick={() => setActiveId(isOpen ? null : l.id)}
                  className="card"
                  style={{
                    textAlign: 'left', cursor: 'pointer', width: '100%', padding: 14,
                    borderColor: isOpen ? 'var(--saffron)' : 'var(--line)',
                    background: isOpen ? 'rgba(224,168,46,0.06)' : 'var(--card)',
                  }}
                >
                  <div className="row-between" style={{ gap: 10 }}>
                    <strong style={{ fontFamily: 'var(--display)', fontSize: 17 }}>{l.title}</strong>
                    <span className="mono muted" style={{ fontSize: 12, flexShrink: 0 }}>
                      {done}/{items.length}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {l.recipeNames?.length ? l.recipeNames.join(' · ') : 'No recipes'} · {fromNow(l.createdAt)}
                  </div>
                </button>
              )
            })}
          </div>

          {active && (
            <div className="card">
              <ListHeader
                list={active}
                onRename={(title) => persist({ ...active, title })}
                onEditRecipes={() => setEditingRecipes(true)}
                onEmail={() => setEmailing(true)}
                onDelete={removeList}
              />

              <hr className="perf" />

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input className="input" style={{ width: 100, padding: '8px 10px' }} placeholder="ZIP"
                  value={zip} inputMode="numeric" onChange={(e) => setZip(e.target.value)} aria-label="ZIP for pricing" />
                <button className="btn btn-dark btn-sm" onClick={() => priceList(false)} disabled={pricing}>
                  {pricing ? <><Spinner light /> Pricing…</> : '↻ Update prices'}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={pricing}
                  onClick={() => { if (confirm('Re-estimate every price on this list?')) priceList(true) }}>
                  Re-estimate
                </button>
              </div>

              {active.substitutions?.filter((s) => !s.decision).map((sub) => (
                <div key={sub.itemId} className="banner warn" style={{ textAlign: 'left', marginTop: 12 }}>
                  <strong>Make it instead of buying it?</strong>
                  <div style={{ marginTop: 4 }}>{sub.note || `You could make ${sub.itemName} from your pantry.`}</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>Uses: {sub.makeFrom.join(', ')}</div>
                  <div className="btn-row" style={{ marginTop: 10 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => decideSub(sub, true)}>Make it — drop {sub.itemName}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => decideSub(sub, false)}>No, buy it</button>
                  </div>
                </div>
              ))}

              <hr className="perf" />

              <div className="row-between" style={{ marginBottom: 4 }}>
                <span className="label" style={{ margin: 0 }}>{left} of {visible.length} left</span>
                {total > 0 && <span className="price">≈ {money(total)}</span>}
              </div>

              <Items list={active} onPatch={patchItem} onPersist={persist} />

              {active.items.some((i) => i.removed) && (
                <button className="linklike" style={{ marginTop: 10 }}
                  onClick={() => persist({ ...active, items: active.items.map((i) => ({ ...i, removed: false })) })}>
                  Show {active.items.filter((i) => i.removed).length} hidden item(s)
                </button>
              )}
            </div>
          )}
        </>
      )}

      {creating !== false && (
        <CreateListModal
          recipes={recipes || []}
          preselected={Array.isArray(creating) ? creating : []}
          onClose={() => setCreating(false)}
          onCreated={(list) => {
            setLists((ls) => [list, ...(ls || [])])
            setActiveId(list.id)
            setCreating(false)
            flash(`Created "${list.title}"`)
          }}
        />
      )}

      {editingRecipes && active && (
        <PickRecipesModal
          title="Recipes in this list"
          recipes={recipes || []}
          selected={active.recipeIds || []}
          busy={busy}
          confirmLabel="Update list"
          onClose={() => setEditingRecipes(false)}
          onConfirm={changeRecipes}
        />
      )}

      {emailing && active && <EmailListModal list={active} onClose={() => setEmailing(false)} flash={flash} />}

      <Toast message={toast} />
    </div>
  )
}

// --- list header: rename inline, manage recipes, email, delete ---------------
function ListHeader({ list, onRename, onEditRecipes, onEmail, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(list.title)

  const save = () => {
    const t = draft.trim()
    setEditing(false)
    if (t && t !== list.title) onRename(t)
    else setDraft(list.title)
  }

  return (
    <>
      {editing ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setDraft(list.title); setEditing(false) } }} />
          <button className="btn btn-primary btn-sm" onClick={save}>Save</button>
        </div>
      ) : (
        <div className="row-between" style={{ gap: 10 }}>
          <h2 style={{ fontSize: 22, minWidth: 0 }}>{list.title}</h2>
          <button className="linklike" style={{ flexShrink: 0 }} onClick={() => { setDraft(list.title); setEditing(true) }}>rename</button>
        </div>
      )}

      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
        {list.recipeNames?.length ? `Shopping for ${list.recipeNames.join(', ')}` : 'No recipes attached'}
      </div>

      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn btn-ghost btn-sm" onClick={onEditRecipes}>Add / remove recipes</button>
        <button className="btn btn-ghost btn-sm" onClick={onEmail}>✉ Email</button>
        <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
      </div>
    </>
  )
}

// --- the items, with full manual control -------------------------------------
function Items({ list, onPatch, onPersist }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [editingId, setEditingId] = useState(null)

  const visible = list.items.filter((i) => !i.removed)

  const addItem = () => {
    const n = name.trim()
    if (!n) return
    const item = {
      id: `item_manual_${Date.now().toString(36)}`,
      name: n,
      quantity: qty.trim(),
      fromRecipes: [],
      checked: false,
      removed: false,
      source: 'manual',      // survives a recipe rebuild
      bestPrice: null,
      priceByStore: [],
    }
    onPersist({ ...list, items: [...list.items, item] })
    setName(''); setQty(''); setAdding(false)
  }

  const deleteItem = (id) => onPersist({ ...list, items: list.items.filter((i) => i.id !== id) })

  return (
    <>
      <div>
        {visible.map((it) => (
          <div key={it.id} className={`check-row ${it.checked ? 'done' : ''}`}>
            <span className={`checkbox ${it.checked ? 'on' : ''}`} onClick={() => onPatch(it.id, { checked: !it.checked })}>
              {it.checked ? '✓' : ''}
            </span>

            {editingId === it.id ? (
              <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                <input className="input" style={{ padding: '6px 10px' }} defaultValue={it.name}
                  onBlur={(e) => onPatch(it.id, { name: e.target.value.trim() || it.name, edited: true })} />
                <input className="input" style={{ padding: '6px 10px', width: 92 }} defaultValue={it.quantity} placeholder="Qty"
                  onBlur={(e) => onPatch(it.id, { quantity: e.target.value.trim(), edited: true })} />
                <button className="linklike" onClick={() => setEditingId(null)}>done</button>
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 0 }} onClick={() => setEditingId(it.id)}>
                <div className="name" style={{ fontWeight: 600 }}>
                  {it.name}
                  {it.source === 'manual' && <span className="tag" style={{ marginLeft: 6, fontSize: 10.5 }}>added</span>}
                  {it.inPantry && <span className="tag" style={{ background: 'rgba(59,122,87,0.15)', color: 'var(--basil)', marginLeft: 6, fontSize: 10.5 }}>in pantry</span>}
                </div>
                {it.quantity && <div className="muted" style={{ fontSize: 12.5 }}>{it.quantity}</div>}
                {it.priceByStore?.length > 0 && (
                  <select className="select" style={{ padding: '3px 8px', fontSize: 12, marginTop: 4 }}
                    value={it.chosenStore || ''} onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const p = it.priceByStore.find((x) => x.store === e.target.value)
                      onPatch(it.id, {
                        chosenStore: e.target.value,
                        bestPrice: p?.lineTotal ?? p?.price ?? it.bestPrice,
                        unitPrice: p?.price ?? it.unitPrice,
                        priceUnit: p?.unit ?? it.priceUnit,
                        packages: p?.packages ?? it.packages,
                        priceSource: p?.source ?? it.priceSource,
                        priceLocked: true,
                      })
                    }}>
                    {it.priceByStore.map((p) => (
                      <option key={p.store} value={p.store}>
                        {p.store} · {money(p.lineTotal ?? p.price)}{p.source === 'estimated' ? ' (est)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {it.bestPrice != null && (
                <>
                  <div className="price" style={it.priceSource === 'estimated' ? { opacity: 0.75 } : undefined}>
                    {it.priceSource === 'estimated' ? '~' : ''}{money(it.bestPrice)}
                  </div>
                  {it.packages != null && it.packages !== 1 && it.unitPrice != null && (
                    <div className="mono muted" style={{ fontSize: 10.5 }}>
                      {it.packages} × {money(it.unitPrice)}{it.priceUnit ? `/${it.priceUnit}` : ''}
                    </div>
                  )}
                </>
              )}
              <button className="linklike tomato" style={{ fontSize: 12 }} onClick={() => deleteItem(it.id)}>remove</button>
            </div>
          </div>
        ))}
      </div>

      {adding ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <input className="input" autoFocus placeholder="Item" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem()} />
          <input className="input" style={{ width: 92 }} placeholder="Qty" value={qty}
            onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addItem()} />
          <button className="btn btn-primary btn-sm" onClick={addItem} disabled={!name.trim()}>Add</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>×</button>
        </div>
      ) : (
        <button className="btn btn-ghost btn-sm btn-block" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          ＋ Add an item
        </button>
      )}
      <div className="hint">Tap any item to edit its name or amount. Items you add stay put when recipes change.</div>
    </>
  )
}

// --- create a list: pick recipes, then name it -------------------------------
function CreateListModal({ recipes, preselected, onClose, onCreated }) {
  const [picked, setPicked] = useState(() => {
    const m = {}; preselected.forEach((id) => { m[id] = true }); return m
  })
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ids = Object.keys(picked).filter((k) => picked[k])

  const suggested = useMemo(() => {
    const names = ids.map((id) => recipes.find((r) => r.id === id)?.name).filter(Boolean)
    if (!names.length) return ''
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]} + ${names[1]}`
    return `${names[0]} + ${names.length - 1} more`
  }, [ids, recipes])  

  const create = async () => {
    setBusy(true); setError('')
    try {
      const { list } = await api.generateList(ids, [], (title.trim() || suggested))
      onCreated(list)
    } catch (e) { setError(e.message); setBusy(false) }
  }

  return (
    <Modal title="New shopping list" onClose={onClose}>
      {error && <Banner kind="error">{error}</Banner>}

      <label className="label">Name</label>
      <input className="input" placeholder={suggested || 'Weekly shop'} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="hint">Leave blank to use “{suggested || 'Shopping list'}”.</div>

      <hr className="perf" />

      <div className="row-between">
        <span className="label" style={{ margin: 0 }}>Recipes</span>
        <span className="pill-count">{ids.length}</span>
      </div>
      <RecipeChecklist recipes={recipes} picked={picked} setPicked={setPicked} />

      <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={create} disabled={busy || !ids.length}>
        {busy ? <><Spinner /> Combining ingredients…</> : `Create list from ${ids.length} recipe${ids.length === 1 ? '' : 's'}`}
      </button>
      {ids.length > 1 && <div className="hint">Ingredients used by more than one recipe are merged into a single line.</div>}
    </Modal>
  )
}

// --- change which recipes an existing list covers ----------------------------
function PickRecipesModal({ title, recipes, selected, busy, confirmLabel, onClose, onConfirm }) {
  const [picked, setPicked] = useState(() => {
    const m = {}; selected.forEach((id) => { m[id] = true }); return m
  })
  const ids = Object.keys(picked).filter((k) => picked[k])

  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
        Ingredients update to match. Anything you ticked off, edited, or added yourself is kept.
      </p>
      <RecipeChecklist recipes={recipes} picked={picked} setPicked={setPicked} />
      <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={() => onConfirm(ids)} disabled={busy}>
        {busy ? <><Spinner /> Updating…</> : `${confirmLabel} (${ids.length})`}
      </button>
    </Modal>
  )
}

function RecipeChecklist({ recipes, picked, setPicked }) {
  const [q, setQ] = useState('')
  const shown = recipes.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()))

  if (!recipes.length) {
    return <Empty emoji="📖" title="No saved recipes">Generate and save a recipe first.</Empty>
  }

  return (
    <>
      {recipes.length > 6 && (
        <input className="input" style={{ padding: '8px 12px', marginTop: 8 }} placeholder="Search recipes…"
          value={q} onChange={(e) => setQ(e.target.value)} />
      )}
      <div className="stack" style={{ marginTop: 8, maxHeight: '45vh', overflowY: 'auto' }}>
        {shown.map((r) => (
          <button key={r.id} onClick={() => setPicked((p) => ({ ...p, [r.id]: !p[r.id] }))}
            style={{
              display: 'flex', gap: 10, alignItems: 'center', width: '100%', textAlign: 'left',
              background: picked[r.id] ? 'rgba(224,168,46,0.10)' : '#fff',
              border: `1.5px solid ${picked[r.id] ? 'var(--saffron)' : 'var(--line)'}`,
              borderRadius: 12, padding: 9, cursor: 'pointer',
            }}>
            <span className={`checkbox ${picked[r.id] ? 'on' : ''}`}>{picked[r.id] ? '✓' : ''}</span>
            <RecipeIcon recipe={r} className="recipe-icon" />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 600, display: 'block' }}>{r.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {r.ingredients?.length || 0} ingredients · serves {r.servings}
              </span>
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

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
