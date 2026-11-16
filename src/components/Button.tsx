import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function buttonClassName(
  variant: ButtonVariant = 'primary',
  extra?: string,
): string {
  const variantClass = variant === 'primary' ? '' : ` btn--${variant}`
  return `btn${variantClass}${extra ? ` ${extra}` : ''}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: 'sm' | 'md'
  block?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    buttonClassName(variant),
    size === 'sm' ? 'btn--sm' : '',
    block ? 'btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  )
}
