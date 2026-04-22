import type { ModuleRuntime } from '../runtime/loader.js'

interface CommandMessage {
  commandId:  string
  moduleId:   string
  commandDef: string
  params:     Record<string, unknown>
}

type ResultSender = (commandId: string, result: unknown, error?: string) => void

export class CommandHandler {
  constructor(
    private runtime: ModuleRuntime,
    private send: ResultSender,
  ) {}

  handle(msg: CommandMessage): void {
    try {
      const result = this.runtime.execCommand(msg.moduleId, msg.commandDef, msg.params)
      this.send(msg.commandId, result)
    } catch (e) {
      this.send(msg.commandId, undefined, (e as Error).message ?? String(e))
    }
  }
}
