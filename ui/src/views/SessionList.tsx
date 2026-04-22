import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useSessions } from '../hooks/useWraith.js'
import { useWraithStore } from '../store/index.js'
import { apiFetch } from '../api.js'
import type { Session } from '@wraith/types'

function timeSince(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

function SessionRow({ session, active }: { session: Session; active: boolean }) {
  const navigate = useNavigate()
  const deleteSession = useWraithStore(s => s.deleteSession)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    setDeleting(true)
    try {
      await apiFetch(`/api/sessions/${session.id}`, { method: 'DELETE' })
      deleteSession(session.id)
      if (active) navigate('/sessions')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <button
      onClick={() => navigate(`/sessions/${session.id}`)}
      className={clsx(
        'group w-full text-left px-4 py-3 border-b border-border transition-colors hover:bg-panel',
        active && 'bg-panel border-l-2 border-l-accent',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={clsx(
            'h-2 w-2 rounded-full flex-shrink-0',
            session.status === 'active' ? 'bg-green-400' : 'bg-muted',
          )} />
          <span className="flex-1 truncate text-xs text-gray-300 font-mono">
            {session.id.slice(0, 8)}…
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted">{timeSince(session.lastSeenAt)}</span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all disabled:opacity-40"
            title="Delete session"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <p className="mt-1 truncate text-xs text-muted pl-4">
        {(() => { try { return new URL(session.meta.url).hostname } catch { return session.meta.url } })()}
      </p>
    </button>
  )
}

export function SessionList() {
  const allSessions = useSessions()
  const { id } = useParams()
  const deleteDeadSessions = useWraithStore(s => s.deleteDeadSessions)
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [clearing, setClearing] = useState(false)

  const sessions =
    filter === 'active'   ? allSessions.filter(s => s.status === 'active') :
    filter === 'inactive' ? allSessions.filter(s => s.status === 'dead')   :
    allSessions
  const deadCount = allSessions.filter(s => s.status === 'dead').length

  async function handleClearDead() {
    setClearing(true)
    try {
      await apiFetch('/api/sessions/dead', { method: 'DELETE' })
      deleteDeadSessions()
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border gap-2">
        <div className="flex gap-1">
          <button
            onClick={() => setFilter('all')}
            className={clsx(
              'px-2 py-0.5 text-xs rounded transition-colors',
              filter === 'all' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-gray-300',
            )}
          >
            All
          </button>
          <button
            onClick={() => setFilter('active')}
            className={clsx(
              'px-2 py-0.5 text-xs rounded transition-colors',
              filter === 'active' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-gray-300',
            )}
          >
            Active
          </button>
          <button
            onClick={() => setFilter('inactive')}
            className={clsx(
              'px-2 py-0.5 text-xs rounded transition-colors',
              filter === 'inactive' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-gray-300',
            )}
          >
            Inactive
          </button>
        </div>
        {deadCount > 0 && (
          <button
            onClick={handleClearDead}
            disabled={clearing}
            className="text-xs text-muted hover:text-red-400 transition-colors disabled:opacity-40 flex items-center gap-1"
            title={`Delete ${deadCount} dead session${deadCount !== 1 ? 's' : ''}`}
          >
            <Trash2 size={11} />
            {deadCount}
          </button>
        )}
      </div>

      {/* Session rows */}
      <div className="overflow-y-auto flex-1">
        {sessions.length === 0 ? (
          <div className="p-4 text-xs text-muted text-center">
            {filter === 'active'   ? 'no active sessions' :
             filter === 'inactive' ? 'no inactive sessions' :
             'waiting for hooks…'}
          </div>
        ) : (
          sessions.map(s => (
            <SessionRow key={s.id} session={s} active={s.id === id} />
          ))
        )}
      </div>
    </div>
  )
}
