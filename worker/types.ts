/**
 * API-facing shapes. Database columns stay snake_case inside repositories;
 * these camelCase types are the contract shared with the React client.
 */

export type UserRole = 'customer' | 'staff' | 'admin'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
  mustChangePassword: boolean
}

export interface PublicBusiness {
  businessName: string
  businessEmail: string | null
  timezone: string
  maxAdvanceBookingDays: number
}

export interface PublicService {
  id: string
  name: string
  description: string | null
  durationMinutes: number
  isActive: boolean
}
