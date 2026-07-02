// Generates the PWA icon set from an inline SVG (the ForkCast fork mark on the
// basil background). Run with: npm run gen:icons
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const fork = `
  <g fill="none" stroke="#e0a82e" stroke-width="18" stroke-linecap="round" stroke-linejoin="round">
    <path d="M180 120v90a55 55 0 0 0 110 0v-90"/>
    <path d="M235 120v280"/>
    <path d="M360 120c-33 0-55 44-55 110s22 88 55 88 55-22 55-88-22-110-55-110z"/>
    <path d="M360 318v82"/>
  </g>`

const svg = (maskable = false) => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${maskable ? 0 : 112}" fill="#16231c"/>
  ${maskable ? '<g transform="translate(51 51) scale(0.8)">' + fork + '</g>' : fork}
</svg>`

const favicon = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#16231c"/>${fork}
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
