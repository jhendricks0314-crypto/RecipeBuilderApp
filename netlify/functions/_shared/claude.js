// Minimal Anthropic Messages API client (no SDK needed on the server).
// Used for recipe generation, cost estimates, command validation, and receipt
// vision parsing. All callers pass a system prompt + content blocks.
const API = 'https://api.anthropic.com/v1/messages'

export function hasClaude() {
  return !!process.env.ANTHROPIC_API_KEY
}

export async function claude({ system, messages, maxTokens = 4000, model }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY is not configured')
    e.code = 'NO_API_KEY'
    throw e
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    let detail = text.slice(0, 300)
    try { detail = JSON.parse(text)?.error?.message || detail } catch {}

    // Translate the failures that actually happen into something actionable —
    // a bare "API error 404" tells nobody anything.
    let friendly
    if (res.status === 404 || /model/i.test(detail)) {
      friendly = `The configured Claude model "${model || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'}" was rejected. Set CLAUDE_MODEL to a current one (e.g. claude-sonnet-4-6).`
    } else if (res.status === 401 || res.status === 403) {
      friendly = 'The ANTHROPIC_API_KEY was rejected. Check the key in your Netlify environment variables.'
    } else if (res.status === 429) {
      friendly = 'Rate limited by the Claude API — wait a moment and try again.'
    } else if (res.status >= 500) {
      friendly = 'The Claude API is having trouble right now. Try again shortly.'
    } else {
      friendly = `Claude API error ${res.status}: ${detail}`
    }
    const e = new Error(friendly)
    e.code = `CLAUDE_${res.status}`
    e.detail = detail
    throw e
  }
  const data = await res.json()
  return data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()
}

// Ask Claude for JSON and parse it robustly (strips ``` fences / prose).
export async function claudeJSON(opts) {
  const raw = await claude(opts)
  return parseJSON(raw)
}

export function parseJSON(raw) {
  let s = String(raw).trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const first = s.search(/[[{]/)
  if (first > 0) s = s.slice(first)
  const lastObj = s.lastIndexOf('}')
  const lastArr = s.lastIndexOf(']')
  const last = Math.max(lastObj, lastArr)
  if (last !== -1) s = s.slice(0, last + 1)
  return JSON.parse(s)
}
