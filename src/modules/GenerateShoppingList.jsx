import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { usePersistentState } from '../lib/persist.jsx'
import { Banner, Spinner, Loading, Empty, RecipeIcon } from '../components/ui.jsx'
import { money } from '../lib/util.js'

export default function GenerateShoppingList() {
  const navigate = useNavigate()
  const routerState = useLocation().state

  const [recipes, setRecipes] = useState(null)
  const [selected, setSelected] = useState({})
  const [stores, setStores] = useState([])
  const [chosenStores, setChosenStores] = useState({})
  const [locBusy, setLocBusy] = useState(false)
  const [locText, setLocText] = usePersistentState('shop.locText', '') // remember city/ZIP
  const [storeNote, setStoreNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [autoRunning, setAutoRunning] = useState(!!(routerState?.autoGenerate && routerState?.recipeIds?.length))

  useEffect(() => {
    api.listRecipes()
      .then((d) => {
        setRecipes(d.recipes)
        // Preselect recipes handed over from the generator.
        if (routerState?.recipeIds?.length) {
          const pre = {}
          routerState.recipeIds.forEach((id) => { pre[id] = true })
          setSelected(pre)
        }
        // Coming straight from "Save & build list": generate immediately using
        // the profile's preferred stores (server falls back to them when none
        // are passed), then jump to the list.
        if (routerState?.autoGenerate && routerState?.recipeIds?.length) {
          generateList(routerState.recipeIds, [])
        }
      })
      .catch((e) => { setError(e.message); setAutoRunning(false) })
  }, []) // eslint-disable-line

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }))
  const selectedIds = Object.keys(selected).filter((id) => selected[id])

  const useMyLocation = () => {
    setError(''); setLocBusy(true)
    if (!navigator.geolocation) { setError('Location services are unavailable on this device.'); setLocBusy(false); return }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { stores, note } = await api.stores({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          setStores(stores); setStoreNote(note || '')
        } catch (e) { setError(e.message) } finally { setLocBusy(false) }
      },
      () => { setError('We couldn\'t get your location. Enter a city or ZIP instead.'); setLocBusy(false) },
      { timeout: 8000 }
    )
  }

  const lookupByText = async () => {
    if (!locText.trim()) return
    setError(''); setLocBusy(true)
    try {
      const { stores, note } = await api.stores({ q: locText.trim() })
      setStores(stores); setStoreNote(note || '')
    } catch (e) { setError(e.message) } finally { setLocBusy(false) }
  }

  const toggleStore = (name) => setChosenStores((s) => ({ ...s, [name]: !s[name] }))

  const generateList = async (ids, pickedStores) => {
    if (!ids.length) { setError('Select at least one recipe.'); setAutoRunning(false); return }
    setBusy(true); setError('')
    try {
      const { list } = await api.generateList(ids, pickedStores)
      navigate('/list', { state: { listId: list.id } })
    } catch (e) {
      setError(e.message)
      setAutoRunning(false) // reveal the manual picker if auto-generation failed
    } finally {
      setBusy(false)
    }
  }

  const build = () => generateList(selectedIds, Object.keys(chosenStores).filter((n) => chosenStores[n]))

  if (autoRunning) return <Loading label="Building your shopping list…" />
  if (recipes === null) return <Loading label="Loading your recipes…" />

  return (
    <div>
      <div className="section-title">Generate Shopping List</div>
      <h1 className="page-h">Build a list</h1>
      <p className="page-sub">Pick the recipes you're shopping for. ForkCast merges the ingredients and prices them from real receipts your community has scanned.</p>

      {error && <Banner kind="error">{error}</Banner>}

      {recipes.length === 0 ? (
        <div className="card"><Empty emoji="📖" title="No recipes yet">Generate some recipes first, then come back to build a list.</Empty></div>
      ) : (
        <div className="card">
          <div className="row-between">
            <strong>Select recipes</strong>
            <span className="pill-count">{selectedIds.length}</span>
          </div>
          <hr className="perf" />
          <div className="stack">
            {recipes.map((r) => (
              <label key={r.id} className="recipe-card" style={{ cursor: 'pointer', alignItems: 'center' }}>
                <span className={`checkbox ${selected[r.id] ? 'on' : ''}`} onClick={(e) => { e.preventDefault(); toggle(r.id) }}>
                  {selected[r.id] ? '✓' : ''}
                </span>
                <RecipeIcon recipe={r} className="recipe-icon" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{r.name}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{r.ingredients?.length || 0} ingredients · {money(r.estimatedCost)}</div>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <strong>Where do you shop?</strong>
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>Share your location or enter a city/ZIP to find nearby stores, then pick your favorites.</p>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={useMyLocation} disabled={locBusy}>
            {locBusy ? <Spinner /> : '📍 Use my location'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input className="input" placeholder="City, ST or ZIP" value={locText} onChange={(e) => setLocText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && lookupByText()} />
          <button className="btn btn-ghost" onClick={lookupByText} disabled={locBusy}>Find</button>
        </div>

        {storeNote && <Banner kind="warn"><span style={{ fontSize: 13 }}>{storeNote}</span></Banner>}

        {stores.length > 0 && (
          <>
            <hr className="perf" />
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Nearest first — tap to prefer</div>
            <div className="chips">
              {stores.map((s) => (
                <button key={s.name} className={`chip ${chosenStores[s.name] ? 'on' : ''}`} onClick={() => toggleStore(s.name)}>
                  {s.name}{s.distanceMiles != null && <span className="mono muted" style={{ marginLeft: 6, fontSize: 11 }}>{s.distanceMiles}mi</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <button className="btn btn-primary btn-block" onClick={build} disabled={busy || !selectedIds.length}>
        {busy ? <><Spinner /> Building your list…</> : 'Generate shopping list'}
      </button>
    </div>
  )
}
