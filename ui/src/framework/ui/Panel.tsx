import { type ReactNode } from 'react'
import clsx from 'clsx'

interface PanelProps {
  title: string
  children: ReactNode
  className?: string
}

export function Panel({ title, children, className }: PanelProps) {
  return (
    <div className={clsx('rounded-lg border border-border bg-panel p-4 space-y-3', className)}>
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">{title}</h3>
      {children}
    </div>
  )
}
