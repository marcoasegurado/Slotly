import type { AppointmentStatus } from '../lib/api'

const LABELS: Record<AppointmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export function statusLabel(status: AppointmentStatus): string {
  return LABELS[status]
}

/**
 * Status is always conveyed with a readable text label, never colour alone
 * (docs/UI_DESIGN.md §2).
 */
export function StatusTag({ status }: { status: AppointmentStatus }) {
  return <span className={`status status--${status}`}>{LABELS[status]}</span>
}
