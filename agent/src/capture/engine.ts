import type { AgentModuleConfig } from '../runtime/loader.js'

type EventSender = (
  moduleId: string,
  eventType: string,
  payload: unknown,
  persist: boolean,
) => void

// Deserialize a function string back into a callable (same helper as loader)
function deserializeFn(src: string): (...args: unknown[]) => unknown {
  // eslint-disable-next-line no-new-func
  return new Function(`return (${src})`)() as (...args: unknown[]) => unknown
}

function throttle<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let last = 0
  return ((...args: unknown[]) => {
    const now = Date.now()
    if (now - last >= ms) { last = now; fn(...args) }
  }) as T
}

// Holds cleanup handles so capture can be torn down on session end
interface Cleanup {
  type: 'listener' | 'interval' | 'patch'
  fn: () => void
}

export class CaptureEngine {
  private cleanups: Cleanup[] = []

  start(modules: AgentModuleConfig[], send: EventSender): void {
    for (const mod of modules) {
      this.wireEvents(mod, send)
      this.wireHooks(mod, send)
      this.wirePolls(mod, send)
    }
  }

  private wireEvents(mod: AgentModuleConfig, send: EventSender): void {
    for (const spec of mod.capture.events ?? []) {
      const payloadFn = deserializeFn(spec.payload) as (e: Event) => unknown

      let handler: (e: Event) => void = (e: Event) => {
        try {
          const payload = payloadFn(e)
          send(mod.id, spec.event, payload, spec.persist)
        } catch { /* skip bad frame */ }
      }

      if (spec.throttle) {
        handler = throttle(handler, spec.throttle)
      }

      window.addEventListener(spec.event, handler, { passive: true })
      this.cleanups.push({ type: 'listener', fn: () => window.removeEventListener(spec.event, handler) })
    }
  }

  private wireHooks(mod: AgentModuleConfig, send: EventSender): void {
    for (const spec of mod.capture.hooks ?? []) {
      try {
        const parts = spec.target.split('.')  // e.g. ['XMLHttpRequest', 'prototype', 'open']
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let obj: any = window
        for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]]
        const prop    = parts[parts.length - 1]
        const original = obj[prop]
        const handlerFn = deserializeFn(spec.handler)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        obj[prop] = function (...args: any[]) {
          try {
            const payload = handlerFn(...args)
            send(mod.id, spec.target, payload, spec.persist)
          } catch { /* noop */ }
          return original.apply(this, args)
        }

        this.cleanups.push({ type: 'patch', fn: () => { obj[prop] = original } })
      } catch {
        console.warn(`[wraith] failed to wire hook "${spec.target}" in ${mod.id}`)
      }
    }
  }

  private wirePolls(mod: AgentModuleConfig, send: EventSender): void {
    for (const spec of mod.capture.poll ?? []) {
      const collectFn = deserializeFn(spec.collect)

      const id = setInterval(() => {
        try {
          const payload = collectFn()
          send(mod.id, spec.id, payload, spec.persist)
        } catch { /* skip */ }
      }, spec.interval)

      this.cleanups.push({ type: 'interval', fn: () => clearInterval(id) })
    }
  }

  stop(): void {
    this.cleanups.forEach(c => c.fn())
    this.cleanups = []
  }
}
