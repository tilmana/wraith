// ─── Config ──────────────────────────────────────────────────────────────────

export type ConfigFieldType = 'number' | 'boolean' | 'string' | 'select'

export interface ConfigField {
  type: ConfigFieldType
  default: unknown
  label: string
  options?: string[]
}

export type ModuleConfig = Record<string, ConfigField>

// ─── Capture ─────────────────────────────────────────────────────────────────

export interface InitCollector {
  key: string
  persist: boolean
  collect: () => unknown
}

export interface EventCapture {
  event: string
  throttle?: number
  persist: boolean
  payload: (e: Event) => unknown
}

export interface HookCapture {
  target: string
  persist: boolean
  handler: (...args: unknown[]) => unknown
}

export interface PollCapture {
  id: string
  interval: number
  persist: boolean
  collect: () => unknown
}

export interface CaptureSpec {
  init?: InitCollector[]
  events?: EventCapture[]
  hooks?: HookCapture[]
  poll?: PollCapture[]
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export interface ModuleCommand {
  id: string
  label: string
  params: Record<string, string>
  handler: (params: Record<string, unknown>) => unknown
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export interface SessionMeta {
  userAgent: string
  url: string
  referrer: string
  ip?: string
  connectedAt: number
}

export interface Session {
  id: string
  meta: SessionMeta
  status: 'active' | 'dead'
  lastSeenAt: number
}

// ─── C2 Protocol messages ────────────────────────────────────────────────────

// Agent → Server
export type AgentMessage =
  | { type: 'handshake'; meta: SessionMeta }
  | { type: 'event'; moduleId: string; eventType: string; payload: unknown; timestamp: number; persist: boolean }
  | { type: 'init_data'; moduleId: string; key: string; value: unknown; persist: boolean }
  | { type: 'command_result'; commandId: string; result: unknown; error?: string }
  | { type: 'ping' }

// Server → Agent
export type ServerMessage =
  | { type: 'session_ack'; sessionId: string }
  | { type: 'module_configs'; modules: SerializedAgentModule[] }
  | { type: 'command'; commandId: string; moduleId: string; commandDef: string; params: Record<string, unknown> }
  | { type: 'pong' }

// Server → Admin UI (over admin WebSocket)
export type AdminMessage =
  | { type: 'session_new'; session: Session }
  | { type: 'session_dead'; sessionId: string }
  | { type: 'session_seen'; sessionId: string; lastSeenAt: number }
  | { type: 'event'; sessionId: string; moduleId: string; eventType: string; payload: unknown; timestamp: number; persist: boolean }
  | { type: 'init_data'; sessionId: string; moduleId: string; key: string; value: unknown }
  | { type: 'command_result'; sessionId: string; commandId: string; moduleId: string; commandDefId: string; result: unknown; error?: string }

// ─── Serialized module (sent from server to agent at session start) ──────────

export interface SerializedInitCollector {
  key: string
  persist: boolean
  collect: string   // fn.toString()
}

export interface SerializedEventCapture {
  event: string
  throttle?: number
  persist: boolean
  payload: string   // fn.toString()
}

export interface SerializedHookCapture {
  target: string
  persist: boolean
  handler: string   // fn.toString()
}

export interface SerializedPollCapture {
  id: string
  interval: number
  persist: boolean
  collect: string   // fn.toString()
}

export interface SerializedCommand {
  id: string
  label: string
  params: Record<string, string>
  handler: string   // fn.toString()
}

export interface SerializedAgentModule {
  id: string
  config: Record<string, unknown>   // resolved defaults
  setup?: string                    // fn.toString()
  capture: {
    init?: SerializedInitCollector[]
    events?: SerializedEventCapture[]
    hooks?: SerializedHookCapture[]
    poll?: SerializedPollCapture[]
  }
  commands: SerializedCommand[]
}

// ─── Transport abstraction ───────────────────────────────────────────────────

export interface C2Transport {
  listen(port: number): Promise<void>
  send(connectionId: string, message: ServerMessage): void
  broadcast(message: ServerMessage): void
  onAgentMessage(handler: (connectionId: string, msg: AgentMessage) => void): void
  onAgentConnect(handler: (connectionId: string) => void): void
  onAgentDisconnect(handler: (connectionId: string) => void): void
  close(): Promise<void>
}

// ─── Encoding abstraction ────────────────────────────────────────────────────

export interface Encoder {
  encode(data: unknown): string | Uint8Array
  decode<T>(data: string | Uint8Array): T
}

// ─── Module live state ───────────────────────────────────────────────────────

export interface LiveEvent {
  type: string
  payload: unknown
  moduleId: string
  sessionId: string
  timestamp: number
}

// State shape is module-defined and opaque to the framework — any is intentional.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LiveReducer<S = any> = (state: S | undefined, event: LiveEvent) => S

// ─── Module transform ────────────────────────────────────────────────────────

export interface StoredEvent {
  moduleId: string
  type: string
  payload: unknown
  timestamp: number
  persist: boolean
}

export interface StoredInitData {
  moduleId: string
  key: string
  value: unknown
}

export interface StoredCommand {
  id: string
  moduleId: string
  commandDefId: string
  params: Record<string, unknown>
  status: 'pending' | 'done' | 'error'
  result?: unknown
  error?: string
  createdAt: number
  completedAt?: number
}

export type TransformFn = (
  events: StoredEvent[],
  initData: StoredInitData[]
) => Record<string, { data: unknown; persist: boolean }>

// ─── Module lifecycle ────────────────────────────────────────────────────────

export interface LifecycleHooks {
  onSessionStart?: (session: Session) => void
  onSessionEnd?: (session: Session) => void
  onEvent?: {
    types: Set<string>
    handler: (event: StoredEvent, session: Session) => void
  }
}

// ─── UI nav ──────────────────────────────────────────────────────────────────

export interface UINav {
  label: string
  icon: string
}

// ─── Full module contract ────────────────────────────────────────────────────

export interface WraithModule {
  id: string
  name: string
  version: string
  description: string
  author?: string
  date?: string
  permissions?: string[]   // reserved for future enforcement — not checked by framework

  config?: ModuleConfig

  // Agent-side
  agent?: { setup: () => void }
  capture?: CaptureSpec
  commands?: ModuleCommand[]

  // Server-side
  live: LiveReducer
  transform?: TransformFn
  lifecycle?: LifecycleHooks

  // UI-side (typed loosely to avoid React dep in this package)
  ui: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    panel: (props: any) => any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    view: (props: any) => any
    nav: UINav
  }
}
