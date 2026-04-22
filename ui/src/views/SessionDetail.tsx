import { useEffect, useState, Component } from 'react'
import type { ReactNode } from 'react'
import { useParams, Navigate } from 'react-router-dom'
import {
  MousePointer2, Key, Network, Eye, Terminal, Wifi, HardDrive, Cpu,
  Globe, Lock, Camera, Mic, MapPin, FileText, Activity, type LucideIcon,
} from 'lucide-react'
import { useSession, useSessionState, sendCommand, useConnected, getModuleReducers } from '../hooks/useWraith.js'
import { useWraithStore } from '../store/index.js'
import { apiFetch } from '../api.js'

export interface ModuleUI {
  id:          string
  name:        string
  version:     string
  description: string
  author?:     string
  date?:       string
  nav:         { label: string; icon: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  panel: (props: any) => JSX.Element
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  view:  (props: any) => JSX.Element
}

const ICON_MAP: Record<string, LucideIcon> = {
  cursor:   MousePointer2,
  key:      Key,
  network:  Network,
  eye:      Eye,
  terminal: Terminal,
  wifi:     Wifi,
  disk:     HardDrive,
  cpu:      Cpu,
  globe:    Globe,
  lock:     Lock,
  camera:   Camera,
  mic:      Mic,
  location: MapPin,
  file:     FileText,
  activity: Activity,
}

export function ModuleIcon({ name, size = 12 }: { name: string; size?: number }) {
  const Icon = ICON_MAP[name]
  return Icon ? <Icon size={size} /> : null
}

class ModuleErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded border border-red-900 bg-red-950/30 px-4 py-3 text-xs text-red-400">
          Module UI error: {(this.state.error as Error).message}
        </div>
      )
    }
    return this.props.children
  }
}

const moduleUIs: ModuleUI[] = []

export function registerModuleUI(ui: ModuleUI): void {
  if (!moduleUIs.find(m => m.id === ui.id)) moduleUIs.push(ui)
}

export function getModuleUIs(): ModuleUI[] {
  return moduleUIs
}

export function SessionDetail() {
  const { id: sessionId } = useParams<{ id: string }>()
  const sessionState = useSessionState(sessionId!)
  const session      = useSession(sessionId!)

  const [activeModule, setActiveModule] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    const store = useWraithStore.getState()
    Promise.all([
      apiFetch(`/api/sessions/${sessionId}/events`).then(r => r.json()),
      apiFetch(`/api/sessions/${sessionId}/init-data`).then(r => r.json()),
      apiFetch(`/api/sessions/${sessionId}/commands`).then(r => r.json()),
    ]).then(([events, initData, commands]) => {
      store.loadSessionEvents(sessionId, events, getModuleReducers())
      store.loadSessionInitData(sessionId, initData)
      store.loadSessionCommands(sessionId, commands)
    }).catch(() => { /* auth handled globally; session may be gone */ })
  }, [sessionId])

  const connected = useConnected()
  if (!session && connected) return <Navigate to="/sessions" replace />
  if (!session) return <div className="flex-1 flex items-center justify-center text-muted text-sm">loading…</div>

  const activeUI   = activeModule ? moduleUIs.find(m => m.id === activeModule) : moduleUIs[0]
  const liveState  = sessionState?.live.get(activeUI?.id ?? '') ?? {}
  const allEvents   = activeUI ? (sessionState?.events.get(activeUI.id) ?? []) : []
  const allInitData = activeUI ? (sessionState?.initData.get(activeUI.id) ?? []) : []
  const allCommands = activeUI ? (sessionState?.commands.get(activeUI.id) ?? []) : []

  const doSendCommand = (commandId: string, params?: Record<string, unknown>) => {
    if (!activeUI) return
    const moduleId = activeUI.id
    sendCommand(session.id, moduleId, commandId, params).then(({ commandId: execId }) => {
      useWraithStore.getState().addPendingCommand(session.id, {
        id:           execId,
        moduleId,
        commandDefId: commandId,
        params:       params ?? {},
        status:       'pending',
        createdAt:    Date.now(),
      })
    }).catch(() => { /* POST failed — session likely disconnected */ })
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Session header */}
      <div className="border-b border-border px-6 py-3 flex items-center gap-4 bg-panel">
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${session.status === 'active' ? 'bg-green-400' : 'bg-muted'}`} />
        <span className="text-xs font-mono text-gray-300 truncate">{session.id}</span>
        <span className="text-xs text-muted truncate">{session.meta.url}</span>
        <span className="text-xs text-muted ml-auto truncate max-w-xs">{session.meta.userAgent}</span>
      </div>

      {/* Module tabs — only shown if more than one module */}
      {moduleUIs.length > 1 && (
        <div className="border-b border-border flex items-center gap-1 px-4 bg-surface">
          {moduleUIs.map(m => (
            <button
              key={m.id}
              onClick={() => setActiveModule(m.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors border-b-2 ${
                activeUI?.id === m.id
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-gray-300'
              }`}
            >
              <ModuleIcon name={m.nav.icon} />
              {m.nav.label}
            </button>
          ))}
        </div>
      )}

      {/* Module content — panel (live) on top, full data below */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {activeUI ? (
          <ModuleErrorBoundary>
            <activeUI.panel
              live={liveState}
              session={session}
              sendCommand={doSendCommand}
            />
            <activeUI.view
              data={{ events: allEvents, initData: allInitData, commands: allCommands }}
              session={session}
              sendCommand={doSendCommand}
            />
          </ModuleErrorBoundary>
        ) : (
          <p className="text-muted text-sm">no modules registered</p>
        )}
      </div>
    </div>
  )
}
