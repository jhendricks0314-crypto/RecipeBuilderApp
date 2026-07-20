#!/usr/bin/env node
/**
 * RAIning Recipes — credit card statement → receipt-lookup worklist
 * ==========================================================
 * Reads a CSV or Excel export of your card statement, finds the store
 * transactions, and produces the exact values you need for each receipt lookup
 * (store, date, card last-4, total). It does the tedious part: sifting a year of
 * transactions down to "here are your 23 Walmart trips."
 *
 *   node scripts/import-statement.mjs statement.csv
 *   node scripts/import-statement.mjs statement.xlsx --store walmart --zip 72701
 *   node scripts/import-statement.mjs statement.csv --all          # every grocery store
 *   node scripts/import-statement.mjs statement.csv --since 2025-01-01 --min 20
 *
 * Outputs:
 *   receipt-worklist.csv   — one row per transaction, ready to work through
 *   receipt-worklist.json  — same data for scripting
 *
 * WHY THERE IS A MANUAL STEP:
 * Walmart's receipt lookup (walmart.com/receipt-lookup) requires a CAPTCHA. That
 * gate is deliberate — the lookup reveals a receipt from just (store, date,
 * card last-4, total), so Walmart blocks automated querying of it. This script
 * gets you to the doorstep: for each transaction you paste 4 fields, clear one
 * CAPTCHA, and hit Download. Then run the receipts through RAIning Recipes's Prices
 * tab (batch upload) and the line items land in your price database.
 *
 * FASTER PATH — CHECK THIS FIRST:
 * If the card is saved in your Walmart.com account, Walmart already files your
 * in-store purchases under Account → Purchase History, with full line items and
 * NO captcha. Same for any receipt you emailed yourself or scanned in the app.
 * Check there before grinding through the lookup tool.
 *
 * Excel support needs SheetJS:  npm i -D xlsx
 */
import fs from 'node:fs'
import path from 'node:path'

// --- store matching ---------------------------------------------------------
const STORES = {
  walmart: { label: 'Walmart', re: /\bwal[\s-]?mart\b|\bwm\s?supercenter\b|\bwalmart\.com\b/i },
  sams: { label: "Sam's Club", re: /\bsams?\s?club\b/i },
  aldi: { label: 'Aldi', re: /\baldi\b/i },
  kroger: { label: 'Kroger', re: /\bkroger\b|\bfred meyer\b|\bralphs\b|\bking soopers\b|\bharris teeter\b/i },
  target: { label: 'Target', re: /\btarget\b(?!\.com\/help)/i },
  dollargeneral: { label: 'Dollar General', re: /\bdollar\s?general\b|\bdolgen\b|\bdg\s?market\b/i },
  harps: { label: 'Harps', re: /\bharps\b/i },
  costco: { label: 'Costco', re: /\bcostco\b/i },
  publix: { label: 'Publix', re: /\bpublix\b/i },
  safeway: { label: 'Safeway', re: /\bsafeway\b/i },
  heb: { label: 'H-E-B', re: /\bh[\s-]?e[\s-]?b\b/i },
  meijer: { label: 'Meijer', re: /\bmeijer\b/i },
  wholefoods: { label: 'Whole Foods', re: /\bwhole\s?foods\b|\bwfm\b/i },
  traderjoes: { label: "Trader Joe's", re: /\btrader\s?joe/i },
}

// --- tiny CSV reader (handles quotes, commas, CRLF) --------------------------
function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((c) => String(c).trim()))
}

async function readTable(file) {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.csv' || ext === '.txt') {
    return parseCSV(fs.readFileSync(file, 'utf8')).map((r) => r.map((c) => String(c).trim()))
  }
  if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') {
    let XLSX
    try { XLSX = await import('xlsx') } catch {
      console.error('\nExcel support needs SheetJS. Run:  npm i -D xlsx\n(Or export the statement as CSV — every bank offers it.)\n')
      process.exit(1)
    }
    const wb = XLSX.readFile(file, { cellDates: true })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
      .map((r) => r.map((c) => String(c ?? '').trim()))
  }
  console.error(`Unsupported file type: ${ext}. Use .csv or .xlsx`)
  process.exit(1)
}

// --- column detection --------------------------------------------------------
// Banks all export different headers. Find them by name, and if the file has no
// usable header row, fall back to sniffing the data itself.
const find = (headers, patterns) =>
  headers.findIndex((h) => patterns.some((p) => p.test(h)))

function detectColumns(rows) {
  const headers = (rows[0] || []).map((h) => String(h).toLowerCase())

  let date = find(headers, [/^(transaction |post(ing)? |trans\.? )?date$/, /date/])
  let desc = find(headers, [/description|merchant|payee|name|memo|details|reference/])
  let amount = find(headers, [/^amount$/, /amount|debit|charge|withdrawal|value/])
  let card = find(headers, [/card|account|last\s?4|acct/])

  const hasHeader = date !== -1 || desc !== -1 || amount !== -1
  const body = hasHeader ? rows.slice(1) : rows

  // No header? Sniff: first date-looking col, longest text col, first money col.
  if (!hasHeader) {
    const sample = body.slice(0, 25)
    const cols = Math.max(...sample.map((r) => r.length))
    for (let c = 0; c < cols; c++) {
      const vals = sample.map((r) => r[c] || '')
      if (date === -1 && vals.filter((v) => parseDate(v)).length > sample.length * 0.6) date = c
      else if (amount === -1 && vals.filter((v) => parseAmount(v) !== null).length > sample.length * 0.6) amount = c
      else if (desc === -1 && vals.filter((v) => /[a-z]{4,}/i.test(v)).length > sample.length * 0.6) desc = c
    }
  }
  return { date, desc, amount, card, body, hasHeader }
}

// --- value parsing -----------------------------------------------------------
function parseDate(v) {
  if (!v) return null
  const s = String(v).trim()
  // ISO
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // US M/D/YY or M/D/YYYY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (m) {
    let [, mo, d, y] = m
    if (y.length === 2) y = Number(y) > 70 ? `19${y}` : `20${y}`
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  // "Mar 12, 2025"
  const t = Date.parse(s)
  if (!isNaN(t)) {
    const d = new Date(t)
    if (d.getFullYear() > 1990 && d.getFullYear() < 2100) return d.toISOString().slice(0, 10)
  }
  return null
}

function parseAmount(v) {
  if (v == null || v === '') return null
  let s = String(v).trim()
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-')
  s = s.replace(/[()$,\s]/g, '').replace(/^-/, '')
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  if (!isFinite(n) || n === 0) return null
  return neg ? -n : n
}

// Card last-4 can hide in its own column or inside the description.
function parseLast4(cardCell, descCell) {
  for (const v of [cardCell, descCell]) {
    if (!v) continue
    const m = String(v).match(/(?:\*{2,}|x{2,}|ending\s+in\s+|last\s?4\D{0,3})(\d{4})\b/i) ||
              String(v).match(/\b(\d{4})\s*$/)
    if (m) return m[1]
  }
  return ''
}

// --- main --------------------------------------------------------------------
const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? def : (args[i + 1]?.startsWith('--') ? true : args[i + 1] ?? true)
}

if (!file) {
  console.log(`
RAIning Recipes statement importer

  node scripts/import-statement.mjs <statement.csv|.xlsx> [options]

  --store <name>   only this store (default: walmart). e.g. walmart, aldi, kroger
  --all            every known grocery store, not just one
  --zip <zip>      your store's ZIP (printed into the worklist for the lookup form)
  --since <date>   ignore transactions before this date (YYYY-MM-DD)
  --min <amount>   ignore transactions under this amount (default: 5)
  --card <last4>   only transactions on this card

Known stores: ${Object.keys(STORES).join(', ')}
`)
  process.exit(0)
}

const rows = await readTable(file)
const { date: dCol, desc: nCol, amount: aCol, card: cCol, body } = detectColumns(rows)

if (dCol === -1 || nCol === -1 || aCol === -1) {
  console.error(`
Couldn't identify the columns in ${path.basename(file)}.
Found -> date:${dCol} description:${nCol} amount:${aCol}
Make sure the export has a header row with something like Date / Description / Amount.
`)
  process.exit(1)
}

const onlyAll = flag('all', false) === true
const storeKey = String(flag('store', 'walmart')).toLowerCase()
const zip = flag('zip', '') === true ? '' : flag('zip', '')
const since = flag('since', null)
const minAmt = Number(flag('min', 5)) || 0
const onlyCard = flag('card', null)

const active = onlyAll ? Object.entries(STORES) : Object.entries(STORES).filter(([k]) => k === storeKey)
if (!active.length) {
  console.error(`Unknown store "${storeKey}". Known: ${Object.keys(STORES).join(', ')}`)
  process.exit(1)
}

const hits = []
for (const r of body) {
  const desc = r[nCol] || ''
  const match = active.find(([, s]) => s.re.test(desc))
  if (!match) continue

  const day = parseDate(r[dCol])
  const amtRaw = parseAmount(r[aCol])
  if (!day || amtRaw === null) continue

  const total = Math.abs(amtRaw)          // statements sign charges either way
  if (total < minAmt) continue
  if (since && day < since) continue
  // Skip refunds/returns — they're money coming back, not a purchase to look up.
  // (They post as a positive credit, so the sign alone won't catch them.)
  if (/\b(refund|return|credit|reversal|adjustment)\b/i.test(desc)) continue

  const last4 = parseLast4(cCol !== -1 ? r[cCol] : '', desc)
  if (onlyCard && last4 !== String(onlyCard)) continue

  hits.push({
    store: match[1].label,
    date: day,
    total: total.toFixed(2),
    cardLast4: last4,
    zip: zip || '',
    description: desc,
    lookupUrl: match[0] === 'walmart' ? 'https://www.walmart.com/receipt-lookup' : '',
    status: 'pending',
  })
}

hits.sort((a, b) => b.date.localeCompare(a.date))

if (!hits.length) {
  console.log(`\nNo matching transactions found in ${path.basename(file)}.`)
  console.log(`Searched for: ${active.map(([, s]) => s.label).join(', ')}\n`)
  process.exit(0)
}

// --- write the worklist ------------------------------------------------------
const cols = ['store', 'date', 'total', 'cardLast4', 'zip', 'description', 'lookupUrl', 'status']
const csv = [
  cols.join(','),
  ...hits.map((h) => cols.map((c) => `"${String(h[c]).replace(/"/g, '""')}"`).join(',')),
].join('\n')

fs.writeFileSync('receipt-worklist.csv', csv)
fs.writeFileSync('receipt-worklist.json', JSON.stringify(hits, null, 2))

const totalSpend = hits.reduce((s, h) => s + Number(h.total), 0)
const missingCard = hits.filter((h) => !h.cardLast4).length

console.log(`\n  Found ${hits.length} transaction(s) — $${totalSpend.toFixed(2)} total\n`)
console.log('  ' + 'DATE'.padEnd(12) + 'STORE'.padEnd(16) + 'TOTAL'.padStart(10) + '   CARD')
console.log('  ' + '─'.repeat(52))
for (const h of hits.slice(0, 15)) {
  console.log('  ' + h.date.padEnd(12) + h.store.padEnd(16) + ('$' + h.total).padStart(10) + '   ' + (h.cardLast4 || '????'))
}
if (hits.length > 15) console.log(`  … and ${hits.length - 15} more`)

console.log(`
  Wrote receipt-worklist.csv and receipt-worklist.json
`)

if (missingCard) {
  console.log(`  ${missingCard} row(s) have no card last-4 — your export may not include it.
  Add it by hand in the CSV, or pass --card 1234 if it's all one card.
`)
}

console.log(`  NEXT STEPS
  ──────────
  1. FIRST, check the easy path: walmart.com → Account → Purchase History.
     If your card is saved to your Walmart account, in-store purchases are
     already there with full line items and no captcha. Skip to step 3.

  2. Otherwise, for each row: open https://www.walmart.com/receipt-lookup
     and paste in the ZIP, date, card type + last-4, and total. Clear the
     captcha (Walmart requires it — it can't be automated), then Download.
     Save the receipts into a folder.
       ⚠ If a Walmart Pay purchase rejects your real card's last-4, use the
         digital card number from the Walmart Pay screen in the app.

  3. In RAIning Recipes: Prices → Scan receipt → upload them (you can select several
     at once). Claude reads each one, keeps food items only, you review, and
     the prices land in your price database.
`)
