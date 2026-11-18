import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

interface DialogProps {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
  footer: ReactNode
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({ open, title, children, onClose, footer }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return

    const sheet = sheetRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusable = (): HTMLElement[] =>
      sheet
        ? [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
            (element) => element.getClientRects().length > 0,
          )
        : []

    const first = focusable()[0]
    ;(first ?? sheet)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !sheet) return

      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        sheet.focus()
        return
      }

      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement

      // Keep keyboard focus inside the dialog; aria-modal alone does not
      // stop Tab from reaching the page behind the backdrop.
      if (event.shiftKey && (active === firstItem || active === sheet)) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem.focus()
      } else if (!sheet.contains(active)) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)

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
        aria-labelledby={titleId}
        ref={sheetRef}
        tabIndex={-1}
      >
        <div className="stack stack--tight">
          <h2 id={titleId} style={{ fontSize: '1.125rem' }}>
            {title}
          </h2>
          <div className="secondary text-sm">{children}</div>
        </div>
        <div className="dialog__actions">{footer}</div>
      </div>
    </div>
  )
}
