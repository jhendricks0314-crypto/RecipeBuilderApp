import { useState } from 'react'
import { api } from '../lib/api.js'
import { Spinner, Banner } from './ui.jsx'

const QUALITY = {
  great: { label: 'great swap', bg: 'rgba(59,122,87,0.15)', fg: 'var(--basil)' },
  good: { label: 'works well', bg: 'rgba(224,168,46,0.18)', fg: 'var(--saffron-deep)' },
  'in a pinch': { label: 'in a pinch', bg: '#eef0e8', fg: 'var(--muted)' },
}

// Tap an ingredient to swap it out or ask about it. Answers are scoped to the
// recipe, so "which onion?" gets an answer about THIS dish.
export default function IngredientHelp({ recipe, ingredient, pantryItems = [], onClose }) {
  const [tab, setTab] = useState('swap')
  const [subs, setSubs] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [thread, setThread] = useState([])

  const label = ingredient.quantity ? `${ingredient.quantity} ${ingredient.item}` : ingredient.item

  const loadSubs = async () => {
    if (subs || busy) return
    setBusy(true); setError('')
    try {
      const { substitutions } = await api.substituteIngredient(recipe, ingredient, pantryItems)
      setSubs(substitutions)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const ask = async (q) => {
    const text = (q || question).trim()
    if (!text) return
    setBusy(true); setError(''); setQuestion('')
    setThread((t) => [...t, { role: 'you', text }])
    try {
      const { answer } = await api.askIngredient(recipe, ingredient, text)
      setThread((t) => [...t, { role: 'forkcast', text: answer }])
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const switchTo = (t) => {
    setTab(t); setError('')
    if (t === 'swap') loadSubs()
  }

  // Kick off substitutions on first open.
  if (tab === 'swap' && subs === null && !busy && !error) loadSubs()

  return (
    <div style={{ border: '1.5px solid var(--saffron)', borderRadius: 12, padding: 14, background: 'rgba(224,168,46,0.05)', marginTop: 8 }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <strong style={{ fontSize: 14.5 }}>{label}</strong>
        <button className="linklike" onClick={onClose}>close</button>
      </div>

      <div className="chips" style={{ marginBottom: 12 }}>
        <button className={`chip ${tab === 'swap' ? 'on' : ''}`} onClick={() => switchTo('swap')}>Substitute it</button>
        <button className={`chip ${tab === 'ask' ? 'on' : ''}`} onClick={() => switchTo('ask')}>Ask about it</button>
      </div>

      {error && <Banner kind="error">{error}</Banner>}

      {tab === 'swap' && (
        <>
          {busy && subs === null && <div className="muted" style={{ fontSize: 13 }}><Spinner /> Finding substitutions…</div>}
          {subs?.length === 0 && (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              No good substitute for this one — it's doing something the dish depends on.
            </p>
          )}
          <div className="stack">
            {(subs || []).map((s, i) => {
              const q = QUALITY[s.quality] || QUALITY.good
              return (
                <div key={i} style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}>
                  <div className="row-between" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 14 }}>{s.name}</strong>
                    <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {s.fromPantry && (
                        <span className="tag" style={{ background: 'rgba(59,122,87,0.15)', color: 'var(--basil)' }}>in pantry</span>
                      )}
                      <span className="tag" style={{ background: q.bg, color: q.fg }}>{q.label}</span>
                    </span>
                  </div>
                  {s.ratio && <div className="mono muted" style={{ fontSize: 12, marginTop: 2 }}>{s.ratio}</div>}
                  {s.note && <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{s.note}</div>}
                </div>
              )
            })}
          </div>
        </>
      )}

      {tab === 'ask' && (
        <>
          <div className="stack" style={{ marginBottom: 10 }}>
            {thread.map((m, i) => (
              <div
                key={i}
                style={{
                  background: m.role === 'you' ? 'var(--ink)' : '#fff',
                  color: m.role === 'you' ? 'var(--paper)' : 'inherit',
                  border: m.role === 'you' ? 'none' : '1px solid var(--line)',
                  borderRadius: 10, padding: '8px 12px', fontSize: 13.5,
                  alignSelf: m.role === 'you' ? 'flex-end' : 'flex-start',
                }}
              >
                {m.text}
              </div>
            ))}
            {busy && <div className="muted" style={{ fontSize: 13 }}><Spinner /> Thinking…</div>}
          </div>

          {thread.length === 0 && !busy && (
            <div className="chips" style={{ marginBottom: 10 }}>
              {['Which type should I use?', 'How do I prep it?', 'Can I leave it out?'].map((q) => (
                <button key={q} className="chip" onClick={() => ask(q)}>{q}</button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input" style={{ padding: '8px 12px' }}
              placeholder={`Ask about ${ingredient.item}…`}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => ask()} disabled={busy || !question.trim()}>Ask</button>
          </div>
        </>
      )}
    </div>
  )
}
