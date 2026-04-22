interface DataTableProps {
  title: string
  rows:    Array<Record<string, unknown> | null | undefined>
  columns: string[]
}

export function DataTable({ title, rows, columns }: DataTableProps) {
  const filtered = rows.filter(Boolean) as Array<Record<string, unknown>>

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">{title}</p>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="border-b border-border bg-surface">
            <tr>
              {columns.map(col => (
                <th key={col} className="px-3 py-2 text-left text-muted font-medium">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-4 text-center text-muted">
                  no data
                </td>
              </tr>
            ) : (
              filtered.map((row, i) => (
                <tr key={i} className="hover:bg-surface/60 transition-colors">
                  {columns.map(col => (
                    <td key={col} className="px-3 py-2 text-gray-300 font-mono truncate max-w-xs">
                      {String(row[col] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
