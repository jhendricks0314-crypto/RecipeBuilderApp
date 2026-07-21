// Validates netlify.toml with Netlify's own resolver before deploying.
//
// A malformed netlify.toml fails the build at Netlify's very first stage
// ("Reading and parsing configuration files"), which wastes a deploy cycle to
// find out. This catches it locally in a second.
import { resolveConfig } from '@netlify/config'

try {
  const { config } = await resolveConfig({
    repositoryRoot: process.cwd(),
    cwd: process.cwd(),
    mode: 'cli',
  })
  const fns = config.functions?.['*'] || {}
  console.log('netlify.toml OK' + (fns.timeout ? `  (function timeout: ${fns.timeout}s)` : ''))
} catch (e) {
  console.error('\nnetlify.toml is invalid — Netlify would reject this build:\n')
  console.error(e.message.split('\n').filter(Boolean).slice(0, 6).join('\n'))
  process.exit(1)
}
