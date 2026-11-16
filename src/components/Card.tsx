import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  flush?: boolean
  as?: 'section' | 'div' | 'article'
}

export function Card({ children, className, flush = false, as = 'section' }: CardProps) {
  const Tag = as
  return (
    <Tag className={`card${flush ? ' card--flush' : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </Tag>
  )
}

interface CardHeaderProps {
  title: string
  action?: ReactNode
  id?: string
}

export function CardHeader({ title, action, id }: CardHeaderProps) {
  return (
    <div className="card__header">
      <h2 id={id} style={{ fontSize: '1.0625rem' }}>
        {title}
      </h2>
      {action}
    </div>
  )
}
