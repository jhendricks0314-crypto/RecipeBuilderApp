import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { Banner, Loading, Empty, RecipeIcon, Stars, Modal, Spinner, Toast } from '../components/ui.jsx'
import { money, stamp, fromNow, CUISINES, TOOLS, TIMES, AUDIENCES } from '../lib/util.js'

export default function Recipes() {
  const navigate = useNavigate()
  const [recipes, setRecipes] = useState(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [openId, setOpenId] = useState(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState({})
  const [shareTarget, setShareTarget] = useState(null) // { recipeIds, title } | null

  // Filters
  const [q, setQ] = useState('')
  const [fCuisine, setFCuisine] = useState('')
  const [fTool, setFTool] = useState('')
  const [fTime, setFTime] = useState('')
  const [fAudience, setFAudience] = useState('')
  const [fServings, setFServings] = useState('')
  const [fRating, setFRating] = useState('')
  const [fMaxCost, setFMaxCost] = useState('')
  const anyFilter = q || fCuisine || fTool || fTime || fAudience || fServings || fRating || fMaxCost
  const clearFilters = () => { setQ(''); setFCuisine(''); setFTool(''); setFTime(''); setFAudience(''); setFServings(''); setFRating(''); setFMaxCost('') }

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1600) }
  const load = () => api.listRecipes().then((d) => setRecipes(d.recipes)).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (!recipes) return []
    const timeCap = { quick: 20, moderate: 45 }[fTime] // 'none'/'' => no cap
    const audienceOk = (val, a) => {
      const s = (a || '').toLowerCase()
      if (val === 'Kids') return s.includes('kid')
      if (val === 'Adults + Kids') return s.includes('kid') && s.includes('adult')
      if (val === 'Adults') return s.includes('adult')
      return true
    }
    return recipes.filter((r) => {
      if (q && !`${r.name} ${r.summary}`.toLowerCase().includes(q.toLowerCase())) return false
      if (fCuisine && r.cuisine !== fCuisine) return false
      if (fTool && r.tool !== fTool) return false
      if (timeCap && (r.estimatedTimeMinutes || 0) > timeCap) return false
      if (fAudience && !audienceOk(fAudience, r.audience)) return false
      if (fServings && (r.servings || 0) < Number(fServings)) return false
      if (fRating && (r.rating || 0) < Number(fRating)) return false
      if (fMaxCost && r.estimatedCost > Number(fMaxCost)) return false
      return true
    })
  }, [recipes, q, fCuisine, fTool, fTime, fAudience, fServings, fRating, fMaxCost])

  const open = recipes?.find((r) => r.id === openId)
  const selectedIds = Object.keys(selected).filter((id) => selected[id])

  const updateOpen = async (patch) => {
    const next = { ...open, ...patch }
    setRecipes((rs) => rs.map((r) => (r.id === open.id ? next : r)))
    try { await api.updateRecipe(next) } catch (e) { setError(e.message) }
  }

  const buildListFromSelection = () => {
    if (!selectedIds.length) return
    navigate('/shopping', { state: { recipeIds: selectedIds } })
  }

  if (recipes === null) return <Loading label="Opening your cookbook…" />

  return (
    <div>
      <div className="row-between">
        <div>
          <div className="section-title">Recipes</div>
          <h1 className="page-h">Your cookbook</h1>
        </div>
      </div>
      <p className="page-sub">Everything you've saved. Rate them, refine the steps, jot notes, add photos, or select a few to build a shopping list.</p>

      {error && <Banner kind="error">{error}</Banner>}

      {recipes.length === 0 ? (
        <div className="card"><Empty emoji="🍳" title="Your cookbook is empty">Generate recipes and save them — they'll live here, tied to your profile.</Empty></div>
      ) : (
        <>
          <div className="card">
            <input className="input" placeholder="Search recipes…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="grid-2" style={{ marginTop: 10 }}>
              <select className="select" value={fCuisine} onChange={(e) => setFCuisine(e.target.value)}>
                <option value="">Any cuisine</option>
                {CUISINES.filter((c) => c !== 'Random').map((c) => <option key={c}>{c}</option>)}
              </select>
              <select className="select" value={fTool} onChange={(e) => setFTool(e.target.value)}>
                <option value="">Any tool</option>
                {TOOLS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="grid-2" style={{ marginTop: 10 }}>
              <select className="select" value={fTime} onChange={(e) => setFTime(e.target.value)}>
                <option value="">Any time</option>
                {TIMES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <select className="select" value={fAudience} onChange={(e) => setFAudience(e.target.value)}>
                <option value="">Any audience</option>
                {AUDIENCES.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>
            <div className="grid-2" style={{ marginTop: 10 }}>
              <select className="select" value={fRating} onChange={(e) => setFRating(e.target.value)}>
                <option value="">Any rating</option>
                <option value="5">5 stars</option>
                <option value="4">4+ stars</option>
                <option value="3">3+ stars</option>
              </select>
              <input className="input" type="number" min="1" placeholder="Serves at least…" value={fServings} onChange={(e) => setFServings(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
              <input className="input" type="number" placeholder="Max cost $" value={fMaxCost} onChange={(e) => setFMaxCost(e.target.value)} style={{ width: 140 }} />
              {anyFilter && <button className="linklike" onClick={clearFilters}>Clear filters</button>}
            </div>
          </div>

          <div className="row-between" style={{ margin: '16px 2px 10px' }}>
            <span className="muted" style={{ fontSize: 13 }}>{filtered.length} recipe{filtered.length !== 1 ? 's' : ''}</span>
            <div className="btn-row">
              {selecting ? (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setSelecting(false); setSelected({}) }}>Cancel</button>
                  <button className="btn btn-dark btn-sm" disabled={!selectedIds.length}
                    onClick={() => setShareTarget({ recipeIds: selectedIds, title: `${selectedIds.length} recipe${selectedIds.length !== 1 ? 's' : ''}` })}>
                    Share {selectedIds.length || ''}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={buildListFromSelection} disabled={!selectedIds.length}>
                    List from {selectedIds.length}
                  </button>
                </>
              ) : (
                <button className="btn btn-ghost btn-sm" onClick={() => setSelecting(true)}>Select</button>
              )}
            </div>
          </div>

          <div className="stack">
            {filtered.map((r) => (
              <div className="card" key={r.id}>
                <div className="recipe-card">
                  {selecting && (
                    <span className={`checkbox ${selected[r.id] ? 'on' : ''}`} onClick={() => setSelected((s) => ({ ...s, [r.id]: !s[r.id] }))}>
                      {selected[r.id] ? '✓' : ''}
                    </span>
                  )}
                  <RecipeIcon recipe={r} />
                  <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => !selecting && setOpenId(r.id)}>
                    <h3 className="recipe-title">{r.name}</h3>
                    <p className="muted" style={{ margin: '3px 0 0', fontSize: 13.5 }}>{r.summary}</p>
                    <div className="recipe-meta">
                      <span className="tag">{r.cuisine}</span>
                      <span className="tag cost">{money(r.estimatedCost)}</span>
                      {r.rating > 0 && <span className="tag" style={{ background: 'rgba(224,168,46,0.16)', color: 'var(--saffron-deep)' }}>★ {r.rating}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {open && (
        <RecipeDetail
          recipe={open}
          onClose={() => setOpenId(null)}
          onChange={updateOpen}
          onShare={() => setShareTarget({ recipeIds: [open.id], title: `“${open.name}”` })}
          onDelete={async () => {
            if (!confirm(`Delete “${open.name}”?`)) return
            await api.deleteRecipe(open.id)
            setRecipes((rs) => rs.filter((r) => r.id !== open.id))
            setOpenId(null); flash('Recipe deleted')
          }}
          onBuildList={() => navigate('/shopping', { state: { recipeIds: [open.id] } })}
          flash={flash}
          setError={setError}
        />
      )}

      {shareTarget && (
        <ShareModal
          recipeIds={shareTarget.recipeIds}
          title={shareTarget.title}
          onClose={() => { setShareTarget(null); if (selecting) { setSelecting(false); setSelected({}) } }}
          flash={flash}
        />
      )}

      <Toast message={toast} />
    </div>
  )
}

function RecipeDetail({ recipe, onClose, onChange, onShare, onDelete, onBuildList, flash, setError }) {
  const [newStep, setNewStep] = useState('')
  const [recipeComment, setRecipeComment] = useState('')
  const [stepComment, setStepComment] = useState({})
  const fileRef = useState(null)

  const editStep = (n, text) => onChange({ steps: recipe.steps.map((s) => (s.n === n ? { ...s, text } : s)) })
  const deleteStep = (n) => onChange({ steps: recipe.steps.filter((s) => s.n !== n).map((s, i) => ({ ...s, n: i + 1 })) })
  const addStep = () => {
    if (!newStep.trim()) return
    onChange({ steps: [...recipe.steps, { n: recipe.steps.length + 1, text: newStep.trim(), note: '', comments: [] }] })
    setNewStep('')
  }
  const addStepComment = (n) => {
    const text = (stepComment[n] || '').trim()
    if (!text) return
    onChange({ steps: recipe.steps.map((s) => (s.n === n ? { ...s, comments: [...(s.comments || []), { text, at: new Date().toISOString() }] } : s)) })
    setStepComment((c) => ({ ...c, [n]: '' }))
  }
  const addRecipeComment = () => {
    if (!recipeComment.trim()) return
    onChange({ comments: [...(recipe.comments || []), { text: recipeComment.trim(), at: new Date().toISOString() }] })
    setRecipeComment('')
  }

  const onPhoto = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3 - (recipe.photos?.length || 0))
    if (!files.length) return
    try {
      const encoded = await Promise.all(files.map(fileToDataURL))
      onChange({ photos: [...(recipe.photos || []), ...encoded].slice(0, 3) })
      flash('Photo added')
    } catch { setError('Could not read that photo.') }
  }

  return (
    <Modal title={recipe.name} onClose={onClose}>
      <div className="recipe-card" style={{ marginBottom: 12 }}>
        <RecipeIcon recipe={recipe} className="recipe-icon" />
        <div style={{ flex: 1 }}>
          <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>{recipe.summary}</p>
          <div className="recipe-meta">
            <span className="tag">{recipe.cuisine}</span>
            <span className="tag">{recipe.tool}</span>
            <span className="tag">{recipe.estimatedTimeMinutes} min</span>
            <span className="tag">Serves {recipe.servings}</span>
            <span className="tag cost">{money(recipe.estimatedCost)}</span>
          </div>
          <div className="timestamp" style={{ marginTop: 6 }}>Generated {stamp(recipe.generatedAt)}</div>
        </div>
      </div>

      <div className="row-between">
        <span className="label" style={{ margin: 0 }}>Your rating</span>
        <Stars value={recipe.rating || 0} onChange={(rating) => onChange({ rating })} />
      </div>

      {/* Photos */}
      <hr className="perf" />
      <div className="row-between">
        <span className="label" style={{ margin: 0 }}>Photos ({recipe.photos?.length || 0}/3)</span>
        {(recipe.photos?.length || 0) < 3 && (
          <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
            Add photo
            <input type="file" accept="image/*" capture="environment" hidden multiple onChange={onPhoto} />
          </label>
        )}
      </div>
      {recipe.photos?.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {recipe.photos.map((p, i) => (
            <div key={i} style={{ position: 'relative' }}>
              <img src={p} alt={`${recipe.name} ${i + 1}`} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10 }} />
              <button className="btn btn-danger btn-sm" style={{ position: 'absolute', top: -8, right: -8, padding: '2px 8px', background: '#fff' }}
                onClick={() => onChange({ photos: recipe.photos.filter((_, idx) => idx !== i) })}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Ingredients */}
      <hr className="perf" />
      <span className="label">Ingredients</span>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {recipe.ingredients?.map((ing, k) => (
          <li key={k} style={{ marginBottom: 3 }}>{ing.quantity} {ing.item} {ing.estCost ? <span className="price muted">· {money(ing.estCost)}</span> : null}{ing.have ? <span className="tag" style={{ background: 'rgba(59,122,87,0.15)', color: 'var(--basil)', marginLeft: 6, fontSize: 10.5 }}>have</span> : null}</li>
        ))}
      </ul>

      {/* Steps with inline editing + comments */}
      <hr className="perf" />
      <span className="label">Steps</span>
      <div className="stack" style={{ marginTop: 6 }}>
        {recipe.steps?.map((s) => (
          <div key={s.n} style={{ borderLeft: '3px solid var(--line)', paddingLeft: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span className="mono" style={{ color: 'var(--saffron-deep)', fontWeight: 600, paddingTop: 8 }}>{s.n}</span>
              <textarea className="textarea" style={{ minHeight: 44 }} value={s.text} onChange={(e) => editStep(s.n, e.target.value)} />
              <button className="linklike tomato" style={{ fontSize: 12, paddingTop: 8 }} onClick={() => deleteStep(s.n)}>delete</button>
            </div>
            {s.note && <div className="muted" style={{ fontSize: 12.5, margin: '2px 0 0 24px' }}>⏱ While you wait: {s.note}</div>}
            {(s.comments || []).map((c, ci) => (
              <div key={ci} style={{ fontSize: 12.5, margin: '4px 0 0 24px', color: 'var(--ink-soft)' }}>💬 {c.text}</div>
            ))}
            <div style={{ display: 'flex', gap: 6, margin: '6px 0 0 24px' }}>
              <input className="input" style={{ padding: '5px 10px', fontSize: 12.5 }} placeholder="Add a note to this step"
                value={stepComment[s.n] || ''} onChange={(e) => setStepComment((c) => ({ ...c, [s.n]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addStepComment(s.n)} />
              <button className="btn btn-ghost btn-sm" onClick={() => addStepComment(s.n)}>Add</button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <input className="input" placeholder="Add a step" value={newStep} onChange={(e) => setNewStep(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStep()} />
        <button className="btn btn-ghost" onClick={addStep}>Add step</button>
      </div>

      {/* Recipe comments */}
      <hr className="perf" />
      <span className="label">Notes on this recipe</span>
      {(recipe.comments || []).map((c, i) => (
        <div key={i} style={{ fontSize: 13.5, marginTop: 4 }}>💬 {c.text} <span className="timestamp">· {fromNow(c.at)}</span></div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input className="input" placeholder="e.g. Doubled the garlic, was perfect" value={recipeComment} onChange={(e) => setRecipeComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRecipeComment()} />
        <button className="btn btn-ghost" onClick={addRecipeComment}>Add</button>
      </div>

      <hr className="perf" />
      <div className="btn-row">
        <button className="btn btn-primary btn-sm" onClick={onBuildList}>Build shopping list</button>
        <button className="btn btn-dark btn-sm" onClick={onShare}>Share</button>
        <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
      </div>
    </Modal>
  )
}

function ShareModal({ recipeIds, title, onClose, flash }) {
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const many = recipeIds.length > 1

  const share = async () => {
    setBusy(true); setError('')
    try {
      const res = await api.shareRecipe(recipeIds, phone)
      setResult(res)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal title={`Share ${title}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>Enter a contact's cell number. If they're on ForkCast, {many ? 'the recipes copy' : 'the recipe copies'} into their cookbook and they get a text.</p>
      {error && <Banner kind="error">{error}</Banner>}
      {result ? (
        <Banner kind="info">{result.note}</Banner>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="+1 555 123 4567" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
          <button className="btn btn-primary" onClick={share} disabled={busy || phone.length < 10}>
            {busy ? <Spinner /> : 'Share'}
          </button>
        </div>
      )}
      {result && <button className="btn btn-ghost btn-block" style={{ marginTop: 12 }} onClick={onClose}>Done</button>}
    </Modal>
  )
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}
