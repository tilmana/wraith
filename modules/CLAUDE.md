# Wraith Module Authoring — Quick Reference

Full spec: [`docs/module-spec.md`](../docs/module-spec.md)  
Example modules: `wraith-cursor/`, `wraith-utils/`, `wraith-keylog/`

---

## The one rule that bites everyone

**Capture functions must be self-contained closures.** No imports, no external variables.

The server serializes them with `fn.toString()` and reconstructs them in the agent's browser
via `new Function('return (' + src + ')()')`. Anything closed over from outside the function
body will be `undefined` at runtime.

```js
// WRONG — `BASE_URL` is undefined in the agent
const BASE_URL = 'https://example.com'
payload: e => ({ url: BASE_URL + e.target.href })

// RIGHT — self-contained
payload: e => ({ url: String(e.target.href), t: Date.now() })
```

Also avoid modern operators (`??`, `?.`) inside capture functions — esbuild may transpile them
in ways that break after `fn.toString()` serialization. Use `||`, `&&`, and explicit `if` checks.

---

## File rules

- File must be `.jsx` (not `.js`)
- `modules/package.json` has `"type": "module"` — do not change this
- Import UI components from `@framework/ui`, hooks from `'react'`

---

## Minimal structure

```jsx
import { Panel, StatCard } from '@framework/ui'

export default {
  id:          'my-module',       // unique kebab-case — duplicate throws on server start
  name:        'My Module',
  version:     '1.0.0',
  author:      'your-handle',
  date:        'YYYY-MM-DD',
  description: 'What it does.',

  capture: { /* init / events / hooks / poll */ },

  live: (state = { count: 0 }, event) => {
    if (event.type === 'click') return { ...state, count: state.count + 1 }
    return state
  },

  ui: {
    nav:   { label: 'My Module', icon: 'activity' },
    panel: ({ live }) => <Panel title="My Module"><StatCard label="Clicks" value={live.count ?? 0} /></Panel>,
    view:  ({ data, session, sendCommand }) => <div>…</div>,
  },
}
```

---

## Registration (automatic)

**No framework code changes needed.** Place your module directory under `modules/` with an
`index.jsx` default export. Both the server and UI discover modules automatically at startup:

- **Server:** `server/src/modules/discover.ts` scans `modules/*/index.jsx` via dynamic `import()`
- **UI:** `ui/src/main.tsx` uses `import.meta.glob('../../modules/*/index.jsx')` at build time

To add a new module:
```bash
git clone https://github.com/someone/wraith-my-module modules/wraith-my-module
pnpm install
pnpm dev    # restart required — modules are discovered at startup, not hot-reloaded
```

Each module needs a `package.json` with `"type": "module"` and `@framework/ui` as a
workspace dependency:
```json
{
  "name": "@wraith/module-my-module",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "main": "index.jsx",
  "dependencies": {
    "@framework/ui": "workspace:*"
  },
  "peerDependencies": {
    "react": "^18.0.0"
  }
}
```

---

## New `@framework/ui` component? Add null stubs to both:

- `framework-ui/index.js` — runtime stub (Node.js import)
- `server/src/stubs/framework-ui.ts` — TypeScript type stub

---

## Rebuild the agent bundle if capture functions changed

```bash
pnpm --filter agent build
```

---

## Common pitfalls

| Symptom | Fix |
|---|---|
| `ReferenceError` in agent | capture function closed over external variable — make it self-contained |
| init data missing after UI refresh | `capture.init` runs once at agent connect — target page must reconnect |
| `collect()` hangs | `collect` must be synchronous — use `capture.poll` for async |
| Key stuck as held | add `blur` event capture (`persist: false`) and clear pressed keys in `live` |
| `onEvent.types.has` not a function | use `new Set(['eventname'])`, not an array |
| Empty stat cards / NaN | live reducer called with `{}` — own your initial state with a default param |
| Sub-pixel coordinates | wrap `clientX/Y` with `Math.round()` in payload |
