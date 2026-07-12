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
  nutrition: [],
  nutritionOptions: NUTRITION_GOALS,
  diets: [],
  dietOptions: DIET_PLANS,
  trends: false,
  onlyPantry: false,
}

// Merge saved prefs over defaults, and make sure any custom entry the household
// added still shows up as a chip. (Earlier versions kept nutrition goals and
// diets in one list — split them back apart so each can be cleared on its own.)
function hydrate(saved) {
  const p = { ...DEFAULT_PREFS, ...(saved || {}) }
  if (saved?.diets?.length && saved.nutrition === undefined) {
    p.nutrition = saved.diets.filter((d) => NUTRITION_GOALS.includes(d))
    p.diets = saved.diets.filter((d) => !NUTRITION_GOALS.includes(d))
  }
  p.toolOptions = [...new Set([...(p.toolOptions || []), ...(p.tools || [])])]
  p.nutritionOptions = [...new Set([...(p.nutritionOptions || []), ...(p.nutrition || [])])]
  p.dietOptions = [...new Set([...(p.dietOptions || []), ...(p.diets || [])])]
  return p
}

export default function RecipeGenerator() {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Household options live on the PROFILE, not the device — exclusions can be
  // allergies, so they must hold for everyone in the family, on every device.
  const [prefs, setPrefs] = useState(() => hydrate(user?.profile?.prefs))
  const [savedTick, setSavedTick] = useState(false)
  const loaded = useRef(false)
  const saveTimer = useRef()

  // Auto-save every change (debounced). No Save button.
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
  // Adding a custom entry also selects it — that's why you added it.
  const addOption = (optKey, selKey, value) => setPrefs((p) => ({
    ...p,
    [optKey]: [...new Set([...(p[optKey] || []), value])],
    [selKey]: [...new Set([...(p[selKey] || []), value])],
  }))

  // The pantry is always consulted; onlyPantry decides how strictly.
  const [pantry, setPantry] = useState([])
  useEffect(() => {
    api.getPantry().then((d) => setPantry((d.items || []).map((i) => i.name))).catch(() => {})
  }, [])

  const [kitchenOpen, setKitchenOpen] = usePersistentState('gen.kitchenOpen', false)
  const [whatToCook, setWhatToCook] = usePersistentState('gen.whatToCook', '')
  const [recipe, setRecipe] = usePersistentState('gen.recipe', null)
  const [savedId, setSavedId] = usePersistentState('gen.savedId', null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revising, setRevising] = useState(false)
  const [saving, setSaving] = useState(false)
  const [command, setCommand] = useState('')
  const [history, setHistory] = usePersistentState('gen.history', [])

  const generate = async () => {
    if (!whatToCook.trim()) { setError('Tell me what you want to cook.'); return }
    setError(''); setBusy(true); setRecipe(null); setSavedId(null); setHistory([])
    try {
      const { recipes } = await api.generateRecipes({
        count: 1,
        whatToCook: whatToCook.trim(),
        prefs,
        pantryItems: pantry,
      })
      setRecipe(recipes[0])
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  // Corrections continue this recipe's own conversation.
  const revise = async () => {
    const cmd = command.trim()
    if (!cmd) { setError('Tell me what to change about this recipe.'); return }
    setError(''); setRevising(true)
    try {
      const check = await api.validateCommand(cmd)
      if (!check.related) {
        setError(`That isn't about the recipe: ${check.reason || 'try something food-related.'}`)
        setRevising(false); return
      }
      const { recipe: revised } = await api.reviseRecipe(recipe, cmd)
      setRecipe(revised)
      setHistory((h) => [...h, cmd])
      setCommand('')
      setSavedId(null) // it's no longer the version that was saved
    } catch (e) { setError(e.message) } finally { setRevising(false) }
  }

  const save = async () => {
    setSaving(true); setError('')
    try {
      const { recipes } = await api.saveRecipes([recipe])
      setRecipe(recipes[0]); setSavedId(recipes[0].id)
      return recipes[0]
    } catch (e) { setError(e.message); return null } finally { setSaving(false) }
  }

  const saveAndBuildList = async () => {
    const saved = await save()
    if (saved) navigate('/shopping', { state: { recipeIds: [saved.id], autoGenerate: true } })
  }

  const selectedDiet = [...prefs.nutrition, ...prefs.diets]
  const kitchenSummary = [
    `${prefs.people} ${prefs.people === 1 ? 'person' : 'people'}`,
    prefs.tools.length ? prefs.tools.join(', ') : 'any equipment',
    prefs.exclusions.length ? `no ${prefs.exclusions.join(', ')}` : null,
    selectedDiet.length ? selectedDiet.join(', ') : null,
  ].filter(Boolean).join(' · ')

  return (
    <div>
      <div className="section-title">Recipe Generator</div>
      <h1 className="page-h">What's cooking?</h1>
      <p className="page-sub">Tell ForkCast what you're in the mood for. Your kitchen setup is remembered and applied every time.</p>

      {error && <Banner kind="error">{error}</Banner>}

      {/* --- The ask --- */}
      <div className="card">
        <label className="label">What do you want to cook?</label>
        <textarea
          className="textarea"
          style={{ minHeight: 88 }}
          value={whatToCook}
          onChange={(e) => setWhatToCook(e.target.value)}
          placeholder="e.g. Something with the chicken thighs in my fridge, quick enough for a weeknight"
        />

        <div className="stack" style={{ marginTop: 14 }}>
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
          {busy ? <><Spinner /> Designing your recipe…</> : 'Generate recipe'}
        </button>
      </div>

      {/* --- Persistent kitchen options (collapsible) --- */}
      <div className="card">
        <button
          onClick={() => setKitchenOpen(!kitchenOpen)}
          aria-expanded={kitchenOpen}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
            background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
          }}
        >
          <span
            aria-hidden
            style={{
              transform: kitchenOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform .15s', color: 'var(--saffron-deep)', fontSize: 13, lineHeight: 1,
            }}
          >
            ▶
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="section-title" style={{ marginBottom: 0, display: 'block' }}>Your kitchen</span>
            {!kitchenOpen && (
              <span
                className="muted"
                style={{ fontSize: 12.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {kitchenSummary}
              </span>
            )}
          </span>
          <span className="muted" style={{ fontSize: 12, flex: '0 0 auto' }}>
            {savedTick ? '✓ saved' : kitchenOpen ? 'saved automatically' : 'edit'}
          </span>
        </button>

        {kitchenOpen && (
          <div style={{ marginTop: 14 }}>
            <p className="muted" style={{ fontSize: 13, margin: '0 0 14px' }}>
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

            <ChipPicker
              label="What can you cook with?"
              options={prefs.toolOptions}
              selected={prefs.tools}
              onToggle={(v) => toggleIn('tools', v)}
              onAdd={(v) => addOption('toolOptions', 'tools', v)}
              onClear={() => set({ tools: [] })}
              clearLabel="Deselect all"
              placeholder="Add a tool (Air Fryer, Slow Cooker…)"
              hint={prefs.tools.length === 0
                ? 'Nothing selected — recipes may use any equipment.'
                : `Recipes will only need: ${prefs.tools.join(', ')}.`}
            />

            <hr className="perf" />

            <ExclusionList
              values={prefs.exclusions}
              onAdd={(v) => set({ exclusions: [...new Set([...prefs.exclusions, v])] })}
              onRemove={(v) => set({ exclusions: prefs.exclusions.filter((x) => x !== v) })}
              onClear={() => set({ exclusions: [] })}
            />

            <hr className="perf" />

            <ChipPicker
              label="Nutrition goals"
              options={prefs.nutritionOptions}
              selected={prefs.nutrition}
              onToggle={(v) => toggleIn('nutrition', v)}
              onAdd={(v) => addOption('nutritionOptions', 'nutrition', v)}
              onClear={() => set({ nutrition: [] })}
              placeholder="Add a goal (Low potassium, High iron…)"
            />

            <div style={{ height: 16 }} />

            <ChipPicker
              label="Diets"
              options={prefs.dietOptions}
              selected={prefs.diets}
              onToggle={(v) => toggleIn('diets', v)}
              onAdd={(v) => addOption('dietOptions', 'diets', v)}
              onClear={() => set({ diets: [] })}
              placeholder="Add a diet (Halal, Kosher, Nut-free…)"
            />
          </div>
        )}
      </div>

      {/* --- Result --- */}
      {recipe && (
        <>
          <div className="divider-label">Your recipe</div>
          <RecipeResult
            r={recipe}
            saved={!!savedId}
            history={history}
            command={command}
            busy={revising}
            onCommand={setCommand}
            onRevise={revise}
          />

          <div className="btn-row" style={{ marginTop: 18 }}>
            <button className="btn btn-dark" onClick={save} disabled={saving}>
              {saving ? <Spinner light /> : 'Save recipe'}
            </button>
            <button className="btn btn-primary" onClick={saveAndBuildList} disabled={saving}>
              Save & build shopping list
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => { setRecipe(null); setSavedId(null); setHistory([]); setCommand(''); setError('') }}
              disabled={saving}
            >
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

// Multi-select chips you can also add your own entries to.
function ChipPicker({ label, options, selected, onToggle, onAdd, onClear, clearLabel = 'Clear all', placeholder, hint }) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v) return
    onAdd(v)
    setDraft('')
  }
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <div className="row-between">
        <label className="label" style={{ margin: 0 }}>{label}</label>
        {selected.length > 0 && <button className="linklike" onClick={onClear}>{clearLabel}</button>}
      </div>
      <div className="chips" style={{ marginTop: 8 }}>
        {options.map((o) => (
          <button key={o} className={`chip ${selected.includes(o) ? 'on' : ''}`} onClick={() => onToggle(o)}>{o}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          className="input" style={{ padding: '8px 12px' }} placeholder={placeholder}
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-ghost btn-sm" onClick={add} disabled={!draft.trim()}>Add</button>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

function ExclusionList({ values, onAdd, onRemove, onClear }) {
  const [draft, setDraft] = useState('')
  const add = () => { const v = draft.trim(); if (v) { onAdd(v); setDraft('') } }
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <div className="row-between">
        <label className="label" style={{ margin: 0 }}>Never include these</label>
        {values.length > 0 && <button className="linklike" onClick={onClear}>Clear all</button>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          className="input" placeholder="Ranch, Red Meat, Peanut Butter…" value={draft}
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
      <div className="hint">
        Allergies or hard dislikes. Enforced on every recipe — including when hidden inside a sauce, mix, or marinade.
      </div>
    </div>
  )
}

function RecipeResult({ r, saved, history, command, busy, onCommand, onRevise }) {
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

      <details style={{ marginTop: 12 }} open>
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
      {history.length > 0 && (
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
          {history.map((h, k) => <div key={k}>↳ {h}</div>)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input" placeholder='e.g. "less spicy" or "swap in tofu"'
          value={command} onChange={(e) => onCommand(e.target.value)}
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
