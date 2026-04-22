import { WebSocket, WebSocketServer } from 'ws'
import type { C2Transport, AgentMessage, ServerMessage, Encoder } from '@wraith/types'
import { nanoid } from 'nanoid'

export class WebSocketC2Transport implements C2Transport {
  private wss: WebSocketServer | null = null
  private sockets = new Map<string, WebSocket>()
  private encoder: Encoder

  private msgHandlers:        Array<(id: string, msg: AgentMessage) => void> = []
  private connectHandlers:    Array<(id: string) => void> = []
  private disconnectHandlers: Array<(id: string) => void> = []

  constructor(encoder: Encoder) {
    this.encoder = encoder
  }

  async listen(port: number): Promise<void> {
    this.wss = new WebSocketServer({ port })

    this.wss.on('connection', (ws: WebSocket) => {
      const connectionId = nanoid()
      this.sockets.set(connectionId, ws)
      this.connectHandlers.forEach(h => h(connectionId))

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = this.encoder.decode<AgentMessage>(raw)
          this.msgHandlers.forEach(h => h(connectionId, msg))
        } catch {
          // malformed frame — silently drop
        }
      })

      ws.on('close', () => {
        this.sockets.delete(connectionId)
        this.disconnectHandlers.forEach(h => h(connectionId))
      })

      ws.on('error', (err: Error) => {
        console.error(`[ws:agent] socket error ${connectionId}:`, err.message)
      })
    })

    return new Promise((resolve) => this.wss!.once('listening', resolve))
  }

  send(connectionId: string, message: ServerMessage): void {
    const ws = this.sockets.get(connectionId)
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(this.encoder.encode(message))
  }

  broadcast(message: ServerMessage): void {
    const encoded = this.encoder.encode(message)
    this.sockets.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encoded)
    })
  }

  onAgentMessage(handler: (id: string, msg: AgentMessage) => void): void {
    this.msgHandlers.push(handler)
  }

  onAgentConnect(handler: (id: string) => void): void {
    this.connectHandlers.push(handler)
  }

  onAgentDisconnect(handler: (id: string) => void): void {
    this.disconnectHandlers.push(handler)
  }

  async close(): Promise<void> {
    this.wss?.close()
  }
}
