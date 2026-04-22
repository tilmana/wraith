import { useEffect, useRef } from 'react'

interface EventFeedProps {
  title:  string
  events: unknown[] | string
}

export function EventFeed({ title, events }: EventFeedProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [events])

  const content = typeof events === 'string'
    ? events
    : events.map(e => JSON.stringify(e)).join('\n')

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">{title}</p>
      <div
        ref={ref}
        className="h-36 overflow-y-auto rounded border border-border bg-surface p-2 text-xs text-green-400 font-mono whitespace-pre-wrap break-all"
      >
        {content || <span className="text-muted">no events</span>}
      </div>
    </div>
  )
}
