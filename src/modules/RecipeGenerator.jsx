import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { useAuth } from '../lib/auth.jsx'
import { usePersistentState } from '../lib/persist.jsx'
import { Banner, Spinner, RecipeIcon } from '../components/ui.jsx'
import { stamp, DEFAULT_TOOLS, NUTRITION_GOALS, DIET_PLANS } from '../lib/util.js'

const DEFAULT_PREFS = {
  people: 4,
  tools: ['Stove Top', 'Oven'],
  toolOptions: DEFAULT_TOOLS,
  exclusions: [],
  diets: [],
  trends: false,
  onlyPantry: false,
}

export default function RecipeGenerator() {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Household options live on the PROFILE, not the device — exclusions can be
  // allergies, so they must apply to everyone in the family, on every device.
  const [prefs, setPrefs] = useState(() => ({ ...DEFAULT_PREFS, ...(user?.profile?.prefs || {}) }))
  const [savedTick, setSavedTick] = useState(false)
  const loaded = useRef(false)
  const saveTimer = useRef()

  // Auto-save on every change (debounced). No Save button.
  useEffect(() => {
    if (!loaded.current) { loaded.current = true; return }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      try {
        await api.updateProfile({ prefs })
        setSavedTick(true)
        setTimeout(() => setSavedTick(false), 1200)
      } catch { /* keep the UI usable even if a save blips */ }
    }, 600)
    return () => clearTimeout(saveTimer.current)
  }, [prefs])

  const set = (patch) => setPrefs((p) => ({ ...p, ...patch }))
  const toggleIn = (key, value) => setPrefs((p) => {
    const cur = p[key] || []
    return { ...p, [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] }
  })

  // The pantry is always consulted; onlyPantry decides how strictly.
  const [pantry, setPantry] = useState([])
  useEffect(() => {
    api.getPantry().then((d) => setPantry((d.items || []).map((i) => i.name))).catch(() => {})
  }, [])

  const [count, setCount] = usePersistentState('gen.count', 2)
  const [whatToCook, setWhatToCook] = usePersistentState('gen.whatToCook', '')
  const [results, setResults] = usePersistentState('gen.results', [])
  const [savedIds, setSavedIds] = usePersistentState('gen.savedIds', {})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [regenIdx, setRegenIdx] = useState(null)
  const [saving, setSaving] = useState(false)

  const generate = async () => {
    if (!whatToCook.trim()) { setError('Tell me what you want to cook.'); return }
    setError(''); setBusy(true); setResults([]); setSavedIds({})
    try {
      const { recipes } = await api.generateRecipes({
        count,
        whatToCook: whatToCook.trim(),
        prefs,
        pantryItems: pantry,
      })
      setResults(recipes)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  // Corrections continue this recipe's own conversation.
  const revise = async (idx) => {
    const r = results[idx]
    const command = r._command?.trim()
    if (!command) { setError('Tell me what to change about this recipe.'); return }
    setError(''); setRegenIdx(idx)
    try {
      const check = await api.validateCommand(command)
      if (!check.related) {
        setError(`That isn't about the recipe: ${check.reason || 'try something food-related.'}`)
        setRegenIdx(null); return
      }
      const { recipe } = await api.reviseRecipe(strip(r), command)
      setResults((prev) => prev.map((x, i) => (
        i === idx ? { ...recipe, _command: '', _history: [...(x._history || []), command] } : x
      )))
      setSavedIds((s) => { const n = { ...s }; delete n[idx]; return n })
    } catch (e) { setError(e.message) } finally { setRegenIdx(null) }
  }

  const saveAll = async () => {
    setSaving(true); setError('')
    try {
      const { recipes } = await api.saveRecipes(results.map(strip))
      const map = {}
      recipes.forEach((r, i) => { map[i] = r.id })
      setSavedIds(map); setResults(recipes)
      return recipes
    } catch (e) { setError(e.message); return null } finally { setSaving(false) }
  }

  const saveAndBuildList = async () => {
    const saved = await saveAll()
    if (saved) navigate('/shopping', { state: { recipeIds: saved.map((r) => r.id), autoGenerate: true } })
  }

  return (
    <div>
      <div className="section-title">Recipe Generator</div>
      <h1 className="page-h">What's cooking?</h1>
      <p className="page-sub">Tell ForkCast what you're in the mood for. Your kitchen setup below is remembered and applied to every recipe.</p>

      {error && <Banner kind="error">{error}</Banner>}

      {/* --- The ask --- */}
      <div className="card">
        <label className="label">What do you want to cook?</label>
        <textarea
          className="textarea"
          style={{ minHeight: 88 }}
          value={whatToCook}
          onChange={(e) => setWhatToCook(e.target.value)}
          placeholder="e.g. Weeknight chicken dinners the kids will actually eat, plus one vegetarian night"
        />
        <div className="row-between" style={{ marginTop: 12 }}>
          <span className="label" style={{ margin: 0 }}>How many recipes?</span>
          <div className="chips">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button key={n} className={`chip ${count === n ? 'on' : ''}`} onClick={() => setCount(n)}>{n}</button>
            ))}
          </div>
        </div>

        <hr className="perf" />

        <div className="stack">
          <Toggle
            on={prefs.trends}
            onChange={(v) => set({ trends: v })}
            title={prefs.trends ? 'Modern & trending' : 'Classic & familiar'}
            desc={prefs.trends
              ? "Reaches for what's current — chili crisp, gochujang, hot honey, dry-brining, reverse-searing — where it genuinely makes the dish better."
              : 'Sticks to familiar ingredients and classic technique.'}
          />
          <Toggle
            on={prefs.onlyPantry}
            onChange={(v) => set({ onlyPantry: v })}
            title={prefs.onlyPantry ? 'Only use what I have' : 'Use my pantry, tell me what to buy'}
            desc={prefs.onlyPantry
              ? `Builds strictly from your ${pantry.length} pantry item${pantry.length !== 1 ? 's' : ''} plus basic staples — nothing to buy.`
              : `Cooks with your ${pantry.length} pantry item${pantry.length !== 1 ? 's' : ''} where it can, and flags anything you'd need to pick up.`}
          />
        </div>

        <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={generate} disabled={busy}>
          {busy ? <><Spinner /> Designing recipes…</> : `Generate ${count} recipe${count > 1 ? 's' : ''}`}
        </button>
      </div>

      {/* --- Persistent kitchen options --- */}
      <div className="card">
        <div className="row-between">
          <span className="section-title" style={{ marginBottom: 0 }}>Your kitchen</span>
          <span className="muted" style={{ fontSize: 12 }}>{savedTick ? '✓ saved' : 'saved automatically'}</span>
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '4px 0 14px' }}>
          Applied to every recipe, for everyone on this family profile.
        </p>

        <div className="field">
          <label className="label">How many people are you feeding?</label>
          <input
            className="input" type="number" min="1" max="30" style={{ width: 110 }}
            value={prefs.people}
            onChange={(e) => set({ people: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>

        <ToolPicker prefs={prefs} set={set} toggleIn={toggleIn} />

        <hr className="perf" />

        <ListEditor
          label="Never include these"
          hint="Allergies or hard dislikes. Enforced on every recipe — including when hidden inside a sauce, mix, or marinade."
          placeholder="Ranch, Red Meat, Peanut Butter…"
          values={prefs.exclusions}
          onAdd={(v) => set({ exclusions: [...new Set([...prefs.exclusions, v])] })}
          onRemove={(v) => set({ exclusions: prefs.exclusions.filter((x) => x !== v) })}
        />

        <hr className="perf" />

        <div className="field" style={{ marginBottom: 0 }}>
          <div className="row-between">
            <label className="label" style={{ margin: 0 }}>Nutrition goals</label>
            {prefs.diets.length > 0 && (
              <button className="linklike" onClick={() => set({ diets: [] })}>Clear all</button>
            )}
          </div>
          <div className="chips" style={{ marginTop: 8 }}>
            {NUTRITION_GOALS.map((g) => (
              <button key={g} className={`chip ${prefs.diets.includes(g) ? 'on' : ''}`} onClick={() => toggleIn('diets', g)}>{g}</button>
            ))}
          </div>

          <label className="label" style={{ marginTop: 14 }}>Diets</label>
          <div className="chips">
            {DIET_PLANS.map((d) => (
              <button key={d} className={`chip ${prefs.diets.includes(d) ? 'on' : ''}`} onClick={() => toggleIn('diets', d)}>{d}</button>
            ))}
          </div>
        </div>
      </div>

      {/* --- Results --- */}
      {results.length > 0 && (
        <>
          <div className="divider-label">Your recipes</div>
          <div className="stack">
            {results.map((r, i) => (
              <RecipeResult
                key={r.id || i}
                r={r}
                saved={!!savedIds[i]}
                busy={regenIdx === i}
                onCommand={(v) => setResults((prev) => prev.map((x, idx) => (idx === i ? { ...x, _command: v } : x)))}
                onRevise={() => revise(i)}
              />
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

// --- pieces ------------------------------------------------------------------

function Toggle({ on, onChange, title, desc }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', textAlign: 'left',
        background: on ? 'rgba(224,168,46,0.10)' : '#fff',
        border: `1.5px solid ${on ? 'var(--saffron)' : 'var(--line)'}`,
        borderRadius: 12, padding: 12, cursor: 'pointer',
      }}
    >
      <span
        aria-hidden
        style={{
          flex: '0 0 auto', width: 40, height: 24, borderRadius: 999, marginTop: 2,
          background: on ? 'var(--saffron)' : 'var(--line)', position: 'relative', transition: 'background .15s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: on ? 19 : 3, width: 18, height: 18,
          borderRadius: '50%', background: '#fff', transition: 'left .15s',
        }} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 700, display: 'block' }}>{title}</span>
        <span className="muted" style={{ fontSize: 12.5 }}>{desc}</span>
      </span>
    </button>
  )
}

function ToolPicker({ prefs, set, toggleIn }) {
  const [adding, setAdding] = useState('')
  const options = prefs.toolOptions?.length ? prefs.toolOptions : DEFAULT_TOOLS

  const addTool = () => {
    const v = adding.trim()
    if (!v) return
    set({
      toolOptions: [...new Set([...options, v])],
      tools: [...new Set([...prefs.tools, v])], // adding it implies you have it
    })
    setAdding('')
  }

  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <div className="row-between">
        <label className="label" style={{ margin: 0 }}>What can you cook with?</label>
        {prefs.tools.length > 0 && (
          <button className="linklike" onClick={() => set({ tools: [] })}>Deselect all</button>
        )}
      </div>
      <div className="chips" style={{ marginTop: 8 }}>
        {options.map((t) => (
          <button key={t} className={`chip ${prefs.tools.includes(t) ? 'on' : ''}`} onClick={() => toggleIn('tools', t)}>{t}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          className="input" style={{ padding: '8px 12px' }} placeholder="Add a tool (Air Fryer, Slow Cooker…)"
          value={adding} onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTool()}
        />
        <button className="btn btn-ghost btn-sm" onClick={addTool} disabled={!adding.trim()}>Add</button>
      </div>
      <div className="hint">
        {prefs.tools.length === 0
          ? 'Nothing selected — recipes may use any equipment.'
          : `Recipes will only need: ${prefs.tools.join(', ')}.`}
      </div>
    </div>
  )
}

function ListEditor({ label, hint, placeholder, values, onAdd, onRemove }) {
  const [draft, setDraft] = useState('')
  const add = () => { const v = draft.trim(); if (v) { onAdd(v); setDraft('') } }
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <label className="label">{label}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input" placeholder={placeholder} value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-ghost btn-sm" onClick={add} disabled={!draft.trim()}>Add</button>
      </div>
      {values.length > 0 && (
        <div className="chips" style={{ marginTop: 10 }}>
          {values.map((v) => (
            <button
              key={v} className="chip" onClick={() => onRemove(v)} title="Remove"
              style={{ borderColor: 'rgba(214,72,43,.35)', color: 'var(--tomato)' }}
            >
              {v} ×
            </button>
          ))}
        </div>
      )}
      <div className="hint">{hint}</div>
    </div>
  )
}

function RecipeResult({ r, saved, busy, onCommand, onRevise }) {
  const toBuy = (r.ingredients || []).filter((i) => !i.have)
  const have = (r.ingredients || []).filter((i) => i.have)

  return (
    <div className="card">
      <div className="recipe-card">
        <RecipeIcon recipe={r} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row-between">
            <h3 className="recipe-title">{r.name}</h3>
            {saved && <span className="tag" style={{ background: 'rgba(59,122,87,0.15)', color: 'var(--basil)' }}>Saved</span>}
          </div>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>{r.summary}</p>
          <div className="recipe-meta">
            <span className="tag">{r.cuisine}</span>
            <span className="tag">{r.tool}</span>
            <span className="tag">{r.estimatedTimeMinutes} min</span>
            <span className="tag">Serves {r.servings}</span>
            {toBuy.length === 0 && <span className="tag" style={{ background: 'rgba(59,122,87,0.15)', color: 'var(--basil)' }}>All from pantry</span>}
          </div>
          <div className="timestamp" style={{ marginTop: 6 }}>Generated {stamp(r.generatedAt)}</div>
        </div>
      </div>

      {r.highlights && (
        <div className="banner warn" style={{ marginTop: 12, marginBottom: 0 }}>✨ {r.highlights}</div>
      )}

      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--saffron-deep)' }}>
          Ingredients & steps
        </summary>
        <div style={{ marginTop: 10 }}>
          {toBuy.length > 0 && (
            <>
              <strong style={{ fontSize: 14 }}>You'll need to buy</strong>
              <ul style={{ margin: '6px 0 14px', paddingLeft: 18 }}>
                {toBuy.map((ing, k) => <li key={k} style={{ marginBottom: 3 }}>{ing.quantity} {ing.item}</li>)}
              </ul>
            </>
          )}
          {have.length > 0 && (
            <>
              <strong className="basil" style={{ fontSize: 14 }}>Already in your pantry</strong>
              <ul className="muted" style={{ margin: '6px 0 14px', paddingLeft: 18 }}>
                {have.map((ing, k) => <li key={k} style={{ marginBottom: 3 }}>{ing.quantity} {ing.item}</li>)}
              </ul>
            </>
          )}
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
      <label className="label">Refine this recipe</label>
      {r._history?.length > 0 && (
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          {r._history.map((h, k) => <div key={k}>↳ {h}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input" placeholder='e.g. "less spicy" or "swap in tofu"'
          value={r._command || ''} onChange={(e) => onCommand(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onRevise()}
        />
        <button className="btn btn-ghost" onClick={onRevise} disabled={busy}>
          {busy ? <Spinner /> : 'Revise'}
        </button>
      </div>
      <div className="hint">Corrections build on this recipe — it keeps the original dish and your earlier changes.</div>
    </div>
  )
}

// Strip UI-only fields before saving / sending (keep `thread` — the model needs it).
function strip(r) {
  const { _command, _history, ...rest } = r
  return rest
}
