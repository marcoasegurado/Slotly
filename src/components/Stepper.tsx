interface StepperProps {
  steps: string[]
  /** Zero-based index of the active step. */
  current: number
}

export function Stepper({ steps, current }: StepperProps) {
  return (
    <nav className="stepper" aria-label="Booking progress">
      {steps.map((step, index) => {
        const state =
          index < current ? 'complete' : index === current ? 'active' : 'upcoming'
        return (
          <div key={step} style={{ display: 'contents' }}>
            {index > 0 ? <span className="step__rule" aria-hidden="true" /> : null}
            <span
              className={
                state === 'upcoming' ? 'step' : `step step--${state}`
              }
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="step__marker" aria-hidden="true">
                {state === 'complete' ? '✓' : index + 1}
              </span>
              {step}
            </span>
          </div>
        )
      })}
    </nav>
  )
}
