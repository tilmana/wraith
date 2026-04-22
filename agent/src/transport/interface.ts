export interface AgentTransport {
  connect(url: string): void
  send(data: unknown): void
  onOpen(handler: () => void): void
  onMessage(handler: (data: unknown) => void): void
  onClose(handler: () => void): void
}
