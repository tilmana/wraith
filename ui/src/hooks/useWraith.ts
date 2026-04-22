import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AdminMessage, Session } from '@wraith/types'
import { useWraithStore, type SessionState } from '../store/index.js'
import { getToken, apiFetch } from '../api.js'

// Undefined on first call — module's default parameter handles initialization
type ModuleReducer = (s: Record<string, unknown> | undefined, e: unknown) => Record<string, unknown>

const moduleReducers = new Map<string, ModuleReducer>()

export function registerModuleReducer(moduleId: string, reducer: ModuleReducer): void {
  moduleReducers.set(moduleId, reducer)
}

export function getModuleReducers(): Map<string, ModuleReducer> {
  return moduleReducers
}

export function useWraithConnection() {
  const wsRef     = useRef<WebSocket | null>(null)
  const activeRef = useRef(true)  // false during StrictMode cleanup / unmount
  const { setConnected, applyAdminMessage, loadSessions } = useWraithStore()

  useEffect(() => {
    activeRef.current = true

    function connect() {
      if (!activeRef.current) return
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
      const token = getToken()
      const qs = token ? `?token=${encodeURIComponent(token)}` : ''
      const ws = new WebSocket(`${protocol}://${location.host}/ws/admin${qs}`)
      wsRef.current = ws

      ws.onopen = () => {
        if (!activeRef.current) return
        setConnected(true)
        apiFetch('/api/sessions').then(r => r.json()).then((sessions: Session[]) => {
          if (activeRef.current) loadSessions(sessions)
        }).catch(() => { /* non-fatal or auth handled by store */ })
      }
      ws.onclose = (ev) => {
        if (!activeRef.current) return      // cleanup-triggered close — don't reconnect
        if (wsRef.current !== ws) return    // stale close from superseded socket
        setConnected(false)
        if (ev.code === 4401) {
          useWraithStore.getState().setAuthFailed(true)
          return  // don't reconnect — token is wrong
        }
        setTimeout(connect, 3000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (ev) => {
        if (!activeRef.current) return
        try {
          const msg = JSON.parse(ev.data as string) as AdminMessage
          applyAdminMessage(msg, moduleReducers)
        } catch { /* skip malformed */ }
      }
    }

    connect()
    return () => {
      activeRef.current = false
      wsRef.current?.close()
    }
  }, [])
}

// Returns sessions sorted by lastSeenAt desc. useShallow prevents re-render when
// the array contents haven't actually changed (e.g. unrelated store updates).
export function useSessions(): Session[] {
  return useWraithStore(
    useShallow(s => Array.from(s.sessions.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt))
  )
}

// Fine-grained subscription to a single session — only re-renders when that session changes.
export function useSession(sessionId: string): Session | undefined {
  return useWraithStore(s => s.sessions.get(sessionId))
}

export function useSessionState(sessionId: string): SessionState | undefined {
  return useWraithStore(s => s.sessionState.get(sessionId))
}

export function useConnected() {
  return useWraithStore(s => s.connected)
}

export async function sendCommand(
  sessionId: string,
  moduleId: string,
  commandId: string,
  params: Record<string, unknown> = {},
): Promise<{ commandId: string }> {
  const res = await apiFetch(`/api/sessions/${sessionId}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moduleId, commandId, params }),
  })
  if (!res.ok) throw new Error(`command failed: ${res.status}`)
  return res.json()
}
