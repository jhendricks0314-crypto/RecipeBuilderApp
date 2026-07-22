import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api.js'
import { generate as runGenerate } from '../lib/task.js'
import { useAuth } from '../lib/auth.jsx'
import { usePersistentState } from '../lib/persist.jsx'
import { Banner, Spinner, RecipeIcon } from '../components/ui.jsx'
import IngredientHelp from '../components/IngredientHelp.jsx'
import StepUses from '../components/StepUses.jsx'
import { stamp, money, DEFAULT_TOOLS, NUTRITION_GOALS, DIET_PLANS } from '../lib/util.js'

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
  const [diag, setDiag] = useState(null)
  const [checking, setChecking] = useState(false)
  const [slow, setSlow] = useState(false)

  const runCheck = async () => {
    setChecking(true)
    try { setDiag(await api.health()) } catch (e) { setDiag({ error: e.message }) } finally { setChecking(false) }
  }
  const [revising, setRevising] = useState(false)
  const [saving, setSaving] = useState(false)
  const [command, setCommand] = useState('')
  const [history, setHistory] = usePersistentState('gen.history', [])
  const [suggestions, setSuggestions] = usePersistentState('gen.suggestions', null)
  const [cost, setCost] = usePersistentState('gen.cost', null)
  const [picking, setPicking] = useState(null)  // index being expanded

  // Step 1: cheap idea list. If the ask is specific the model returns one or two,
  // and we skip straight to writing it rather than making the cook pick from a list of one.
  const generate = async () => {
    if (!whatToCook.trim()) { setError('Tell me what you want to cook.'); return }
    setError(''); setBusy(true); setRecipe(null); setSavedId(null); setHistory([]); setSuggestions(null); setCost(null); setSlow(false)
    try {
      const { suggestions: list } = await runGenerate(
        { suggest: true, whatToCook: whatToCook.trim(), prefs, pantryItems: pantry },
        { onSlow: () => setSlow(true) }
      )
      if (!list?.length) { setError('No ideas came back — try describing it differently.'); return }
      if (list.length === 1) { await pick(list[0], 0); return }
      setSuggestions(list)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  // Step 2: write the full recipe for the idea they chose.
  const pick = async (suggestion, idx) => {
    setError(''); setPicking(idx); setHistory([]); setSavedId(null); setSlow(false)
    try {
      const { recipe: full } = await runGenerate(
        { whatToCook: whatToCook.trim(), pick: suggestion, prefs, pantryItems: pantry },
        { onSlow: () => setSlow(true) }
      )
      setRecipe(full)
      setSuggestions(null)
      priceRecipe(full)
    } catch (e) { setError(e.message) } finally { setPicking(null) }
  }

  // Price the recipe from the price database (+ ZIP estimates), not by asking
  // the model to guess a dollar figure. Runs in the background — a slow or
  // failed estimate must never block showing the recipe.
  const priceRecipe = async (r) => {
    setCost({ loading: true })
    try {
      const c = await api.recipeCost(r)
      setCost(c)
    } catch {
      setCost(null)
    }
  }

  // Corrections continue this recipe's own conversation.
  const revise = async () => {
    const cmd = command.trim()
    if (!cmd) { setError('Tell me what to change about this recipe.'); return }
    setError(''); setRevising(true); setSlow(false)
    try {
      const check = await api.validateCommand(cmd)
      if (!check.related) {
        setError(`That isn't about the recipe: ${check.reason || 'try something food-related.'}`)
        setRevising(false); return
      }
      const { recipe: revised } = await runGenerate(
        { revise: true, recipe, command: cmd },
        { onSlow: () => setSlow(true) }
      )
      setRecipe(revised)
      priceRecipe(revised)
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
    if (saved) navigate('/list', { state: { recipeIds: [saved.id], autoGenerate: true } })
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
      <p className="page-sub">Tell RAIning Recipes what you're in the mood for. Your kitchen setup is remembered and applied every time.</p>

      {error && (
        <Banner kind="error">
          <div>{error}</div>
          <button className="linklike" style={{ marginTop: 6 }} onClick={runCheck} disabled={checking}>
            {checking ? 'Checking setup…' : 'Check my setup'}
          </button>
          {diag && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              {diag.error ? diag.error : diag.checks.map((c) => (
                <div key={c.name} style={{ marginTop: 4 }}>
                  {c.ok ? '✓' : '✗'} {c.name}
                  {!c.ok && c.fix && <div className="muted" style={{ fontSize: 12 }}>{c.fix}</div>}
                  {c.detail && <div className="muted" style={{ fontSize: 11.5 }}>{c.detail}</div>}
                </div>
              ))}
            </div>
          )}
        </Banner>
      )}

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
          {busy ? <><Spinner /> {slow ? 'Still working — this one needs a bit longer…' : 'Thinking up ideas…'}</> : 'Get recipe ideas'}
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
              Applied to every recipe you generate.
            </p>

            <div className="field">
              <label className="label">How many people are you feeding?</label>
              <PeopleInput value={prefs.people} onChange={(n) => set({ people: n })} />
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

      {/* --- Suggestions --- */}
      {suggestions?.length > 0 && !recipe && (
        <>
          <div className="divider-label">
            {suggestions.length} idea{suggestions.length !== 1 ? 's' : ''} — pick one
          </div>
          <div className="stack">
            {suggestions.map((sg, i) => (
              <button
                key={i}
                onClick={() => pick(sg, i)}
                disabled={picking !== null}
                className="card"
                style={{ textAlign: 'left', cursor: 'pointer', width: '100%', border: '1px solid var(--line)' }}
              >
                <div className="row-between" style={{ gap: 10 }}>
                  <strong style={{ fontFamily: 'var(--display)', fontSize: 17 }}>{sg.name}</strong>
                  {picking === i
                    ? <Spinner />
                    : <span className="linklike" style={{ flexShrink: 0 }}>see recipe →</span>}
                </div>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 13.5 }}>{sg.summary}</p>
                <div className="recipe-meta">
                  {sg.cuisine && <span className="tag">{sg.cuisine}</span>}
                  {sg.tool && <span className="tag">{sg.tool}</span>}
                  {sg.estimatedTimeMinutes && <span className="tag">{sg.estimatedTimeMinutes} min</span>}
                </div>
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-block" style={{ marginTop: 14 }} onClick={() => setSuggestions(null)}>
            None of these — start over
          </button>
        </>
      )}

      {/* --- Result --- */}
      {recipe && (
        <>
          <div className="divider-label">Your recipe</div>
          <RecipeResult
            r={recipe}
            pantry={pantry}
            cost={cost}
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
              onClick={() => { setRecipe(null); setSavedId(null); setHistory([]); setCommand(''); setError(''); setSuggestions(null); setCost(null) }}
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

function RecipeResult({ r, pantry = [], cost, saved, history, command, busy, onCommand, onRevise }) {
  const [helpFor, setHelpFor] = useState(null)   // "buy-2" / "have-0"
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
            {cost?.loading && <span className="tag">pricing…</span>}
            {cost && !cost.loading && cost.total > 0 && (
              <span className="tag cost" title={`Priced from ${Math.round((cost.coverage || 0) * 100)}% of the shopping list`}>
                {cost.confidence === 'good' ? '' : '~'}{money(cost.total)}
                {cost.perServing ? ` · ${money(cost.perServing)}/serving` : ''}
              </span>
            )}
          </div>
          <div className="timestamp" style={{ marginTop: 6 }}>Generated {stamp(r.generatedAt)}</div>
        </div>
      </div>

      {r.highlights && (
        <div className="banner warn" style={{ marginTop: 12, marginBottom: 0 }}>✨ {r.highlights}</div>
      )}

      {cost && !cost.loading && cost.total > 0 && cost.confidence !== 'good' && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Rough estimate — only {Math.round((cost.coverage || 0) * 100)}% of the shopping ingredients have a known price.
          Scan a few receipts and it sharpens up.
        </div>
      )}

      <details style={{ marginTop: 12 }} open>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--saffron-deep)' }}>
          Ingredients & steps
        </summary>
        <div style={{ marginTop: 10 }}>
          {toBuy.length > 0 && (
            <>
              <strong style={{ fontSize: 14 }}>You'll need to buy</strong>
              <div style={{ margin: '6px 0 14px' }}>
                {toBuy.map((ing, k) => (
                  <IngredientRow
                    key={k} ing={ing} recipe={r} pantry={pantry}
                    open={helpFor === `buy-${k}`}
                    onToggle={() => setHelpFor(helpFor === `buy-${k}` ? null : `buy-${k}`)}
                  />
                ))}
              </div>
            </>
          )}
          {have.length > 0 && (
            <>
              <strong className="basil" style={{ fontSize: 14 }}>Already in your pantry</strong>
              <div style={{ margin: '6px 0 14px' }}>
                {have.map((ing, k) => (
                  <IngredientRow
                    key={k} ing={ing} recipe={r} pantry={pantry}
                    open={helpFor === `have-${k}`}
                    onToggle={() => setHelpFor(helpFor === `have-${k}` ? null : `have-${k}`)}
                  />
                ))}
              </div>
            </>
          )}
          <strong style={{ fontSize: 14 }}>Steps</strong>
          <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {r.steps.map((s) => (
              <li key={s.n} style={{ marginBottom: 10 }}>
                {s.text}
                <StepUses uses={s.uses} ingredients={r.ingredients} />
                {s.note && <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>⏱ While you wait: {s.note}</div>}
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

// A number field you can actually clear. The old version ran
// Math.max(1, Number(value) || 1) on every keystroke, so deleting the last digit
// instantly snapped it back to 1 — you could never type a fresh number. Keep the
// raw string while editing, and only clamp when focus leaves.
function PeopleInput({ value, onChange }) {
  const [draft, setDraft] = useState(String(value ?? ''))
  const [editing, setEditing] = useState(false)

  return (
    <input
      className="input"
      type="number"
      min="1"
      max="30"
      style={{ width: 110 }}
      value={editing ? draft : String(value ?? '')}
      onFocus={() => { setDraft(String(value ?? '')); setEditing(true) }}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)                       // let the field be empty mid-edit
        const n = parseInt(raw, 10)
        if (Number.isFinite(n) && n >= 1) onChange(Math.min(n, 30))
      }}
      onBlur={() => {
        setEditing(false)
        const n = parseInt(draft, 10)
        onChange(Number.isFinite(n) && n >= 1 ? Math.min(n, 30) : 1)  // clamp only on exit
      }}
    />
  )
}

// One ingredient line. Tapping opens substitutions / questions for it.
function IngredientRow({ ing, recipe, pantry, open, onToggle }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
          background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer',
          color: 'inherit', fontSize: 14.5,
        }}
      >
        <span style={{ color: 'var(--saffron-deep)', fontSize: 11 }}>{open ? '▾' : '▸'}</span>
        <span style={{ flex: 1 }}>{ing.quantity} {ing.item}</span>
        <span className="linklike" style={{ fontSize: 12, flexShrink: 0 }}>swap / ask</span>
      </button>
      {open && (
        <IngredientHelp recipe={recipe} ingredient={ing} pantryItems={pantry} onClose={onToggle} />
      )}
    </div>
  )
}
