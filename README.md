# RAIning Recipes 🍴

AI recipe planning, budgeting, shopping lists, and receipt‑powered pricing — as an installable PWA that runs entirely on Netlify.

Generate recipes with Claude, build a merged shopping list for the meals you pick, price ingredients from receipts your community has scanned, keep a cookbook you can rate and annotate, and share recipes to a contact by phone.

---

## What's in the box

| Module | What it does |
|---|---|
| **Recipe Generator** | Pick a count + per‑recipe budget; type what to cook *or* configure cuisine / tool / time / people / audience per meal. Each recipe gets a unique name, summary, timestamp, cost estimate, efficient step‑by‑step method, and a generated icon. Per‑recipe "regenerate with a command" (validated so it must relate to the recipe). |
| **Generate Shopping List** | Select one‑to‑many recipes; aggregates ingredients, finds nearby stores by location or city/ZIP (nearest first), and prices items from the receipt database. |
| **Shopping List** | Check items off, edit amounts, switch stores per item when it's cheaper elsewhere, delete lists. |
| **Recipes** | Your saved cookbook. Filter by name/cuisine/tool/cost, edit/add/delete steps, comment per step and per recipe, rate 1–5★, add up to 3 photos, select several → build a list, or share by phone. |
| **Receipt Scanner** | Capture a receipt with the camera (or upload). Claude vision extracts **food** items only (garbage bags etc. are dropped), you review/edit/add/delete rows, then commit to a shared price database that only the shopping‑list tool reads. |
| **Pantry** | A running, category‑grouped list of what you have on hand (shared across the profile). Add items three ways: by hand, **scan a barcode** (looked up via the free Open Food Facts database), or **snap a photo** and let Claude vision identify what's there. Tap **Cook from my pantry** to generate recipes built around what you have — owned ingredients get a "have" tag and are skipped when building the shopping list. |
| **Profile** | Gmail SSO + cell number. The creator is the owner and can link other Gmail accounts (each Gmail can only belong to one profile). Owners can delete the profile. |
| **Logs** (`/logs`) | Hidden admin page. Only the admin Gmail can open it. Shows errors with the action the user was performing, error codes, details, and stack traces. |

## Tech

- **Vite + React** PWA (`vite-plugin-pwa`, `autoUpdate`) — installable on phone + desktop, updates itself.
- **Netlify Functions** for the API and **Netlify Blobs** for storage, so all data lives within Netlify.
- **Google OAuth** (authorization‑code flow) with a signed JWT session cookie.
- **Claude** (Anthropic Messages API) for recipe generation, cost estimates, command validation, and receipt OCR.
- **Draft caching** (`src/lib/persist.jsx`): in‑progress input and unsaved work — the recipe
  generator's setup + generated recipes, a half‑reviewed receipt, onboarding fields, the pantry
  add form, and remembered store/ZIP — are saved to `localStorage` (debounced, namespaced per
  account), so closing, reloading, or crashing the app doesn't lose anything. Saved recipes,
  lists, pantry items, and receipts also persist server‑side in Blobs.

---

## Run it locally

```bash
npm install
npm run gen:icons          # generate the PWA icons (once)
cp .env.example .env        # then fill in the values below
npm run dev                 # netlify dev → http://localhost:8888
```

> Use `netlify dev` (not `vite` alone) so the Functions and Blobs run alongside the app. Install the CLI with `npm i -g netlify-cli` if you don't have it.

### Environment variables

See `.env.example` for the full list. Minimum to log in and generate recipes:

- `SESSION_SECRET` – any long random string (`openssl rand -hex 32`).
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` – from Google Cloud → Credentials. Add redirect URIs:
  - local: `http://localhost:8888/api/auth-google/callback`
  - prod: `https://YOUR-SITE.netlify.app/api/auth-google/callback`
- `ANTHROPIC_API_KEY` – from the Anthropic Console.
- `ADMIN_EMAIL` – defaults to `jhendricks0314@gmail.com`; only this account can open `/logs`.

Optional: `GOOGLE_PLACES_API_KEY` (real nearby‑store search).

---

## Deploy to Netlify

1. Push this folder to a Git repo and "Add new site → Import" in Netlify (build settings come from `netlify.toml`).
2. Add the same environment variables under **Site settings → Environment variables**.
3. Add your production callback URL to the Google OAuth client.
4. Deploy. Netlify Blobs is enabled automatically for the site.

To install the app: open the site and use the browser's **Install** / **Add to Home Screen** prompt. New deploys are picked up automatically; the in‑app banner also offers an immediate refresh.

---

## Pricing: your prices first, estimates for the rest

RAIning Recipes does **not** scrape retailer sites (they block it and the markup breaks
constantly). Instead, two sources:

1. **Your price database** (the **Prices** tab) — every price you record wins,
   because it's what you actually paid. Three ways in:
   - **Enter a price** by hand for a specific store
   - **Scan a barcode** (ZXing + Open Food Facts names the product, you add the price)
   - **Scan a receipt** (Claude reads it, keeps food only, you review before saving)

2. **AI estimates** — anything you haven't priced yet gets a typical price for
   **your ZIP code**, estimated by Claude and clearly labeled with a `~` in the UI.
   Estimates are cached per item+ZIP for a month.

Set your ZIP during onboarding or in **Profile** — it persists until you change it,
and the ZIP box on a shopping list updates it too. Tap **Update prices** on a list
to fill everything in.


## Importing prices from a credit card statement

`scripts/import-statement.mjs` turns a card statement into a receipt worklist.

```bash
node scripts/import-statement.mjs statement.csv --zip 72701
node scripts/import-statement.mjs statement.xlsx --all --since 2025-01-01
npm i -D xlsx     # only needed for .xlsx (CSV works with no deps)
```

It auto-detects your bank's columns, finds the store transactions, pulls out
**date, total, and card last-4**, skips refunds and sub-$5 noise, and writes
`receipt-worklist.csv`.

**Why there's a manual step in the middle.** A statement only ever has the
*total* — never the line items — so the receipt itself is required. Walmart's
receipt lookup requires a **CAPTCHA**, deliberately: the tool hands over a full
receipt given only (store, date, card last-4, total), so Walmart gates it against
automated querying. That gate can't be honestly automated, and shouldn't be.

**The workflow that does work:**

1. **Check Purchase History first.** If your card is saved to your Walmart.com
   account, in-store purchases are already filed under Account → Purchase History
   with full line items and *no* captcha. Same for emailed receipts. This skips
   the lookup tool entirely.
2. Otherwise, work the CSV: paste the four fields into
   <https://www.walmart.com/receipt-lookup>, clear the captcha, hit Download.
   *(Walmart Pay gotcha: if your real card's last-4 is rejected, use the digital
   card number from the Walmart Pay screen in the app.)*
3. **Prices → Scan receipt → select them all at once.** Claude reads each
   receipt, keeps food only, tags each row with its own store and date, and after
   your review the line items land in the price database — which is exactly what
   your shopping lists price against.

Steps 1 and 3 are fully automated. Only the captcha is on you.

## If you see a 504 on generation

Netlify kills synchronous functions at **10 seconds** (raisable to 26s on Pro
plans, on request). AI generation can exceed that, so:

- Requests abort just under the limit and return a readable message rather than
  a bare 504. Tune with `CLAUDE_TIMEOUT_MS`.
- Revisions send **compact context** — the current recipe plus a short list of
  changes already applied — instead of replaying the whole conversation. Earlier
  builds resent the full recipe on every correction, so the request grew with each
  revision until it timed out.
- If you raise your Netlify timeout, raise `CLAUDE_TIMEOUT_MS` to match.
- `claude-haiku-4-5` is markedly faster than Sonnet if you want more headroom.

## Honest notes on the tricky requirements

A few requirements touch external services or techniques that don't have a clean, reliable, terms‑compliant implementation. Here's exactly how each is handled so there are no surprises:

- **Grocery prices.** No scraping — recorded prices from your price database win, and Claude estimates the rest for your ZIP. See "Pricing" above.
- **Recipe "photo" generation.** Claude generates text, not images. Rather than ship broken image calls, every recipe gets a distinctive, deterministic generated icon (from its name + cuisine). `src/lib/util.js → recipeIconSVG` is the single hook to swap in a real image‑generation API later; user‑uploaded photos already take priority over the icon.
- **Real‑time receipt scanning.** Instead of streaming OCR while you pan the camera (unreliable), you capture a frame (or upload) and Claude vision reads it. Long receipts: capture in sections and/or add rows by hand — every row is editable.
- **Sharing.** No phone numbers, no SMS. One Google account per profile. Recipes are shared to another RAIning Recipes user by their Google account email (copied into their cookbook); shopping lists are emailed with tappable checkboxes that sync back.
- **Nearby stores.** With `GOOGLE_PLACES_API_KEY` set, results come from Google Places ranked by distance. Without it, RAIning Recipes returns a built‑in list of common chains with approximate distances so the flow is fully usable.

Everything degrades gracefully: missing an optional key disables just that piece, with a clear message, never the whole app.
