import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App.js'
import { registerModuleUI } from './views/SessionDetail.js'
import { registerModuleReducer } from './hooks/useWraith.js'

// Auto-discover all modules at build time via Vite's glob import
const moduleFiles = import.meta.glob('../../modules/*/index.jsx', { eager: true })

for (const [filePath, raw] of Object.entries(moduleFiles)) {
  const mod = (raw as any).default ?? raw
  if (!mod?.id || !mod?.ui) {
    console.warn(`[wraith] skipping module at ${filePath}: missing id or ui`)
    continue
  }
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
