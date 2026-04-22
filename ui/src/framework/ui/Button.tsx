import clsx from 'clsx'

interface ButtonProps {
  label:    string
  onClick:  () => void
  variant?: 'default' | 'danger' | 'ghost'
  disabled?: boolean
}

export function Button({ label, onClick, variant = 'default', disabled }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40',
        variant === 'danger'  && 'bg-red-600 hover:bg-red-500 text-white',
        variant === 'ghost'   && 'bg-transparent border border-border hover:bg-border text-muted hover:text-gray-100',
        variant === 'default' && 'bg-accent hover:bg-violet-500 text-white',
      )}
    >
      {label}
    </button>
  )
}
