// Generates the PWA icon set for RAIning Recipes.
// Run with: npm run gen:icons
//
// The mark: a cloud built from wired-up neural nodes — the "AI" doing the
// thinking — raining a recipe card, a droplet and a herb sprig down into your
// kitchen. The circuitry reads as automation, the falling card and sprig read as
// food, and at favicon size it still resolves as a clean cloud-with-rain shape.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const INK = '#16231c'
const SAFFRON = '#e0a82e'
const CREAM = '#f5f2ea'
const BASIL = '#7fb08e'

// --- the AI cloud: outline + neural nodes wired together ---
const cloud = `
  <path d="M150 232c-30 0-54-24-54-54 0-27 20-49 46-53 8-31 36-54 69-54 27 0 51 15 63 38 6-3 13-4 20-4 26 0 47 21 47 47 0 3 0 6-1 9 21 6 36 25 36 48 0 12-6 23-15 31"
        fill="none" stroke="${SAFFRON}" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M150 232h211" fill="none" stroke="${SAFFRON}" stroke-width="17" stroke-linecap="round"/>
  <g stroke="${BASIL}" stroke-width="7" stroke-linecap="round" fill="none">
    <path d="M175 178l45-28 48 30 44-26"/>
    <path d="M220 150v-28"/>
    <path d="M268 180v28"/>
  </g>
  <g fill="${CREAM}">
    <circle cx="175" cy="178" r="12"/>
    <circle cx="220" cy="150" r="12"/>
    <circle cx="268" cy="180" r="12"/>
    <circle cx="312" cy="154" r="12"/>
    <circle cx="220" cy="122" r="9"/>
    <circle cx="268" cy="208" r="9"/>
  </g>`

// --- the rain: a recipe card, a droplet, a herb sprig ---
const rain = `
  <g transform="translate(146 286) rotate(-13)">
    <rect x="0" y="0" width="86" height="106" rx="12" fill="${CREAM}"/>
    <g stroke="${INK}" stroke-width="8" stroke-linecap="round" opacity="0.85">
      <path d="M18 30h50"/><path d="M18 54h50"/><path d="M18 78h30"/>
    </g>
  </g>

  <path d="M292 300c0 0-30 34-30 52a30 30 0 0 0 60 0c0-18-30-52-30-52z" fill="${SAFFRON}"/>

  <g transform="translate(356 302)">
    <path d="M14 0v74" stroke="${BASIL}" stroke-width="11" stroke-linecap="round" fill="none"/>
    <path d="M14 24c-16-4-24-16-24-16s16-6 24 16z" fill="${BASIL}"/>
    <path d="M14 50c16-4 24-16 24-16s-16-6-24 16z" fill="${BASIL}"/>
  </g>

  <circle cx="196" cy="426" r="11" fill="${SAFFRON}" opacity="0.75"/>
  <circle cx="292" cy="406" r="9" fill="${CREAM}" opacity="0.6"/>`

const mark = cloud + rain

const svg = (maskable = false) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="${INK}"/>
  ${maskable ? `<g transform="translate(51 56) scale(0.8)">${mark}</g>` : mark}
</svg>`

const favicon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${INK}"/>${mark}
</svg>`

async function run() {
  writeFileSync(join(outDir, 'favicon.svg'), favicon.trim())
  await sharp(Buffer.from(svg())).resize(192, 192).png().toFile(join(outDir, 'pwa-192.png'))
  await sharp(Buffer.from(svg())).resize(512, 512).png().toFile(join(outDir, 'pwa-512.png'))
  await sharp(Buffer.from(svg(true))).resize(512, 512).png().toFile(join(outDir, 'pwa-512-maskable.png'))
  await sharp(Buffer.from(svg())).resize(180, 180).png().toFile(join(outDir, 'apple-touch-icon.png'))
  console.log('Icons written to public/icons')
}
run().catch((e) => { console.error(e); process.exit(1) })
