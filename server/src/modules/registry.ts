import type { WraithModule, SerializedAgentModule } from '@wraith/types'
import { serializeForAgent } from './serializer.js'

export class ModuleRegistry {
  private modules = new Map<string, WraithModule>()
  private serialized = new Map<string, SerializedAgentModule>()

  register(mod: WraithModule): void {
    if (this.modules.has(mod.id)) {
      throw new Error(`[registry] module "${mod.id}" already registered`)
    }
    this.modules.set(mod.id, mod)
    this.serialized.set(mod.id, serializeForAgent(mod))
    console.log(`[registry] registered module: ${mod.id} v${mod.version}`)
  }

  get(id: string): WraithModule | undefined {
    return this.modules.get(id)
  }

  all(): WraithModule[] {
    return Array.from(this.modules.values())
  }

  allSerialized(): SerializedAgentModule[] {
    return Array.from(this.serialized.values())
  }

  getSerialized(id: string): SerializedAgentModule | undefined {
    return this.serialized.get(id)
  }
}

export const registry = new ModuleRegistry()
