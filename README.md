# Wraith

> **DISCLAIMER**: Wraith is an educational browser hook framework built strictly for security research,
> penetration testing on systems you own, and authorized engagements. Use without explicit written
> permission from the system owner is illegal under the Computer Fraud and Abuse Act (CFAA) and
> equivalent laws worldwide. The authors accept no liability for misuse.

A modular, extensible browser hook framework for understanding JavaScript-based attack surfaces.

---

## Architecture

```
wraith/
├── types/          Shared TypeScript contracts (Module interface, C2 protocol messages)
├── server/         Fastify C2 server — session management, WebSocket transport, REST API
├── agent/          Browser-side hook runtime compiled to a single hook.js (~4 KB)
├── ui/             React 18 admin dashboard (Vite)
├── framework-ui/   Server-side null stubs for @framework/ui components
├── modules/        Pluggable capability modules (auto-discovered)
└── docs/           Module authoring spec
```

### Transport layer

The C2 protocol is transport-agnostic. The `C2Transport` interface abstracts the wire protocol,
with a WebSocket implementation shipped by default.

### Module system

Modules are self-describing plugins. They declare:

- **capture** — what to collect (DOM events, API hooks, polls, init data)
- **commands** — operations the operator can push to the agent
- **live** — a state reducer for real-time panel updates
- **ui** — React components that render inside the framework's panel host

The framework owns encoding, transport, session management, and UI layout. Modules only provide
functional capability. See [`docs/module-spec.md`](docs/module-spec.md) for the full contract.

Modules are **auto-discovered** — drop a directory into `modules/` and restart. No framework
code changes required.

---

## Official modules

| Module | Description |
|--------|-------------|
| [wraith-cursor](https://github.com/tilmana/wraith-cursor) | Mouse & click tracking with heatmap, drag detection, and replay |
| [wraith-keylog](https://github.com/tilmana/wraith-keylog) | Keystroke capture with live keyboard display, frequency heatmap, and text reconstruction |
| [wraith-utils](https://github.com/tilmana/wraith-utils) | One-shot browser, hardware, network, storage, and fingerprint collection |
| [wraith-webrtc](https://github.com/tilmana/wraith-webrtc) | WebRTC STUN IP leak — extracts real IPs behind VPN/proxy |
| [wraith-devices](https://github.com/tilmana/wraith-devices) | Device enumeration with permission prompting and attempt tracking |
| [wraith-idle](https://github.com/tilmana/wraith-idle) | Idle & tab visibility tracking with time breakdown and event timeline |

---

## Quickstart

```bash
pnpm install
pnpm build:agent          # compile hook.js
pnpm dev                  # start server (port 3000) + UI dev server (port 5173)
```

Inject into a target page (authorized testing only):

```html
<script src="http://localhost:3000/hook.js"></script>
```

The admin UI is at `http://localhost:5173`. Sessions appear in the sidebar as agents connect.

---

## Adding a module

```bash
git clone https://github.com/someone/wraith-my-module modules/wraith-my-module
pnpm install
pnpm dev   # restart required — modules are discovered at startup
```

The framework scans `modules/*/index.jsx` automatically. No imports or registration code needed.

---

## Writing a module

See [`docs/module-spec.md`](docs/module-spec.md) and the existing modules in [`modules/`](modules/) for reference implementations.

Each module needs:
- `index.jsx` — default export conforming to the `WraithModule` interface
- `package.json` — with `"type": "module"` and `"@framework/ui": "workspace:*"`

---

## License

[MIT](LICENSE) — with an additional use restriction requiring explicit authorization for all testing.

---

## Demo Screenshots

- Admin Panel Login
<img width="1885" height="979" alt="image" src="https://github.com/user-attachments/assets/83bd20ee-c09e-48b0-9246-fbad82c61e62" />

- Target Browser Tab
<img width="1971" height="999" alt="image" src="https://github.com/user-attachments/assets/1bb089fa-1242-435b-8d8d-45036eb2eda4" />

- Active Session Listed
<img width="2502" height="868" alt="image" src="https://github.com/user-attachments/assets/9b22ad8c-6cbe-47cb-8e57-d2e15b8e94b0" />

- Modules Connected to Session
<img width="2124" height="1227" alt="image" src="https://github.com/user-attachments/assets/a8dc21c6-b370-40bd-8e00-7c6d6a970d7a" />

