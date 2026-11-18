import { useId } from 'react'
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

interface FieldShellProps {
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (describedBy: string | undefined) => ReactNode
}

function FieldShell({ id, label, hint, error, required, children }: FieldShellProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children(describedBy)}
      {error ? (
        <span className="field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: string
  error?: string
  fieldId?: string
}

export function TextField({
  label,
  hint,
  error,
  fieldId,
  required,
  ...rest
}: TextFieldProps) {
  const generated = useId()
  const id = fieldId ?? `field-${generated}`

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      {(describedBy) => (
        <input
          className="input"
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      )}
    </FieldShell>
  )
}

interface TextAreaFieldProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string
  hint?: string
  error?: string
  fieldId?: string
}

export function TextAreaField({
  label,
  hint,
  error,
  fieldId,
  required,
  ...rest
}: TextAreaFieldProps) {
  const generated = useId()
  const id = fieldId ?? `field-${generated}`

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      {(describedBy) => (
        <textarea
          className="textarea"
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      )}
    </FieldShell>
  )
}

interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string
  hint?: string
  error?: string
  fieldId?: string
}

export function SelectField({
  label,
  hint,
  error,
  fieldId,
  required,
  children,
  ...rest
}: SelectFieldProps) {
  const generated = useId()
  const id = fieldId ?? `field-${generated}`

  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      {(describedBy) => (
        <select
          className="input"
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  )
}
