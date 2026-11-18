import type { ReactNode } from 'react'

interface StateBlockProps {
  icon?: string
  title: string
  children?: ReactNode
  tone?: 'default' | 'success'
  actions?: ReactNode
  centre?: boolean
  /**
   * Heading level for the title. Use 1 when the state block is the only content
   * on the page, so the page still exposes a top-level heading.
   */
  headingLevel?: 1 | 2 | 3
}

export function StateBlock({
  icon,
  title,
  children,
  tone = 'default',
  actions,
  centre = false,
  headingLevel = 2,
}: StateBlockProps) {
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3'

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
        <Heading className="state__title">{title}</Heading>
        {children ? <div className="secondary text-sm">{children}</div> : null}
      </div>
      {actions ? <div className="row row--wrap">{actions}</div> : null}
    </div>
  )
}
