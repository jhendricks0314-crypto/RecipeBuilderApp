# ForkCast 🍴

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

Optional: `TWILIO_*` (SMS on recipe share), `GOOGLE_PLACES_API_KEY` (real nearby‑store search).

---

## Deploy to Netlify

1. Push this folder to a Git repo and "Add new site → Import" in Netlify (build settings come from `netlify.toml`).
2. Add the same environment variables under **Site settings → Environment variables**.
3. Add your production callback URL to the Google OAuth client.
4. Deploy. Netlify Blobs is enabled automatically for the site.

To install the app: open the site and use the browser's **Install** / **Add to Home Screen** prompt. New deploys are picked up automatically; the in‑app banner also offers an immediate refresh.

---

## Live price scraping

The **Shopping List** screen has an **"Update live prices"** button (with an
optional ZIP for location‑accurate pricing). It calls `/api/scrape-prices`,
which runs a pluggable scraper engine (`netlify/functions/_shared/scrapers.js`)
and merges the results with the receipt database. All prices are cached in
Netlify Blobs for 24h so it stays fast and polite.

Three sources, most reliable first:

1. **Kroger API (recommended).** Set `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET`
   from <https://developer.kroger.com/> (free; `product.compact` scope). This is
   an official API — reliable and location‑aware — and covers every Kroger banner
   (Kroger, Fred Meyer, Ralphs, King Soopers, Harris Teeter, Fry's, Smith's, QFC,
   Dillons, …). Works out of the box, no browser needed.

2. **Configurable store adapters.** Add stores via `SCRAPER_CONFIG` (a JSON array)
   without touching code. Each entry has an `id`, `label`, and `searchUrl`
   (`{term}` is substituted), plus an **`extract`** strategy:

   - `"css"` — CSS selectors `{ item, name, price }` (simple, server‑rendered sites)
   - `"jsonld"` — reads `<script type="application/ld+json">` Product data
   - `"nextdata"` — reads a Next.js `<script id="__NEXT_DATA__">` JSON blob
   - `"auto"` — tries `__NEXT_DATA__`, then JSON‑LD (default when no selectors)

   The JSON strategies use a resilient deep‑scan (they find product objects with a
   name + price even if the exact path shifts), which is far sturdier than CSS
   selectors on modern storefronts. Per store you can also set `"render": true`
   (JS‑heavy) or `"unblock": true` (bot‑protected); both need the browser hook (3).

   ```json
   [
     { "id": "harps", "label": "Harps",
       "searchUrl": "https://www.harpsfood.com/search?q={term}",
       "extract": "css",
       "selectors": { "item": ".product-cell", "name": ".cell-title", "price": ".cell-price" } }
   ]
   ```

3. **Headless render hook (for JS‑heavy sites).** Walmart, Target, Sam's Club and
   similar render prices with JavaScript and block plain HTTP requests. Route
   those through a headless browser and set `"render": true` on the adapter.

   The simplest option is **Browserless** (cloud or self‑hosted). ForkCast POSTs
   `{ url }` to its `/content` endpoint and reads back the rendered HTML:

   ```bash
   # self-hosted, one container:
   docker run -d -p 3000:3000 -e "TOKEN=your-secret" ghcr.io/browserless/chromium
   ```
   ```
   SCRAPER_BROWSER_URL=http://localhost:3000        # "/content" is appended automatically
   SCRAPER_BROWSER_TOKEN=your-secret
   ```

   For Browserless cloud, use `https://production-sfo.browserless.io/content`
   with your account token. Any custom service that takes `POST { url }` and
   returns raw HTML or `{ html }` works too — just point `SCRAPER_BROWSER_URL` at
   it. In production the URL must be reachable from Netlify (not `localhost`).
   Without this hook, JS‑heavy sites return an empty shell. Even with it, some
   sites need residential proxies or Browserless's `/unblock` endpoint to get
   past bot detection.

**Notes for private/personal use:** scraping is bounded by a time budget per
request (click again to price the rest of a long list), sends a normal
User‑Agent, and caches aggressively. Retailer terms and `robots.txt` still apply
— this is provided for your own personal price‑tracking. Items with no live
source fall back to receipt prices (or stay unpriced for you to fill in).

### Store scraper setup: Aldi, Walmart, Dollar General

`.env.example` ships a ready `SCRAPER_CONFIG` for these three (Walmart via
`nextdata` + `unblock`, Aldi and Dollar General via `auto` + `render`). To use it,
set up the Browserless hook (3) and uncomment that line. **Be realistic about
these three** — they're the hardest targets:

- **Walmart** puts prices in a `__NEXT_DATA__` blob behind Akamai + PerimeterX.
  Plain rendering usually hits a challenge page, so the config uses `"unblock": true`
  (Browserless `/unblock`). Even then, datacenter IPs are often blocked — you may
  need Browserless's residential‑proxy option. Prices are ZIP/store‑specific.
- **Aldi (US)** exposes very little scrapable per‑item pricing and gates it behind a
  selected store; expect partial or no results.
- **Dollar General** prices are tied to a specific store number, so a plain search
  returns default/approximate pricing.

Because retailer markup and URLs change, treat the shipped config as a starting
point and verify two things per store:

1. **The search URL.** Search on the store's own site and copy the URL from the
   address bar; replace the query with `{term}`.
2. **That prices actually come back.** Use Browserless's `/content` (or `/unblock`)
   debugger, or ForkCast's own "Update live prices" button, on a common item like
   "milk". If nothing returns, the page likely needs a store/location set first
   (a cookie or URL parameter), or a residential proxy. The `nextdata`/`jsonld`
   deep‑scan means you usually don't need exact JSON paths — but you can pin them
   with `itemsPath` / `namePath` / `pricePath` if you want tighter results.

The engine never crashes on a failed store: a blocked or empty source is simply
skipped, and pricing falls back to your scanned receipts.

## Honest notes on the tricky requirements

A few requirements touch external services or techniques that don't have a clean, reliable, terms‑compliant implementation. Here's exactly how each is handled so there are no surprises:

- **Grocery price scraping.** Built in — see [Live price scraping](#live-price-scraping) below. Prices come from a scraper engine (Kroger API + configurable HTML adapters) and are **merged with the receipt database**, so you get live prices where a source is set up and real paid prices everywhere else. Realities: big‑box sites (Walmart, Target, Sam's) render prices with JavaScript and block plain requests, so they need the headless‑render hook; the Kroger API works out of the box with free personal credentials.
- **Recipe "photo" generation.** Claude generates text, not images. Rather than ship broken image calls, every recipe gets a distinctive, deterministic generated icon (from its name + cuisine). `src/lib/util.js → recipeIconSVG` is the single hook to swap in a real image‑generation API later; user‑uploaded photos already take priority over the icon.
- **Real‑time receipt scanning.** Instead of streaming OCR while you pan the camera (unreliable), you capture a frame (or upload) and Claude vision reads it. Long receipts: capture in sections and/or add rows by hand — every row is editable.
- **SMS on share.** Copying a recipe into a matching profile works with no setup. The **text message** only sends if `TWILIO_*` is configured; otherwise sharing still works and says so.
- **Nearby stores.** With `GOOGLE_PLACES_API_KEY` set, results come from Google Places ranked by distance. Without it, ForkCast returns a built‑in list of common chains with approximate distances so the flow is fully usable.

Everything degrades gracefully: missing an optional key disables just that piece, with a clear message, never the whole app.
