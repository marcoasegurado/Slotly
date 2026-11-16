import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface DialogProps {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  footer: ReactNode
}

export function Dialog({ open, title, children, onClose, footer }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previouslyFocused = document.activeElement as HTMLElement | null
    sheetRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
      ref={dialogRef}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={sheetRef}
        tabIndex={-1}
      >
        <div className="stack stack--tight">
          <h2 id="dialog-title" style={{ fontSize: '1.125rem' }}>
            {title}
          </h2>
          <div className="secondary text-sm">{children}</div>
        </div>
        <div className="dialog__actions">{footer}</div>
      </div>
    </div>
  )
}
