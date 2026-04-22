import type { AgentTransport } from './interface.js'
import type { AgentEncoder } from '../encoding/index.js'

const RECONNECT_BASE_MS  = 2_000
const RECONNECT_MAX_MS   = 30_000

export class WebSocketAgentTransport implements AgentTransport {
  private ws: WebSocket | null = null
  private reconnectDelay = RECONNECT_BASE_MS
  private url = ''

  private openHandlers:    Array<() => void> = []
  private messageHandlers: Array<(data: unknown) => void> = []
  private closeHandlers:   Array<() => void> = []

  constructor(private encoder: AgentEncoder) {}

  connect(url: string): void {
    this.url = url
    this.open()
  }

  private open(): void {
    try {
      this.ws = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectDelay = RECONNECT_BASE_MS
      this.openHandlers.forEach(h => h())
    }

    this.ws.onmessage = (ev) => {
      try {
        const msg = this.encoder.decode(ev.data as string)
        this.messageHandlers.forEach(h => h(msg))
      } catch { /* malformed frame */ }
    }

    this.ws.onclose = () => {
      this.closeHandlers.forEach(h => h())
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      this.ws?.close()
    }
  }

  private scheduleReconnect(): void {
    setTimeout(() => this.open(), this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
  }

  send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(this.encoder.encode(data))
    }
  }

  onOpen(handler: () => void): void    { this.openHandlers.push(handler) }
  onMessage(handler: (d: unknown) => void): void { this.messageHandlers.push(handler) }
  onClose(handler: () => void): void   { this.closeHandlers.push(handler) }
}
