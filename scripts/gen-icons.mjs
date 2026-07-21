// Generates the PWA icon set for RAIning Recipes from the brand logo
// (src/assets/logo.png). Run with: npm run gen:icons
//
// The logo is a dark circular badge with fine detail (the wordmark and the little
// PANTRY/PRICES/SHOP/LISTS row). That detail reads at 512px but turns to mush
// below ~128px, so small icons are cropped to the emblem — the AI cloud raining
// into the bowl — which stays legible at any size.
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icons')
// Full-resolution artwork lives here; src/assets/logo.png is a downscaled copy
// used for in-app display only.
const SRC = join(root, 'scripts', 'logo-source.png')
mkdirSync(outDir, { recursive: true })

// The badge is a circular mark on a black field, so padding uses the same black
// and the inset is invisible.
const BG = { r: 0, g: 0, b: 0, alpha: 1 }
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 }

async function compose(artBuf, size) {
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: artBuf, gravity: 'centre' }])
    .png()
    .toBuffer()
}

// Full badge, padded slightly so the circle isn't flush to the edge.
async function fullBadge(size, pad = 0.01) {
  const inner = Math.round(size * (1 - pad * 2))
  const art = await sharp(SRC).resize(inner, inner, { fit: 'contain', background: CLEAR }).toBuffer()
  return compose(art, size)
}

// Just the emblem (upper portion of the artwork) for small sizes.
async function emblem(size, pad = 0.06) {
  const meta = await sharp(SRC).metadata()
  const side = Math.round(meta.width * 0.58)
  const left = Math.round((meta.width - side) / 2)
  const top = Math.round(meta.height * 0.08)
  const inner = Math.round(size * (1 - pad * 2))
  const art = await sharp(SRC)
    .extract({ left, top, width: side, height: side })
    .resize(inner, inner, { fit: 'contain', background: CLEAR })
    .toBuffer()
  return compose(art, size)
}

// Launchers crop maskable icons hard, so keep the art inside the middle ~62%.
async function maskable(size) {
  const inner = Math.round(size * 0.62)
  const art = await sharp(SRC).resize(inner, inner, { fit: 'contain', background: CLEAR }).toBuffer()
  return compose(art, size)
}

async function run() {
  const write = async (buf, name) => { await sharp(buf).toFile(join(outDir, name)) }

  await write(await fullBadge(512), 'pwa-512.png')
  await write(await maskable(512), 'pwa-512-maskable.png')
  await write(await fullBadge(192), 'pwa-192.png')
  await write(await fullBadge(180), 'apple-touch-icon.png')

  // Small sizes use the emblem so they stay legible.
  await write(await emblem(96), 'favicon-96.png')
  await write(await emblem(48), 'favicon-48.png')
  await write(await emblem(32), 'favicon-32.png')

  console.log('Icons written to public/icons')
}
run().catch((e) => { console.error(e); process.exit(1) })
