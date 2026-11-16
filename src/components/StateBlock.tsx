import type { ReactNode } from 'react'

interface StateBlockProps {
  icon?: string
  title: string
  children?: ReactNode
  tone?: 'default' | 'success'
  actions?: ReactNode
  centre?: boolean
}

export function StateBlock({
  icon,
  title,
  children,
  tone = 'default',
  actions,
  centre = false,
}: StateBlockProps) {
  return (
    <div className={`state${centre ? ' state--center' : ''}`}>
      {icon ? (
        <span
          className={`state__icon${tone === 'success' ? ' state__icon--success' : ''}`}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <div className="stack stack--tight">
        <p className="state__title">{title}</p>
        {children ? <div className="secondary text-sm">{children}</div> : null}
      </div>
      {actions ? <div className="row row--wrap">{actions}</div> : null}
    </div>
  )
}
