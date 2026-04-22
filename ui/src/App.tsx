import { useState, type FormEvent } from 'react'
import { Routes, Route, Navigate, NavLink, useParams, useNavigate, useLocation } from 'react-router-dom'
import { ChevronDown, Syringe } from 'lucide-react'
import { useWraithConnection, useConnected } from './hooks/useWraith.js'
import { useWraithStore } from './store/index.js'
import { setToken } from './api.js'
import { SessionList } from './views/SessionList.js'
import { SessionDetail, getModuleUIs, ModuleIcon } from './views/SessionDetail.js'
import { ModuleDetail, ModulesAll } from './views/Modules.js'
import { Implant } from './views/Implant.js'

// Forces SessionDetail to fully remount when the session changes,
// resetting replay state, zoom, and filters.
function KeyedSessionDetail() {
  const { id } = useParams<{ id: string }>()
  return <SessionDetail key={id} />
}

function TokenPrompt() {
  const [value, setValue] = useState('')
  return (
    <div className="fixed inset-0 bg-surface/90 backdrop-blur-sm flex items-center justify-center z-50">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          setToken(value.trim())
          location.reload()
        }}
        className="bg-panel border border-border rounded-lg p-6 flex flex-col gap-4 w-80"
      >
        <h2 className="text-sm font-semibold text-accent uppercase tracking-widest">Admin Token Required</h2>
        <input
          type="password"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Enter ADMIN_TOKEN"
          autoFocus
          className="bg-surface border border-border rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          className="bg-accent text-white rounded px-4 py-2 text-sm hover:bg-accent-dim transition-colors disabled:opacity-40"
        >
          Connect
        </button>
      </form>
    </div>
  )
}

function StatusDot() {
  const connected = useConnected()
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500 animate-pulse'}`} />
      {connected ? 'connected' : 'reconnecting…'}
    </div>
  )
}

function ModulesDropdown() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const mods = getModuleUIs()
  const onModulesPage = location.pathname.startsWith('/modules')
  const activeModId = location.pathname.startsWith('/modules/') ? location.pathname.split('/')[2] : null

  return (
    <div className="border-b border-border">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-2 text-xs uppercase tracking-widest transition-colors ${
          onModulesPage ? 'text-accent bg-accent/5' : 'text-muted hover:text-gray-300'
        }`}
      >
        <span>Modules</span>
        <div className="flex items-center gap-1.5">
          <span className="text-muted normal-case tracking-normal">{mods.length}</span>
          <ChevronDown
            size={12}
            className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </div>
      </button>
      {open && (
        <div className="border-t border-border">
          <button
            onClick={() => { navigate('/modules'); setOpen(false) }}
            className={`w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors border-b border-border ${
              location.pathname === '/modules'
                ? 'bg-panel text-accent'
                : 'text-gray-400 hover:text-gray-200 hover:bg-panel/50'
            }`}
          >
            <span className="text-xs">View All</span>
          </button>
          {mods.map(m => (
            <button
              key={m.id}
              onClick={() => { navigate(`/modules/${m.id}`); setOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors ${
                activeModId === m.id
                  ? 'bg-panel text-accent'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-panel/50'
              }`}
            >
              <div className={`flex items-center justify-center w-5 h-5 rounded shrink-0 ${
                activeModId === m.id ? 'bg-accent/15 text-accent' : 'bg-border/50 text-muted'
              }`}>
                <ModuleIcon name={m.nav.icon} size={11} />
              </div>
              <span className="text-xs truncate flex-1">{m.name}</span>
              <span className="text-[10px] text-muted font-mono shrink-0">v{m.version}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function App() {
  useWraithConnection()
  const authFailed = useWraithStore(s => s.authFailed)

  return (
    <div className="h-screen flex flex-col bg-surface text-gray-100">
      {authFailed && <TokenPrompt />}
      {/* Topbar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-panel">
        <span className="text-sm font-semibold tracking-widest text-accent uppercase">Wraith</span>
        <StatusDot />
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 flex flex-col border-r border-border bg-surface">
          <NavLink
            to="/implant"
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-2 text-xs uppercase tracking-widest border-b border-border transition-colors ${
                isActive ? 'text-accent bg-accent/5' : 'text-muted hover:text-gray-300'
              }`
            }
          >
            <Syringe size={12} />
            Implant
          </NavLink>
          <ModulesDropdown />
          <p className="px-4 py-2 text-xs uppercase tracking-widest text-muted border-b border-border">
            Sessions
          </p>
          <SessionList />
        </aside>

        {/* Main content */}
        <main className="flex-1 flex overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/sessions" replace />} />
            <Route path="/implant" element={<Implant />} />
            <Route path="/modules" element={<ModulesAll />} />
            <Route path="/modules/:id" element={<ModuleDetail />} />
            <Route path="/sessions" element={
              <div className="flex-1 flex items-center justify-center text-muted text-sm">
                select a session from the sidebar
              </div>
            } />
            <Route path="/sessions/:id" element={<KeyedSessionDetail />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
