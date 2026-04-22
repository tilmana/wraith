import { create } from 'zustand'
import type { Session, AdminMessage, StoredEvent, StoredInitData, StoredCommand } from '@wraith/types'

export interface SessionState {
  live:     Map<string, Record<string, unknown>>  // moduleId → live state
  events:   Map<string, StoredEvent[]>            // moduleId → events
  initData: Map<string, StoredInitData[]>         // moduleId → init data
  commands: Map<string, StoredCommand[]>          // moduleId → commands
}

function emptySessionState(): SessionState {
  return { live: new Map(), events: new Map(), initData: new Map(), commands: new Map() }
}

// Reducer accepts undefined on first call — module default param handles initialization
type ModuleReducer = (s: Record<string, unknown> | undefined, e: unknown) => Record<string, unknown>

interface WraithStore {
  sessions:     Map<string, Session>
  sessionState: Map<string, SessionState>
  connected:    boolean
  authFailed:   boolean

  setConnected:        (v: boolean) => void
  setAuthFailed:       (v: boolean) => void
  loadSessions:        (sessions: Session[]) => void
  applyAdminMessage:   (msg: AdminMessage, moduleReducers: Map<string, ModuleReducer>) => void
  loadSessionEvents:   (sessionId: string, events: StoredEvent[], moduleReducers: Map<string, ModuleReducer>) => void
  loadSessionInitData: (sessionId: string, data: StoredInitData[]) => void
  loadSessionCommands: (sessionId: string, commands: StoredCommand[]) => void
  addPendingCommand:   (sessionId: string, command: StoredCommand) => void
  deleteSession:       (sessionId: string) => void
  deleteDeadSessions:  () => void
}

export const useWraithStore = create<WraithStore>((set) => ({
  sessions:     new Map(),
  sessionState: new Map(),
  connected:    false,
  authFailed:   false,

  setConnected:  (v) => set({ connected: v }),
  setAuthFailed: (v) => set({ authFailed: v }),

  // Merge incoming sessions without overwriting ones already in the store
  loadSessions: (incoming) => set((state) => {
    const sessions = new Map(state.sessions)
    for (const s of incoming) {
      if (!sessions.has(s.id)) sessions.set(s.id, s)
    }
    return { sessions }
  }),

  applyAdminMessage: (msg, moduleReducers) => {
    set((state) => {
      // Session lifecycle messages only touch sessions — don't copy sessionState
      if (msg.type === 'session_new') {
        if (state.sessions.has(msg.session.id)) return {}
        return { sessions: new Map(state.sessions).set(msg.session.id, msg.session) }
      }

      if (msg.type === 'session_dead') {
        const s = state.sessions.get(msg.sessionId)
        if (!s) return {}
        return { sessions: new Map(state.sessions).set(msg.sessionId, { ...s, status: 'dead' }) }
      }

      if (msg.type === 'session_seen') {
        const s = state.sessions.get(msg.sessionId)
        if (!s) return {}
        return { sessions: new Map(state.sessions).set(msg.sessionId, { ...s, lastSeenAt: msg.lastSeenAt }) }
      }

      // Data messages only touch sessionState — don't copy sessions
      if (msg.type === 'event') {
        const ss = state.sessionState.get(msg.sessionId) ?? emptySessionState()

        // Build new events map if this event is persisted
        let newEvents = ss.events
        if (msg.persist) {
          const existing = ss.events.get(msg.moduleId) ?? []
          newEvents = new Map(ss.events).set(msg.moduleId, [...existing, {
            moduleId:  msg.moduleId,
            type:      msg.eventType,
            payload:   msg.payload,
            timestamp: msg.timestamp,
            persist:   true,
          }])
        }

        // Run live reducer to get new live state
        let newLive = ss.live
        const reducer = moduleReducers.get(msg.moduleId)
        if (reducer) {
          const liveEvent = {
            type: msg.eventType, payload: msg.payload,
            moduleId: msg.moduleId, sessionId: msg.sessionId, timestamp: msg.timestamp,
          }
          newLive = new Map(ss.live).set(msg.moduleId, reducer(ss.live.get(msg.moduleId), liveEvent))
        }

        // Skip update entirely if nothing changed (persist:false + no reducer)
        if (newEvents === ss.events && newLive === ss.live) return {}

        const sessionState = new Map(state.sessionState)
        sessionState.set(msg.sessionId, { ...ss, events: newEvents, live: newLive })
        return { sessionState }
      }

      if (msg.type === 'init_data') {
        const sessionState = new Map(state.sessionState)
        const ss = sessionState.get(msg.sessionId) ?? emptySessionState()
        const existing = ss.initData.get(msg.moduleId) ?? []
        const filtered = existing.filter((d: StoredInitData) => d.key !== msg.key)
        filtered.push({ moduleId: msg.moduleId, key: msg.key, value: msg.value })
        sessionState.set(msg.sessionId, { ...ss, initData: new Map(ss.initData).set(msg.moduleId, filtered) })
        return { sessionState }
      }

      if (msg.type === 'command_result' && msg.moduleId) {
        const sessionState = new Map(state.sessionState)
        const ss = sessionState.get(msg.sessionId) ?? emptySessionState()
        const existing = ss.commands.get(msg.moduleId) ?? []
        const idx = existing.findIndex((c: StoredCommand) => c.id === msg.commandId)
        const updated: StoredCommand = {
          id:           msg.commandId,
          moduleId:     msg.moduleId,
          commandDefId: msg.commandDefId,
          params:       {},
          status:       msg.error ? 'error' : 'done',
          result:       msg.result,
          error:        msg.error,
          createdAt:    0,
          completedAt:  Date.now(),
        }
        const newCmds = idx !== -1
          ? existing.map((c: StoredCommand, i: number) => i === idx ? updated : c)
          : [...existing, updated]
        sessionState.set(msg.sessionId, { ...ss, commands: new Map(ss.commands).set(msg.moduleId, newCmds) })
        return { sessionState }
      }

      return {}
    })
  },

  loadSessionEvents: (sessionId, events, moduleReducers) => {
    set((state) => {
      const sessionState = new Map(state.sessionState)
      const ss = sessionState.get(sessionId) ?? emptySessionState()
      const newEvents = new Map<string, StoredEvent[]>()
      for (const evt of events) {
        const arr = newEvents.get(evt.moduleId)
        if (arr) arr.push(evt)
        else newEvents.set(evt.moduleId, [evt])
      }
      // Merge any WS-applied events newer than the REST snapshot. Since the server
      // writes to DB before broadcasting, timestamp > REST max means the event
      // arrived after the REST query was processed — genuinely new, not a duplicate.
      for (const [moduleId, wsEvts] of ss.events) {
        const restEvts = newEvents.get(moduleId) ?? []
        const maxRestTs = restEvts.length ? Math.max(...restEvts.map(e => e.timestamp)) : -1
        const newer = wsEvts.filter(e => e.persist && e.timestamp > maxRestTs)
        if (newer.length) newEvents.set(moduleId, [...restEvts, ...newer])
      }
      // Rebuild live state by replaying stored events through each module's reducer.
      // This restores live panels after navigation or page refresh.
      const newLive = new Map(ss.live)
      for (const [moduleId, modEvents] of newEvents) {
        const reducer = moduleReducers.get(moduleId)
        if (!reducer) continue
        let liveState: Record<string, unknown> | undefined = undefined
        for (const evt of modEvents) {
          liveState = reducer(liveState, {
            type: evt.type, payload: evt.payload,
            moduleId: evt.moduleId, sessionId, timestamp: evt.timestamp,
          })
        }
        if (liveState !== undefined) newLive.set(moduleId, liveState)
      }
      sessionState.set(sessionId, { ...ss, events: newEvents, live: newLive })
      return { sessionState }
    })
  },

  loadSessionInitData: (sessionId, data) => {
    set((state) => {
      const sessionState = new Map(state.sessionState)
      const ss = sessionState.get(sessionId) ?? emptySessionState()
      const newInitData = new Map(ss.initData)
      for (const d of data) {
        const existing = newInitData.get(d.moduleId) ?? []
        const filtered = existing.filter((x: StoredInitData) => x.key !== d.key)
        filtered.push(d)
        newInitData.set(d.moduleId, filtered)
      }
      sessionState.set(sessionId, { ...ss, initData: newInitData })
      return { sessionState }
    })
  },

  loadSessionCommands: (sessionId, commands) => {
    set((state) => {
      const sessionState = new Map(state.sessionState)
      const ss = sessionState.get(sessionId) ?? emptySessionState()
      const newCommands = new Map<string, StoredCommand[]>()
      for (const cmd of commands) {
        const arr = newCommands.get(cmd.moduleId)
        if (arr) arr.push(cmd)
        else newCommands.set(cmd.moduleId, [cmd])
      }
      sessionState.set(sessionId, { ...ss, commands: newCommands })
      return { sessionState }
    })
  },

  deleteSession: (sessionId) => {
    set((state) => {
      const sessions = new Map(state.sessions)
      const sessionState = new Map(state.sessionState)
      sessions.delete(sessionId)
      sessionState.delete(sessionId)
      return { sessions, sessionState }
    })
  },

  deleteDeadSessions: () => {
    set((state) => {
      const sessions = new Map(state.sessions)
      const sessionState = new Map(state.sessionState)
      for (const [id, s] of sessions) {
        if (s.status === 'dead') { sessions.delete(id); sessionState.delete(id) }
      }
      return { sessions, sessionState }
    })
  },

  addPendingCommand: (sessionId, command) => {
    set((state) => {
      const sessionState = new Map(state.sessionState)
      const ss = sessionState.get(sessionId) ?? emptySessionState()
      const existing = ss.commands.get(command.moduleId) ?? []
      // Only insert if not already present — result may have arrived first
      if (existing.find((c: StoredCommand) => c.id === command.id)) return {}
      sessionState.set(sessionId, {
        ...ss,
        commands: new Map(ss.commands).set(command.moduleId, [...existing, command]),
      })
      return { sessionState }
    })
  },
}))
