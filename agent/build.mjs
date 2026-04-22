import * as esbuild from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

const C2_URL  = process.env.C2_URL  ?? 'ws://localhost:3001'
const SESSION_KEY = process.env.SESSION_KEY ?? ''

const BANNER = `/**
 * Wraith Agent — https://github.com/tilmana/wraith
 * Educational browser hook framework for authorized security research only.
 * Do not use against systems without explicit written permission.
 * See LICENSE for details.
 */`

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(__dirname, 'src/index.ts')],
  outfile:     path.join(__dirname, 'dist/hook.js'),
  bundle:      true,
  minify:      true,
  target:      'es2020',
  format:      'iife',
  banner:      { js: BANNER },
  define: {
    '__WRAITH_C2_URL__':     JSON.stringify(C2_URL),
    '__WRAITH_SESSION_KEY__': JSON.stringify(SESSION_KEY),
  },
  // Keep the agent self-contained — no external deps allowed
  platform: 'browser',
}

if (watch) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  console.log('[agent] watching for changes...')
} else {
  await esbuild.build(options)
  console.log('[agent] built → dist/hook.js')
}
