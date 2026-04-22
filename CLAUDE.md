# Wraith — Claude Code Working Guide

Educational browser hook C2 framework, inspired by BeEF. Built as a GitHub portfolio project
for a security engineer. Strictly for authorized security research and education.

---

## Repository layout

```
wraith/
├── types/          @wraith/types        — shared TypeScript contracts, no runtime deps
├── server/         @wraith/server       — Fastify HTTP + admin WS + agent WS (port 3001)
├── agent/          @wraith/agent        — IIFE bundle injected into target pages (~4 KB)
├── ui/             @wraith/ui           — React 18 admin dashboard (Vite, port 5173)
├── framework-ui/   @framework/ui        — server-side NULL STUBS for React components
├── modules/        @wraith/modules      — capability modules (JSX, ESM)
├── docs/           module-spec.md       — module authoring reference
└── CLAUDE.md       ← this file
```

`pnpm dev` runs server + ui concurrently. Agent must be built separately with
`pnpm --filter agent build` (or `build:agent` from root) whenever agent-side code changes.

---

## Architecture: who owns what

| Concern | Owner |
|---|---|
| WebSocket transport, encoding, session management, SQLite | **Framework (server)** |
| React admin UI chrome, routing, WebSocket fan-out | **Framework (ui)** |
| What to capture, how to reduce live state, what commands to expose | **Module** |
| UI panel (live) and view (historical) components | **Module** |

Modules are **transport-agnostic and encoding-agnostic**. They declare capability; the framework
wires everything.

---

## The dual-context module problem

Modules live in e.g. `modules/wraith-cursor/index.jsx` and are imported by **both**:

- **Server** (`server/src/index.ts`) — needs `capture`, `live`, `lifecycle`
- **Browser UI** (`ui/src/main.tsx`) — needs `ui.panel`, `ui.view`, `ui.nav`

`@framework/ui` resolves differently in each:
- **Vite (browser):** alias → `ui/src/framework/ui/index.ts` (real React components)
- **Node.js (server):** workspace package → `framework-ui/index.js` (all exports = `null`)

This is why `framework-ui/` exists as a real pnpm workspace package. Do not remove it.

Module files must be `.jsx` (not `.js`) and `modules/package.json` must have `"type": "module"`.
Without this, Node.js wraps the default export in `{ default: [Getter] }` and `mod.config`
becomes undefined.

---

## Agent bundle

`agent/dist/hook.js` — minified IIFE injected via `<script>` tag into target pages.

**Rebuild required** whenever anything in `agent/src/` changes OR when a module's
`capture` functions change (they are serialized and embedded at server startup, not in the bundle,
but the agent runtime must support any new capture features).

Build: `pnpm --filter agent build`
Watch: `pnpm --filter agent build -- --watch`

C2 URL is baked in at build time via esbuild `define`:
- Default: `ws://localhost:3001`
- Override: `C2_URL=wss://example.com pnpm build:agent`

**Singleton guard:** the IIFE checks `window.__wraith__` on entry and exits immediately if
already set. This prevents double-injection.

---

## Module function serialization

The server cannot send JavaScript to the agent as objects. Instead:

1. **Server startup:** `serializer.ts` calls `fn.toString()` on every capture function
2. **Agent session start:** agent runtime calls `new Function('return (' + src + ')()')` to
   reconstruct the function

**Constraint:** capture functions (`collect`, `payload`, `handler`) must be **self-contained
closures** — they cannot close over variables defined outside their own body. They run in the
agent's browser context, not Node.js.

---

## Ports and proxying

| Port | Service |
|---|---|
| 3000 | HTTP API + admin WebSocket (`/ws/admin`) |
| 3001 | Agent WebSocket (C2 channel, separate from HTTP) |
| 5173 | Vite dev server (proxies `/api` and `/ws/admin` to 3000) |

The UI dev server proxies `/api` and `/ws/admin` to port 3000. In production, everything
serves from port 3000 (static files from `agent/dist` are served by Fastify).

---

## Database

SQLite via `better-sqlite3` (requires Node.js native build). Schema auto-created on first run.

Tables: `sessions`, `events`, `init_data`, `commands`

`events.persist = 1` means the event should survive session expiry (e.g. mousemove, click).
`events.persist = 0` means ephemeral / real-time only.

`init_data` has a UNIQUE constraint on `(session_id, module_id, key)` — upsert semantics.

DB path: `server/wraith.sqlite` (relative to server build output). Override with `DB_PATH` env var.

---

## Admin WebSocket real-time flow

```
Agent page → [ws:3001] → SessionManager → broadcastAdmin() → [ws/admin] → Zustand store → React
```

`routes.ts` maintains `adminClients: Set<socket>` inside the `registerRoutes` closure (not module-level).
`registerRoutes` returns the `broadcastAdmin` function; `server.ts` uses a deferred wrapper so
`SessionManager` can be constructed before routes are registered without a circular dependency:

```typescript
let broadcast: (msg: AdminMessage) => void = () => {}
const sessions = new SessionManager(transport, msg => broadcast(msg), registry)
broadcast = await registerRoutes(app, sessions)
```

**StrictMode double-connection fix:** `useWraithConnection` uses `activeRef` + stale-WS check
(`wsRef.current !== ws`) in the `onclose` handler to prevent React StrictMode's cleanup from
spawning a third WebSocket connection. Do not remove these guards.

**Session delete endpoints** (in `routes.ts`):
- `DELETE /api/sessions/:id` — deletes a single session and all its events/init_data/commands
- `DELETE /api/sessions/dead` — bulk deletes all sessions with `status = 'dead'`

Both use pre-compiled prepared statements. The store actions `deleteSession(id)` and
`deleteDeadSessions()` call these and update the Zustand map. `SessionList.tsx` exposes
a per-row trash icon (hover reveal) and a "Clear dead" bulk button.

---

## Store: live state vs event history

The Zustand store (`ui/src/store/index.ts`) separates two data paths:

| Path | Source | Updated by |
|---|---|---|
| `ss.live` | WS events → `live` reducer | `applyAdminMessage` |
| `ss.events` | WS append + REST replace | `applyAdminMessage` + `loadSessionEvents` |
| `ss.initData` | WS + REST | `applyAdminMessage` + `loadSessionInitData` |
| `ss.commands` | WS result + REST load + optimistic pending | `applyAdminMessage` + `loadSessionCommands` + `addPendingCommand` |

`sessions` is stored as `Map<string, Session>` — O(1) lookup by ID. `useSessions()` returns
a sorted array (by `lastSeenAt` desc) via `useShallow` to prevent unnecessary re-renders.
`useSession(id)` subscribes to a single session and only re-renders when that session changes.

`loadSessionEvents` **merges** REST and in-flight WS events — REST is authoritative history,
but any persisted WS events with timestamps strictly greater than the max REST event timestamp
(per module) are kept to avoid losing events that arrived during the fetch. `loadSessionCommands`
fully replaces (REST is authoritative for commands).

`SessionState` objects always get new references on update (immutable pattern). This means
`useSessionState(id)` correctly detects changes without subscribing to unrelated sessions.

The `live` reducer receives `undefined` on first call — use a default parameter or `?? initialValue`
in the body to handle initialization. Never let the framework caller pass `?? {}` — the module
owns its own initial state shape. If TypeScript infers a too-narrow state type from a default
parameter, use `state ?? initialValue` in the body with a permissive type annotation instead.

---

## Environment variables

| Variable | Default | Where used |
|---|---|---|
| `HTTP_PORT` | `3000` | server — HTTP API + admin WS |
| `AGENT_WS_PORT` | `3001` | server — agent C2 WebSocket |
| `DB_PATH` | `server/wraith.sqlite` | server — SQLite file path |
| `ADMIN_TOKEN` | `""` | server — guards `/api/*` and `/ws/admin`; empty = no auth |
| `C2_URL` | `ws://localhost:3001` | agent build — baked in at compile time |
| `SESSION_KEY` | `""` | agent build — baked in, wired but not yet enforced |

`C2_URL` and `SESSION_KEY` are compile-time constants (esbuild `define`). Changing them requires
rebuilding the agent bundle.

---

## Tailwind theme

Custom tokens defined in `ui/tailwind.config.ts`. Use these instead of hardcoded hex values:

| Token | Value | Usage |
|---|---|---|
| `surface` | `#0f0f17` | page / sidebar background |
| `panel` | `#16161f` | card / header background |
| `border` | `#252535` | all dividers and borders |
| `accent` | `#7c3aed` | purple — active state, highlights |
| `accent-dim` | `#4c1d95` | darker purple — hover states |
| `muted` | `#4b5563` | secondary / placeholder text |

In Tailwind classes: `bg-surface`, `bg-panel`, `border-border`, `text-muted`, `text-accent`,
`border-accent`, `accent-accent` (for `input[type=range]` thumb color).

Click marker colors are hardcoded RGB (not Tailwind) because they appear inside canvas and
inline styles: left=`255,255,255`, middle=`0,210,255`, right=`255,140,0`.

---

## `live` reducer runs in two places

The module's `live` function is called by **both**:

1. **Server** (`sessions/manager.ts`) — maintains in-memory live state per session, used by
   `GET /api/sessions/:id/live`. Lets server-side `lifecycle.onEvent` handlers react to current state.

2. **Client UI** (`ui/src/store/index.ts` via `applyAdminMessage`) — drives the real-time panel
   (`live` prop). This is the one users see updating in the sidebar.

Both run the same function with the same inputs. They are independent — the server's copy is
never sent to the UI. The UI rebuilds live state from scratch by replaying WS events through
the reducer.

---

## `transform` is optional and currently unused

`WraithModule.transform` is an optional field. `SessionDetail.tsx` passes **raw** `StoredEvent[]`
and `StoredInitData[]` directly to the view component — it does not call `transform`. Module
views must do their own filtering:

```js
// In view({ data }):
const clicks = data.events?.filter(e => e.type === 'pointerdown').map(e => e.payload) ?? []
```

Do not assume the view receives pre-processed data. Do not define `transform` in a module unless
you have a specific use for it.

---

## Panel and view are React components, not plain functions

In `SessionDetail.tsx`, module UI is rendered as JSX:

```tsx
<activeUI.panel live={liveState} session={session} sendCommand={doSendCommand} />
<activeUI.view  data={{ events: allEvents, initData: allInitData, commands: allCommands }} session={session} sendCommand={doSendCommand} />
```

React treats these as components (via `React.createElement`), which means **hooks work inside
them**. You can use `useState`, `useEffect`, `useRef`, etc. in your module's `panel` and `view`
functions. They must be imported explicitly from `'react'` since module files don't have the
same auto-import setup as the UI package.

---

## `e.button` vs `e.buttons` — don't confuse them

Two different `MouseEvent` properties with opposite index conventions:

| Property | Event types | Values |
|---|---|---|
| `e.button` | `pointerdown`, `click`, `auxclick` | 0=left, 1=middle, 2=right |
| `e.buttons` | `pointermove`, `mousemove` | bitmask: 1=left, 2=right, 4=middle |

`e.buttons` is a bitmask (multiple buttons can be held simultaneously).
`e.button` is a single value identifying which button triggered the event.

wraith-cursor captures `e.button` on `pointerdown` events and `e.buttons` on `mousemove`
events. `HeatPoint.buttons` stores the bitmask for drag detection; `HeatClick.button` stores
the singular value for click identification.

---

## Two stub file locations — why both exist

When adding a new `@framework/ui` component, update **both**:

- **`framework-ui/index.js`** — Node.js runtime stubs. When the server `import`s a module file,
  Node resolves `@framework/ui` to this package. Must export the new name as `null`.

- **`server/src/stubs/framework-ui.ts`** — TypeScript type stubs. The server's `tsconfig.json`
  has `allowJs: true` so it type-checks module files. This file provides typed `null` exports
  so the type checker doesn't complain about unknown imports.

Both must be kept in sync. Missing from `framework-ui/index.js` = runtime crash on server start.
Missing from `server/src/stubs/framework-ui.ts` = TypeScript error when building server.

---

## `SessionManager` constructor

`SessionManager` takes three injected dependencies — do not add a fourth without justification:

```typescript
new SessionManager(transport, broadcastAdmin, registry)
```

DB access throughout the server uses `getDb()` (imported from `db/index.ts`), not an
`app.sqlite` decoration. All new server code should call `getDb()` directly.

**Prepared statements** are pre-compiled once in the constructor (`this.stmt.*`) and reused
for every DB operation. Do not call `db.prepare(...)` inside any handler method — add a new
`stmt` field instead. This avoids SQL re-parsing on every high-frequency event.

**Session cache** (`this.sessionCache`) holds in-memory `Session` objects for all active
sessions. Populated in `handleHandshake`, cleared in `onDisconnect`. Use it instead of
`getSession()` in hot paths (e.g. `onEvent` lifecycle hooks). `getSession()` falls back to
the DB for dead sessions that have been evicted from the cache.

**`activeSessions`** is only populated after a successful handshake (not on raw TCP connect).
Pre-handshake sockets exist in the transport's socket map but are invisible to the manager
until `handleHandshake` runs.

**Startup sweep:** The constructor runs `UPDATE sessions SET status = 'dead' WHERE status = 'active'`
immediately on boot. Marks sessions that were active when the server last shut down as dead —
their WebSocket connections no longer exist after a restart.

---

## Module registration (automatic)

Modules are auto-discovered — no manual registration required. Drop a module directory
into `modules/` with an `index.jsx` default export and restart `pnpm dev`.

- **Server:** `server/src/modules/discover.ts` scans `modules/*/index.jsx` at startup
  via dynamic `import()`. Modules are registered in alphabetical directory order.
- **UI:** `ui/src/main.tsx` uses `import.meta.glob('../../modules/*/index.jsx', { eager: true })`
  to discover and register modules at build time.

Adding a new module:
```bash
git clone https://github.com/someone/wraith-my-module modules/wraith-my-module
pnpm install   # resolves @framework/ui via workspace
pnpm dev       # restart required — discovery runs at startup, not hot-reload
```

If you create a new `@framework/ui` component, add the null stub to both
`framework-ui/index.js` and `server/src/stubs/framework-ui.ts`.

`ModuleUI` is the interface stored in `SessionDetail.tsx` (exported as `getModuleUIs()`).
It includes `id`, `name`, `version`, `description`, `author`, `date`, `nav`, `panel`, `view`.
The `/modules` route (`ui/src/views/Modules.tsx`) reads this to render the module detail —
selected from the sidebar dropdown.

---

## Framework UI components (`@framework/ui`)

Exported from `ui/src/framework/ui/index.ts`. Available in module JSX files.

| Component | Purpose |
|---|---|
| `Panel` | titled section wrapper for the live panel |
| `StatCard` | single metric display |
| `DataTable` | columnar data display |
| `EventFeed` | live event log |
| `Button` | action button with variants |
| `HeatmapView` | canvas heatmap with zoom, auto-scale, path/drag overlays, replay cursor |

Module tabs render `nav.icon` using `lucide-react`. Supported icon names: `cursor`, `key`,
`network`, `eye`, `terminal`, `wifi`, `disk`, `cpu`, `globe`, `lock`, `camera`, `mic`,
`location`, `file`, `activity`. Unknown names render nothing — add to `ICON_MAP` in
`SessionDetail.tsx` to extend.

`HeatmapView` props: `points: HeatPoint[]`, `clicks?: HeatClick[]`, `screenSize?`, `cursorPos?`,
`pointRadius?`. HeatClick uses `button` field (0=left, 1=middle, 2=right). HeatPoint has
optional `buttons` (e.buttons bitmask) for drag detection. Internal controls: path, drags,
auto-scale, recalibrate, zoom slider. All display concerns live inside HeatmapView; data
concerns (replay, filtering, CSV export) live in the module's view.

---

## What views and panels receive

**Panel** props: `{ live, session, sendCommand }`
**View** props: `{ data, session, sendCommand }`

### `live`
The current live state object for that module — whatever the `live` reducer last returned.
Initially `{}` until the first event arrives.

### `data`
```js
data.events   // StoredEvent[]   — already filtered to this module's events only
data.initData // StoredInitData[] — already filtered to this module's init data only
data.commands // StoredCommand[]  — command history for this module, with results
```

`StoredEvent` shape: `{ moduleId, type, payload, timestamp, persist }`
`StoredInitData` shape: `{ moduleId, key, value }`
`StoredCommand` shape: `{ id, moduleId, commandDefId, params, status, result?, error?, createdAt, completedAt? }`

Events are pre-filtered by `moduleId` — you only see your own module's events. Filter further
by `type` to separate event kinds:
```js
const clicks = data.events.filter(e => e.type === 'pointerdown').map(e => e.payload)
```

`data.commands` is populated from REST on navigation and updated live via WS as commands
complete. `status` is `'pending' | 'done' | 'error'`. Commands are all of this module's
commands across the session's lifetime.

REST: `GET /api/sessions/:id/commands` (all commands for a session, all modules).

### `session`
```js
session.id              // nanoid session identifier
session.meta.url        // page URL at connection time
session.meta.userAgent  // browser user agent string
session.meta.referrer   // document.referrer at connection time
session.meta.connectedAt // timestamp (ms)
session.status          // 'active' | 'dead'
session.lastSeenAt      // timestamp of last ping (ms)
```

**`session.meta.ip` is always undefined** — it's in the `SessionMeta` type but the server
does not extract the IP from the WebSocket connection. Do not rely on it.

### `sendCommand`
```js
sendCommand(commandId: string, params?: Record<string, unknown>)
// Example:
sendCommand('js:inject', { code: 'alert(1)' })
```

---

## `persist` flag on events and init data

Every captured event and init collector has a `persist` field:

- `persist: true` — written to SQLite. Survives page refresh of the admin UI, session
  reconnects, and server restarts. Appears in `data.events` / `data.initData` in the view.
- `persist: false` — broadcast live over WS only, never written to disk. Appears in `live`
  state (via the reducer) but NOT in `data.events`. Use for high-frequency or ephemeral data.

```js
{ event: 'mousemove', throttle: 50, persist: true,  payload: e => ({...}) } // stored
{ event: 'mousemove', throttle: 50, persist: false, payload: e => ({...}) } // live only
```

---

## `capture.init` collectors are synchronous

`runInit` in the agent calls `collector.collect()` with no `await`. Async collect functions are
not supported — the result is used immediately. If you need async data, use `capture.poll` with
a short interval instead.

---

## Admin auth (`ADMIN_TOKEN`)

When `ADMIN_TOKEN` is set:

- All `/api/*` routes require `Authorization: Bearer <token>` (Fastify `onRequest` hook).
- `/ws/admin` requires `?token=<token>` query param; auth failures close with code `4401`.
- The UI stores the token in `sessionStorage` (`wraith_token` key) via `ui/src/api.ts`.
- `apiFetch()` in `ui/src/api.ts` automatically injects the auth header. Use it instead of
  raw `fetch()` for all API calls in the UI.
- WS close code `4401` = auth failure — the UI shows a token prompt and does not reconnect.
- When `ADMIN_TOKEN` is empty (default), no auth is enforced.

---

## `agent.setup` cannot send events

`agent` is an optional module field. If present, `agent.setup` runs once before capture starts.
It does **not** have access to the `send` function. Use it only to initialize global state
(e.g. `window.__myModule = {}`). Most modules don't need it.

To emit data, use `capture.init` (one-shot at session start) or `capture.events`/`poll`
(ongoing). These are wired by the capture engine which has access to `send`.

---

## Writing a new module

1. Create `modules/my-module/index.jsx` following `docs/module-spec.md`
2. Add a `package.json` with `"type": "module"` and `"@framework/ui": "workspace:*"`
3. Use `import { useState, useEffect, useRef } from 'react'` for hooks in the view
4. Import UI components from `@framework/ui`
5. Capture functions must be self-contained (no external closure variables)
6. `live` reducer signature: `(state = defaultValue, event) => newState` — undefined first arg
   is intentional; the default parameter handles initialization
7. Run `pnpm install` then `pnpm dev` — registration is automatic (see above)
8. If the module uses a new `@framework/ui` component, add `null` stub to `framework-ui/index.js`
   AND `server/src/stubs/framework-ui.ts`
9. `pnpm --filter agent build` only needed if capture functions changed

**Optional fields:** `config`, `commands`, `capture`, `permissions`, `agent`, `transform`,
`lifecycle` are all optional. Only include what the module actually needs.

---

## Known pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `mod.config` is undefined on server | module file treated as CJS | ensure `modules/package.json` has `"type": "module"` and file is `.jsx` |
| NaN in stat cards | live reducer called with `{}` instead of `undefined` | never use `?? {}` when passing current live state to reducer |
| Click events double-counted | StrictMode creates 3 WS connections | `activeRef` + `wsRef.current !== ws` guard in `useWraithConnection` |
| Events double-counted after nav | REST load appends instead of replaces | `loadSessionEvents` must wipe `ss.events` before repopulating |
| Agent fires listeners twice | singleton guard missing or bypassed | `window.__wraith__` check at IIFE entry |
| Heatmap throttle not working | `throttle(() => {}, ms)` throttled a no-op | throttle must wrap the actual handler |
| Right/middle click not captured | `click` event doesn't fire for non-left buttons in Chrome | use `pointerdown` instead |
| Replay slider jitters on mouse move | range input exists in live mode with changing `max` | only render `<input type="range">` when `inReplay === true`; show plain button in live mode |
| Heartbeat intervals accumulate on reconnect | `setInterval` called again without clearing previous | track `heartbeatId`; clear it in `onClose` before reconnect |
| `onEvent.types.has` is not a function | `types` is typed as `string[]` but must be `Set<string>` | declare `onEvent.types` as `new Set([...])`, not an array literal |
| Duplicate module ID silently accepted | old code warned instead of throwing | `registry.register` now throws — deduplicate module IDs before registering |
| TS6059 — file not under rootDir | `rootDir` explicitly set in `server/tsconfig.json` | remove `"rootDir": "./src"` — TypeScript infers it from `include`; TS6059 only fires when rootDir is explicit |
| TypeScript infers too-narrow live state type | default parameter triggers inference | use `state ?? initialValue` in body and widen the type; `LiveReducer` default generic is `any` — framework passes state opaquely |

---

## Capture engine (`agent/src/capture/engine.ts`)

- `wireEvents`: adds `window.addEventListener` for each event spec; throttle wraps the **actual handler** (not a no-op)
- `wireHooks`: monkey-patches `window[a][b][c]` with the original preserved for restore
- `wirePolls`: `setInterval` collectors
- All listeners tracked in `this.cleanups` for teardown on `stop()`
- On transport disconnect → `capture.stop()` + `ready = false`; on reconnect → `module_configs` re-received → `capture.start()` again

---

## Encoding

Default: `JSON` (plaintext). `Base64JSON` encoder also available in `agent/src/encoding/`.
Transport and encoding are injected as dependencies — modules never touch them.

---

## Dev workflow

```bash
pnpm dev                    # start server (3000) + UI (5173)
pnpm --filter agent build   # rebuild agent bundle after agent/capture changes
```

Inject the agent by adding to any page:
```html
<script src="http://localhost:3000/hook.js"></script>
```

The admin UI is at `http://localhost:5173`. Sessions appear in the sidebar as agents connect.
