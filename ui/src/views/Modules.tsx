import { useParams, Navigate } from 'react-router-dom'
import { getModuleUIs, ModuleIcon } from './SessionDetail.js'

function ModuleCard({ mod }: { mod: ReturnType<typeof getModuleUIs>[number] }) {
  return (
    <div className="bg-panel border border-border rounded-lg p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-accent/10 text-accent shrink-0">
            <ModuleIcon name={mod.nav.icon} size={20} />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-100">{mod.name}</h1>
            <p className="text-xs text-muted font-mono mt-0.5">{mod.id}</p>
          </div>
        </div>
        <span className="text-xs text-accent font-mono bg-accent/10 px-2.5 py-1 rounded shrink-0">
          v{mod.version}
        </span>
      </div>

      <p className="text-sm text-gray-300 leading-relaxed">{mod.description}</p>

      {(mod.author || mod.date) && (
        <div className="flex items-center gap-4 pt-3 border-t border-border">
          {mod.author && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted">Author</span>
              <span className="text-xs text-gray-300 font-medium">{mod.author}</span>
            </div>
          )}
          {mod.date && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted">Date</span>
              <span className="text-xs text-gray-300 font-mono">{mod.date}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ModuleDetail() {
  const { id } = useParams<{ id: string }>()
  const mods = getModuleUIs()
  const mod = mods.find(m => m.id === id)

  if (!mod) return <Navigate to="/sessions" replace />

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        <ModuleCard mod={mod} />
      </div>
    </div>
  )
}

export function ModulesAll() {
  const mods = getModuleUIs()

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-sm font-semibold text-accent uppercase tracking-widest">All Modules</h1>
          <p className="text-xs text-muted mt-1">{mods.length} module{mods.length === 1 ? '' : 's'} loaded</p>
        </div>
        {mods.map(m => <ModuleCard key={m.id} mod={m} />)}
      </div>
    </div>
  )
}
