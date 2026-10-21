import type { ReactNode } from 'react'

/** A view shown inside a column, over the column's own posts: a thread or a profile. */
export function Panel({ title, onBack, onClose, children }: { title: string; onBack(): void; onClose(): void; children: ReactNode }) {
  return (
    <div className="panel">
      <div className="panel-bar">
        <button type="button" onClick={onBack}>
          ‹ Back
        </button>
        <strong>{title}</strong>
        <button type="button" title="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="scroll">{children}</div>
    </div>
  )
}
