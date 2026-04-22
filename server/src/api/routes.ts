import type { FastifyInstance } from 'fastify'
import { nanoid } from 'nanoid'
import { getDb } from '../db/index.js'
import { registry } from '../modules/registry.js'
import type { SessionManager } from '../sessions/manager.js'
import type { AdminMessage } from '@wraith/types'

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? ''

export async function registerRoutes(
  app: FastifyInstance,
  sessions: SessionManager,
): Promise<(msg: AdminMessage) => void> {
  const db = getDb()
  const stmtListSessions  = db.prepare(
    `SELECT id, meta, status, last_seen_at FROM sessions ORDER BY last_seen_at DESC`
  )
  const stmtDeleteSession = db.prepare(`DELETE FROM sessions  WHERE id = ?`)
  const stmtDeleteEvents  = db.prepare(`DELETE FROM events    WHERE session_id = ?`)
  const stmtDeleteInit    = db.prepare(`DELETE FROM init_data WHERE session_id = ?`)
  const stmtDeleteCmds    = db.prepare(`DELETE FROM commands  WHERE session_id = ?`)
  const stmtDeadIds       = db.prepare(`SELECT id FROM sessions WHERE status = 'dead'`)
  const stmtListCommands  = db.prepare(
    `SELECT id, module_id, command_id, params, status, result, error, created_at, completed_at FROM commands WHERE session_id = ? ORDER BY created_at ASC`
  )

  // WebSocket clients subscribed to the admin feed
  const adminClients = new Set<{ send: (data: string) => void }>()

  function broadcastAdmin(msg: AdminMessage): void {
    const raw = JSON.stringify(msg)
    adminClients.forEach(client => {
      try { client.send(raw) } catch { /* dead client */ }
    })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  if (ADMIN_TOKEN) {
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api')) return
      if (req.headers['authorization'] !== `Bearer ${ADMIN_TOKEN}`) {
        reply.status(401).send({ error: 'unauthorized' })
      }
    })
  }

  // ── Admin WebSocket ──────────────────────────────────────────────────────
  app.get('/ws/admin', { websocket: true }, (socket, req) => {
    if (ADMIN_TOKEN) {
      const { token } = (req.query ?? {}) as { token?: string }
      if (token !== ADMIN_TOKEN) {
        socket.close(4401, 'unauthorized')
        return
      }
    }
    adminClients.add(socket)
    socket.on('close', () => adminClients.delete(socket))
    socket.on('error', () => adminClients.delete(socket))
  })

  // ── Sessions ─────────────────────────────────────────────────────────────
  app.get('/api/sessions', async () => {
    const rows = stmtListSessions
      .all() as Array<{ id: string; meta: string; status: string; last_seen_at: number }>

    return rows.map(r => ({
      id:         r.id,
      meta:       JSON.parse(r.meta),
      status:     r.status,
      lastSeenAt: r.last_seen_at,
    }))
  })

  app.get('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = sessions.getSession(id)
    if (!session) { reply.status(404); return { error: 'session not found' } }
    return session
  })

  app.get('/api/sessions/:id/events', async (req) => {
    const { id } = req.params as { id: string }
    return sessions.getEvents(id)
  })

  app.get('/api/sessions/:id/init-data', async (req) => {
    const { id } = req.params as { id: string }
    return sessions.getInitData(id)
  })

  app.get('/api/sessions/:id/live', async (req) => {
    const { id } = req.params as { id: string }
    const { moduleId } = req.query as { moduleId?: string }
    const mods = moduleId ? [moduleId] : registry.all().map(m => m.id)
    return Object.fromEntries(mods.map(mid => [mid, sessions.getLiveState(id, mid)]))
  })

  app.get('/api/sessions/:id/commands', async (req) => {
    const { id } = req.params as { id: string }
    const rows = stmtListCommands
      .all(id) as Array<{
        id: string; module_id: string; command_id: string; params: string
        status: string; result: string | null; error: string | null
        created_at: number; completed_at: number | null
      }>
    return rows.map(r => ({
      id:           r.id,
      moduleId:     r.module_id,
      commandDefId: r.command_id,
      params:       JSON.parse(r.params),
      status:       r.status,
      result:       r.result !== null ? JSON.parse(r.result) : undefined,
      error:        r.error ?? undefined,
      createdAt:    r.created_at,
      completedAt:  r.completed_at ?? undefined,
    }))
  })

  app.delete('/api/sessions/dead', async () => {
    const deadIds = (stmtDeadIds.all() as Array<{ id: string }>).map(r => r.id)
    for (const id of deadIds) {
      stmtDeleteEvents.run(id)
      stmtDeleteInit.run(id)
      stmtDeleteCmds.run(id)
      stmtDeleteSession.run(id)
    }
    return { deleted: deadIds.length }
  })

  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    stmtDeleteEvents.run(id)
    stmtDeleteInit.run(id)
    stmtDeleteCmds.run(id)
    const info = stmtDeleteSession.run(id)
    if (info.changes === 0) { reply.status(404); return { error: 'session not found' } }
    return { ok: true }
  })

  // ── Commands ──────────────────────────────────────────────────────────────
  app.post('/api/sessions/:id/command', async (req, reply) => {
    const { id } = req.params as { id: string }
    const { moduleId, commandId, params } = req.body as {
      moduleId: string
      commandId: string
      params?: Record<string, unknown>
    }

    const mod = registry.get(moduleId)
    if (!mod) { reply.status(400); return { error: 'unknown module' } }

    const cmdDef = mod.commands?.find(c => c.id === commandId)
    if (!cmdDef) { reply.status(400); return { error: 'unknown command' } }

    const connectionId = sessions.getConnectionId(id)
    if (!connectionId) {
      reply.status(404)
      return { error: 'session not connected' }
    }

    const execId = nanoid()
    sessions.sendCommand(connectionId, id, execId, moduleId, commandId, params ?? {})
    return { commandId: execId }
  })

  // ── Modules ───────────────────────────────────────────────────────────────
  app.get('/api/modules', async () => {
    return registry.all().map(m => ({
      id:          m.id,
      name:        m.name,
      version:     m.version,
      description: m.description,
      permissions: m.permissions,
      config:      m.config,
      commands:    (m.commands ?? []).map(c => ({ id: c.id, label: c.label, params: c.params })),
      nav:         m.ui.nav,
    }))
  })

  return broadcastAdmin
}
