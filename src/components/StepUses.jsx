// The ingredients a single step consumes — a small mise-en-place line under the
// instruction, so the cook measures what this step needs instead of re-reading
// the whole list and guessing how a "divided" ingredient splits up.
export default function StepUses({ uses, ingredients = [] }) {
  if (!uses?.length) return null

  // Flag anything the step references that isn't in the ingredient list, rather
  // than silently showing a phantom ingredient.
  const known = new Set(ingredients.map((i) => norm(i.item)))
  const rows = uses.filter((u) => u.item)

  return (
    <div className="step-uses">
      {rows.map((u, i) => {
        const unknown = known.size > 0 && !known.has(norm(u.item))
        return (
          <span key={i} className="step-use" title={unknown ? 'Not in the ingredient list' : undefined}>
            {u.amount && <span className="mono step-use-amt">{u.amount}</span>}
            <span>{u.item}</span>
            {unknown && <span className="tomato" style={{ fontSize: 10 }}>?</span>}
          </span>
        )
      })}
    </div>
  )
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()
