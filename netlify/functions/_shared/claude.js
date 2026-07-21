// Minimal Anthropic Messages API client (no SDK needed on the server).
// Used for recipe generation, cost estimates, command validation, and receipt
// vision parsing. All callers pass a system prompt + content blocks.
const API = 'https://api.anthropic.com/v1/messages'

// Two model roles.
//
// FAST is used wherever a person is waiting on a synchronous Netlify function
// (10s on Free/Personal plans). Haiku generates several times quicker than
// Sonnet, and recipe writing is structured generation — exactly what it's good
// at. QUALITY is available for work that isn't latency-bound.
export const FAST_MODEL = () => process.env.CLAUDE_FAST_MODEL || 'claude-haiku-4-5'
export const QUALITY_MODEL = () => process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'

export function hasClaude() {
  return !!process.env.ANTHROPIC_API_KEY
}

// Netlify's synchronous functions are killed at 10s (26s max on Pro). If we let
// a slow generation run past that, the platform returns a bare 504 with no
// explanation. Bailing out just short of the limit lets us say what happened.
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 9000

export async function claude({ system, messages, maxTokens = 4000, model, timeoutMs }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const e = new Error('ANTHROPIC_API_KEY is not configured')
    e.code = 'NO_API_KEY'
    throw e
  }
  const controller = new AbortController()
  const limit = timeoutMs || TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), limit)

  let res
  try {
    res = await fetch(API, {
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
      signal: controller.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(
        `That took longer than ${Math.round(limit / 1000)}s and was stopped so it wouldn't hang. ` +
        'Try a simpler request, or raise your Netlify function timeout (Pro plans allow 26s).'
      )
      e.code = 'CLAUDE_TIMEOUT'
      throw e
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
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
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

  // The single most common failure in production: the model ran out of room
  // mid-JSON, so what comes back is valid text but unparseable. The API says so
  // explicitly — catch it here rather than letting JSON.parse fail obscurely.
  if (data.stop_reason === 'max_tokens') {
    const e = new Error(
      `The response was cut off at the ${maxTokens.toLocaleString()}-token limit, so it could not be read. ` +
      'Try asking for something simpler, or raise the limit for this request.'
    )
    e.code = 'CLAUDE_TRUNCATED'
    e.partial = text.slice(0, 400)
    throw e
  }
  return text
}

// Ask Claude for JSON and parse it robustly (strips ``` fences / prose).
export async function claudeJSON(opts) {
  const raw = await claude(opts)
  try {
    return parseJSON(raw)
  } catch (err) {
    const e = new Error(
      'The AI returned a response that could not be read as valid data. This is usually a one-off — please try again.'
    )
    e.code = 'CLAUDE_BADJSON'
    e.detail = String(raw).slice(0, 400)
    throw e
  }
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
