# Wraith Module Authoring Guide

A Wraith module is a single `.jsx` file (ESM) that exports a default object conforming to the
`WraithModule` interface (`@wraith/types`). The framework owns transport, encoding, session
management, and UI chrome. Modules own capability.

Existing modules to reference: `modules/wraith-cursor/`, `modules/wraith-utils/`, `modules/wraith-keylog/`.

---

## Minimal module skeleton

```jsx
import { Panel, StatCard } from '@framework/ui'

export default {
  id:          'my-module',
  name:        'My Module',
  version:     '1.0.0',
  author:      'your-handle',
  date:        '2026-04-19',
  description: 'What this module does.',

  capture: {
    events: [
      {
        event:   'click',
        persist: true,
        payload: e => ({ x: Math.round(e.clientX), y: Math.round(e.clientY), t: Date.now() }),
      },
    ],
  },

  live: (state = { count: 0 }, event) => {
    if (event.type === 'click') return { ...state, count: state.count + 1 }
    return state
  },

  ui: {
    nav:   { label: 'My Module', icon: 'activity' },
    panel: ({ live }) => (
      <Panel title="My Module">
        <StatCard label="Clicks" value={live.count ?? 0} />
      </Panel>
    ),
    view: ({ data, session, sendCommand }) => (
      <div>…</div>
    ),
  },
}
```

---

## Identity fields

```js
id:          'my-module',      // unique, kebab-case — throws on duplicate at server startup
name:        'My Module',      // display name in the UI
version:     '1.0.0',
author:      'your-handle',    // shown on the /modules page
date:        '2026-04-19',     // release date — shown on the /modules page
description: 'What it does.',
permissions: ['keylogging'],   // declared intent — not enforced by the framework
```

---

## Capture

Declarative capture spec. The framework wires all listeners. **Capture functions are serialized
to strings by the server (`fn.toString()`) and reconstructed in the agent's browser context
(`new Function(...)`). They must be self-contained closures — no external variables, no imports.**

### `capture.init` — one-shot collectors (synchronous only)

Run once at session start. `collect()` is called synchronously — no `await`. Results are sent
as `init_data` messages and stored in SQLite if `persist: true`.

```js
capture: {
  init: [
    {
      key:     'screen',
      persist: true,
      collect: () => ({
        width:  window.screen.width,
        height: window.screen.height,
      }),
    },
  ],
}
```

`init_data` reloads when the operator navigates to a session — it does **not** re-run when the
operator refreshes the admin UI. To pick up new init collectors, the target page must reconnect.

### `capture.events` — DOM event listeners on `window`

```js
capture: {
  events: [
    {
      event:    'mousemove',
      throttle: 50,          // optional, ms
      persist:  true,
      payload:  e => ({ x: Math.round(e.clientX), y: Math.round(e.clientY), t: Date.now() }),
    },
    {
      event:   'keydown',
      persist: true,
      payload: e => ({ key: e.key, code: e.code, t: Date.now() }),
    },
  ],
}
```

Use `Math.round` on coordinates — `clientX/Y` return sub-pixel floats in some browsers.

Use `pointerdown` instead of `click` when you need all mouse buttons — `click` doesn't fire
for right/middle buttons in Chrome.

If a key-press navigates focus out of the page (e.g. Tab → browser chrome), `keyup` never
fires. Add a `blur` event capture with `persist: false` and handle it in `live` to clear
pressed-key state.

### `capture.hooks` — prototype / API patches

`target` is a dot-separated property path from `window`.

```js
capture: {
  hooks: [
    {
      target:  'XMLHttpRequest.prototype.open',
      persist: true,
      handler: (method, url) => ({ method, url: String(url), t: Date.now() }),
    },
  ],
}
```

### `capture.poll` — interval collectors

```js
capture: {
  poll: [
    {
      id:       'devtools',
      interval: 1000,
      persist:  false,
      collect:  () => ({ open: window.outerWidth - window.innerWidth > 160 }),
    },
  ],
}
```

---

## `persist` flag

| Value | Storage | Visible in |
|---|---|---|
| `true` | Written to SQLite | `data.events` / `data.initData` in view |
| `false` | WS broadcast only, never on disk | `live` state via reducer only |

High-frequency events (mousemove): use `persist: true` with throttle for historical data, or
`persist: false` for live-only (cursor position) without storage cost.

---

## `live` reducer

Runs in **both** the admin UI (for real-time panel) and the server (for lifecycle hooks). Must
be a pure function.

```js
live: (state = { count: 0 }, event) => {
  if (event.type === 'click') return { ...state, count: state.count + 1 }
  return state
},
```

Receives `undefined` on first call — the default parameter handles initialization. If TypeScript
infers a too-narrow type from the default value, use `state ?? initialValue` in the body instead:

```js
live: (state, event) => {
  const s = state ?? { count: 0, items: [] }
  if (event.type === 'click') return { ...s, count: s.count + 1 }
  return s
},
```

The `event` argument shape:
```js
{
  type:      string,    // DOM event name or 'init_data'
  payload:   unknown,   // whatever your payload/collect fn returned
  moduleId:  string,
  sessionId: string,
  timestamp: number,    // ms since epoch
}
```

---

## Commands

Operations the operator can push to connected agents. `handler` runs in the **agent's browser
context** (same serialization rules as capture functions — self-contained).

```js
commands: [
  {
    id:      'dom:clear',
    label:   'Clear page DOM',
    params:  {},
    handler: () => { document.body.innerHTML = '' },
  },
  {
    id:      'js:inject',
    label:   'Execute JavaScript',
    params:  { code: 'string' },
    handler: (params) => eval(params.code), // eslint-disable-line no-eval
  },
]
```

In the UI, trigger with `sendCommand(commandId, params)` from panel or view.

---

## UI components (`@framework/ui`)

| Component | Key props | Purpose |
|---|---|---|
| `Panel` | `title`, `children` | titled section wrapper for the live panel |
| `StatCard` | `label`, `value`, `alert?` | single metric tile |
| `DataTable` | `title`, `rows`, `columns` | columnar data display |
| `EventFeed` | `title`, `events` | live event log |
| `Button` | `label`, `onClick`, `variant?`, `disabled?` | action button (`default`\|`danger`\|`ghost`) |
| `HeatmapView` | `points`, `clicks?`, `screenSize?`, `cursorPos?`, `pointRadius?` | canvas heatmap with replay, zoom, drag overlays |

Nav icon names (from `lucide-react` via ICON_MAP in `SessionDetail.tsx`):
`cursor`, `key`, `network`, `eye`, `terminal`, `wifi`, `disk`, `cpu`, `globe`, `lock`,
`camera`, `mic`, `location`, `file`, `activity`

React hooks (`useState`, `useEffect`, `useRef`, `useMemo`) work inside `panel` and `view`
because the framework renders them as JSX components. Import explicitly from `'react'`.

---

## What panel and view receive

**Panel** — `{ live, session, sendCommand }`

`live` is whatever the `live` reducer last returned. Starts as `{}` before the first event.

**View** — `{ data, session, sendCommand }`

```js
data.events   // StoredEvent[]    — this module's events, filtered by moduleId
data.initData // StoredInitData[] — this module's init data
data.commands // StoredCommand[]  — command history with results

// StoredEvent:   { moduleId, type, payload, timestamp, persist }
// StoredInitData: { moduleId, key, value }
// StoredCommand:  { id, moduleId, commandDefId, params, status, result?, error?, createdAt, completedAt? }
```

Filter events by type yourself:
```js
const clicks = data.events.filter(e => e.type === 'pointerdown').map(e => e.payload)
```

**`transform` is not called.** The view always receives raw events and init data. Do your own
aggregation inside the view component.

**Session:**
```js
session.id                 // nanoid
session.meta.url           // page URL at connection time
session.meta.userAgent
session.meta.referrer
session.meta.connectedAt   // ms timestamp
session.status             // 'active' | 'dead'
session.lastSeenAt         // ms timestamp
// session.meta.ip is always undefined — server does not extract it
```

---

## Server-side lifecycle hooks

Called by `SessionManager`. All optional.

```js
lifecycle: {
  onSessionStart: (session) => { /* agent connected */ },
  onSessionEnd:   (session) => { /* agent disconnected */ },
  onEvent: {
    types:   new Set(['click']),   // must be Set, not array
    handler: (event, session) => { /* react to specific events server-side */ },
  },
},
```

---

## `agent.setup`

Runs once on the hooked page before capture begins. No access to `send`. Use only to
initialize global state that capture functions will read.

```js
agent: {
  setup: () => {
    window.__myModule = { buffer: [] }
  },
},
```

Most modules don't need this.

---

## Registration (two files)

**`server/src/index.ts`**
```ts
import myModule from '../../modules/my-module/index.jsx'
registry.register(myModule)
```

**`ui/src/main.tsx`** — add to the existing loop array:
```ts
import myModule from '../../modules/my-module/index.jsx'

for (const mod of [wraithCursor, wraithUtils, wraithKeylog, myModule]) {
  registerModuleUI({
    id:          mod.id,
    name:        mod.name,
    version:     mod.version,
    description: mod.description,
    author:      mod.author,
    date:        mod.date,
    nav:         mod.ui.nav,
    panel:       mod.ui.panel,
    view:        mod.ui.view,
  })
  registerModuleReducer(mod.id, mod.live)
}
```

If your module uses a new `@framework/ui` component, also add a `null` stub to both:
- `framework-ui/index.js` — Node.js runtime stub (prevents crash on server import)
- `server/src/stubs/framework-ui.ts` — TypeScript type stub (prevents TS error)

Rebuild the agent bundle if any `capture` functions changed:
```bash
pnpm --filter agent build
```

---

## Common pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| Capture function crashes with ReferenceError | closed over an external variable | make it fully self-contained |
| `capture.init` data missing after admin UI refresh | init runs once at agent connect, not on UI reload | target page must reconnect to re-collect |
| `collect()` never resolves | async collect function | `collect` must be synchronous; use `capture.poll` for async data |
| Key shows as held down indefinitely | keyup missed when Tab moves focus to browser chrome | add `blur` event capture (`persist: false`) and clear pressed keys in `live` |
| `onEvent.types.has is not a function` | `types` declared as array literal | use `new Set(['eventname'])` |
| `mod.config` undefined on server | module file imported as CJS | file must be `.jsx` (not `.js`); `modules/package.json` must have `"type": "module"` |
| NaN in stat cards | live reducer receives `{}` instead of `undefined` | never let the framework pass `?? {}` — module owns initial state |
| Coordinates have many decimal places | `clientX/Y` return sub-pixel floats | wrap with `Math.round()` in the payload function |
