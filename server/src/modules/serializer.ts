import type { WraithModule, SerializedAgentModule } from '@wraith/types'

export function serializeForAgent(mod: WraithModule): SerializedAgentModule {
  const resolvedConfig = Object.fromEntries(
    Object.entries(mod.config ?? {}).map(([k, field]) => [k, field.default])
  )

  return {
    id: mod.id,
    config: resolvedConfig,
    setup: mod.agent?.setup.toString(),
    capture: {
      init: mod.capture?.init?.map(c => ({
        key:     c.key,
        persist: c.persist,
        collect: c.collect.toString(),
      })),
      events: mod.capture?.events?.map(e => ({
        event:    e.event,
        throttle: e.throttle,
        persist:  e.persist,
        payload:  e.payload.toString(),
      })),
      hooks: mod.capture?.hooks?.map(h => ({
        target:  h.target,
        persist: h.persist,
        handler: h.handler.toString(),
      })),
      poll: mod.capture?.poll?.map(p => ({
        id:       p.id,
        interval: p.interval,
        persist:  p.persist,
        collect:  p.collect.toString(),
      })),
    },
    commands: (mod.commands ?? []).map(c => ({
      id:      c.id,
      label:   c.label,
      params:  c.params,
      handler: c.handler.toString(),
    })),
  }
}
