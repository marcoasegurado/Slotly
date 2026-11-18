/**
 * Shapes shared by the browser client and the public bootstrap loader. They live
 * in their own module so the loader does not pull the whole DOM-typed client in
 * where only types are needed.
 */

export interface Business {
  businessName: string
  businessEmail: string | null
  timezone: string
  maxAdvanceBookingDays: number
}

export interface Service {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  isActive: boolean
}
