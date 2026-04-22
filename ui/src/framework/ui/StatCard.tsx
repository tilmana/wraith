import clsx from 'clsx'

interface StatCardProps {
  label: string
  value: string | number | boolean
  alert?: boolean
}

export function StatCard({ label, value, alert }: StatCardProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded border border-border bg-surface px-3 py-2">
      <span className="text-xs text-muted">{label}</span>
      <span className={clsx('text-sm font-medium', alert ? 'text-red-400' : 'text-gray-100')}>
        {String(value)}
      </span>
    </div>
  )
}
