import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '../lib/api.js'
import { usePersistentState } from '../lib/persist.jsx'
import { Banner, Spinner, RecipeIcon } from '../components/ui.jsx'
import { money, stamp, CUISINES, TOOLS, TIMES, AUDIENCES } from '../lib/util.js'

const blankMeal = () => ({ cuisine: 'Random', tool: 'Oven', time: 'moderate', people: 4, audience: 'Adults', command: '' })

export default function RecipeGenerator() {
  const navigate = useNavigate()
  const routerState = useLocation().state
  const [pantry, setPantry] = useState(routerState?.pantryItems?.length ? routerState.pantryItems : null)
  const [onlyPantry, setOnlyPantry] = useState(routerState?.onlyPantry ?? true)
  // Setup + generated results are cached so a refresh or app close won't lose them.
  const [count, setCount] = usePersistentState('gen.count', 2)
  const [budget, setBudget] = usePersistentState('gen.budget', 15)
  const [mode, setMode] = usePersistentState('gen.mode', 'know') // 'know' = type what to cook, 'help' = configure
  const [whatToCook, setWhatToCook] = usePersistentState('gen.whatToCook', '')
  const [meals, setMeals] = usePersistentState('gen.meals', () => [blankMeal(), blankMeal()])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = usePersistentState('gen.results', [])
  const [regenIdx, setRegenIdx] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedIds, setSavedIds] = usePersistentState('gen.savedIds', {})

  const setMealCount = (n) => {
    setCount(n)
    setMeals((prev) => {
      const next = [...prev]
      while (next.length < n) next.push(blankMeal())
      return next.slice(0, n)
    })
  }
  const updateMeal = (i, patch) => setMeals((m) => m.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))

  const generate = async () => {
    setError('')
    setBusy(true)
    setResults([])
    setSavedIds({})
    try {
      const body = { count, budget: Number(budget) }
      if (mode === 'know') {
        if (!whatToCook.trim() && !pantry) { setError('Tell us what you want to cook, or switch to "Help me decide".'); setBusy(false); return }
        if (whatToCook.trim()) body.whatToCook = whatToCook.trim()
      } else {
        body.meals = meals.slice(0, count)
      }
      if (pantry) { body.pantryItems = pantry; body.onlyPantry = onlyPantry }
      const { recipes } = await api.generateRecipes(body)
      setResults(recipes)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const regenerate = async (idx) => {
    const r = results[idx]
    const command = r._command?.trim()
    if (!command) { setError('Type a command describing the change you want.'); return }
    setError('')
    setRegenIdx(idx)
    try {
      // Guard: command must relate to cooking.
      const check = await api.validateCommand(command)
      if (!check.related) {
        setError(`That command isn't about the recipe: ${check.reason || 'try something food-related.'}`)
        setRegenIdx(null)
        return
      }
      const { recipes } = await api.generateRecipes({
        count: 1,
        budget: Number(budget),
        meals: [{ cuisine: r.cuisine, tool: r.tool, people: r.servings, audience: r.audience, command }],
        ...(pantry ? { pantryItems: pantry, onlyPantry } : {}),
      })
      const fresh = recipes[0]
      setResults((prev) => prev.map((x, i) => (i === idx ? { ...fresh, _command: '' } : x)))
      setSavedIds((s) => { const n = { ...s }; delete n[idx]; return n })
    } catch (e) {
      setError(e.message)
    } finally {
      setRegenIdx(null)
    }
  }

  const saveAll = async () => {
    setSaving(true)
    setError('')
    try {
      const { recipes } = await api.saveRecipes(results.map(strip))
      const map = {}
      recipes.forEach((r, i) => { map[i] = r.id })
      setSavedIds(map)
      setResults(recipes)
      return recipes
    } catch (e) {
      setError(e.message)
      return null
    } finally {
      setSaving(false)
    }
  }

  const saveAndBuildList = async () => {
    const saved = await saveAll()
    if (saved) navigate('/shopping', { state: { recipeIds: saved.map((r) => r.id), autoGenerate: true } })
  }

  return (
    <div>
      <div className="section-title">Recipe Generator</div>
      <h1 className="page-h">What's cooking?</h1>
      <p className="page-sub">Set a budget, tell ForkCast what you're in the mood for, and it'll design recipes to match — names, steps, and cost included.</p>

      {error && <Banner kind="error">{error}</Banner>}

      {pantry && (
        <div className="card" style={{ borderColor: 'var(--saffron)', background: 'rgba(224,168,46,0.08)' }}>
          <div className="row-between">
            <strong style={{ fontSize: 15 }}>🥫 Cooking from your pantry</strong>
            <button className="linklike" onClick={() => setPantry(null)}>clear</button>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>
            Using {pantry.length} item{pantry.length !== 1 ? 's' : ''} you have on hand. Recipes will flag what you already have, and your shopping list will only include what you still need.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            <span className={`checkbox ${onlyPantry ? 'on' : ''}`} onClick={(e) => { e.preventDefault(); setOnlyPantry((v) => !v) }} style={{ width: 22, height: 22 }}>{onlyPantry ? '✓' : ''}</span>
            Only use what I have (plus basic staples)
          </label>
        </div>
      )}

      <div className="card">
        <div className="grid-2">
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">How many recipes?</label>
            <div className="chips">
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <button key={n} className={`chip ${count === n ? 'on' : ''}`} onClick={() => setMealCount(n)}>{n}</button>
              ))}
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">Budget per recipe</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min="5" max="60" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} style={{ flex: 1, accentColor: 'var(--saffron)' }} />
              <span className="price" style={{ minWidth: 54, textAlign: 'right', fontSize: 18 }}>{money(budget)}</span>
            </div>
          </div>
        </div>

        <hr className="perf" />

        <div className="chips" style={{ marginBottom: 16 }}>
          <button className={`chip ${mode === 'know' ? 'on' : ''}`} onClick={() => setMode('know')}>I know what to cook</button>
          <button className={`chip ${mode === 'help' ? 'on' : ''}`} onClick={() => setMode('help')}>Help me decide</button>
        </div>

        {mode === 'know' ? (
          <div className="field" style={{ marginBottom: 0 }}>
            <label className="label">What do you want to cook?</label>
            <textarea className="textarea" value={whatToCook} onChange={(e) => setWhatToCook(e.target.value)}
              placeholder="e.g. Weeknight chicken dinners the kids will eat, plus one vegetarian night" />
          </div>
        ) : (
          <div className="stack">
            {meals.slice(0, count).map((m, i) => (
              <div key={i} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 10, fontFamily: 'var(--display)', fontSize: 17 }}>Meal {i + 1}</div>
                <div className="field">
                  <label className="label">Cuisine</label>
                  <select className="select" value={m.cuisine} onChange={(e) => updateMeal(i, { cuisine: e.target.value })}>
                    {CUISINES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label">Cook on</label>
                  <div className="chips">
                    {TOOLS.map((t) => (
                      <button key={t} className={`chip ${m.tool === t ? 'on' : ''}`} onClick={() => updateMeal(i, { tool: t })}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="label">Time to cook</label>
                  <div className="chips">
                    {TIMES.map((t) => (
                      <button key={t.key} className={`chip ${m.time === t.key ? 'on' : ''}`} onClick={() => updateMeal(i, { time: t.key })}>{t.label}</button>
                    ))}
                  </div>
                </div>
                <div className="grid-2">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label">People</label>
                    <input className="input" type="number" min="1" max="20" value={m.people} onChange={(e) => updateMeal(i, { people: Number(e.target.value) })} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label className="label">Audience</label>
                    <select className="select" value={m.audience} onChange={(e) => updateMeal(i, { audience: e.target.value })}>
                      {AUDIENCES.map((a) => <option key={a}>{a}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <button className="btn btn-primary btn-block" style={{ marginTop: 18 }} onClick={generate} disabled={busy}>
          {busy ? <><Spinner /> Designing recipes…</> : `Generate ${count} recipe${count > 1 ? 's' : ''}`}
        </button>
      </div>

      {results.length > 0 && (
        <>
          <div className="divider-label">Your recipes</div>
          <div className="stack">
            {results.map((r, i) => (
              <div className="card" key={r.id || i}>
                <div className="recipe-card">
                  <RecipeIcon recipe={r} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row-between">
                      <h3 className="recipe-title">{r.name}</h3>
                      {savedIds[i] && <span className="tag" style={{ background: 'rgba(59,122,87,0.15)', color: 'var(--basil)' }}>Saved</span>}
                    </div>
                    <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>{r.summary}</p>
                    <div className="recipe-meta">
                      <span className="tag">{r.cuisine}</span>
                      <span className="tag">{r.tool}</span>
                      <span className="tag">{r.estimatedTimeMinutes} min</span>
                      <span className="tag">Serves {r.servings}</span>
                      <span className="tag cost">{money(r.estimatedCost)}</span>
                    </div>
                    <div className="timestamp" style={{ marginTop: 6 }}>Generated {stamp(r.generatedAt)}</div>
                  </div>
                </div>

                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--saffron-deep)' }}>
                    Ingredients & steps
                  </summary>
                  <div style={{ marginTop: 10 }}>
                    {r.costBreakdown && <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{r.costBreakdown}</p>}
                    <strong style={{ fontSize: 14 }}>Ingredients</strong>
                    <ul style={{ margin: '6px 0 14px', paddingLeft: 18 }}>
                      {r.ingredients.map((ing, k) => (
                        <li key={k} style={{ marginBottom: 3 }}>
                          {ing.quantity} {ing.item} {ing.estCost ? <span className="price muted">· {money(ing.estCost)}</span> : null}
                          {ing.have && <span className="tag" style={{ background: 'rgba(59,122,87,0.15)', color: 'var(--basil)', marginLeft: 6, fontSize: 10.5 }}>have</span>}
                        </li>
                      ))}
                    </ul>
                    <strong style={{ fontSize: 14 }}>Steps</strong>
                    <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {r.steps.map((s) => (
                        <li key={s.n} style={{ marginBottom: 8 }}>
                          {s.text}
                          {s.note && <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>⏱ While you wait: {s.note}</div>}
                        </li>
                      ))}
                    </ol>
                  </div>
                </details>

                <hr className="perf" />
                <label className="label">Tweak this recipe</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" placeholder='e.g. "make it spicier" or "swap in tofu"'
                    value={r._command || ''} onChange={(e) => setResults((prev) => prev.map((x, idx) => (idx === i ? { ...x, _command: e.target.value } : x)))} />
                  <button className="btn btn-ghost" onClick={() => regenerate(i)} disabled={regenIdx === i}>
                    {regenIdx === i ? <Spinner /> : 'Regenerate'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="btn-row" style={{ marginTop: 18 }}>
            <button className="btn btn-dark" onClick={saveAll} disabled={saving}>
              {saving ? <Spinner light /> : 'Save recipes'}
            </button>
            <button className="btn btn-primary" onClick={saveAndBuildList} disabled={saving}>
              Save & build shopping list
            </button>
            <button className="btn btn-ghost" onClick={() => { setResults([]); setSavedIds({}); setError('') }} disabled={saving}>
              Start over
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Remove UI-only fields before saving.
function strip(r) {
  const { _command, ...rest } = r
  return rest
}
