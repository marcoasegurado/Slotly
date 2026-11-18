import {
  approveAdminAppointment,
  approveStaffAppointment,
  cancelAdminAppointment,
  cancelStaffAppointment,
  getAdminAppointment,
  getStaffAppointment,
  listAdminAppointments,
  listStaffAppointments,
  reassignAdminAppointment,
  rejectAdminAppointment,
  rejectStaffAppointment,
  rescheduleAdminAppointment,
  rescheduleStaffAppointment,
  type AppointmentStatus,
  type ManagedAppointment,
} from './api'

export type ManagementArea = 'staff' | 'admin'

export interface AppointmentQuery {
  status?: AppointmentStatus | 'all'
  scope?: 'today' | 'upcoming' | 'all'
  search?: string
}

/**
 * The staff and admin endpoints return the same appointment shape but enforce
 * different scopes: staff only ever see and change their own assignments, and
 * only an admin may reassign to another staff member. This adapter keeps one
 * review screen behind both rules without hiding the difference from the user.
 */
export interface ManagementApi {
  area: ManagementArea
  basePath: string
  canReassign: boolean
  list: (query: AppointmentQuery) => Promise<ManagedAppointment[]>
  get: (publicReference: string) => Promise<ManagedAppointment>
  approve: (publicReference: string) => Promise<ManagedAppointment>
  reject: (publicReference: string, reason?: string | null) => Promise<ManagedAppointment>
  cancel: (publicReference: string, reason?: string | null) => Promise<ManagedAppointment>
  reschedule: (publicReference: string, startAt: number) => Promise<ManagedAppointment>
  reassign: (
    publicReference: string,
    staffId: string,
    startAt?: number,
  ) => Promise<ManagedAppointment>
}

export const staffManagement: ManagementApi = {
  area: 'staff',
  basePath: '/staff/appointments',
  canReassign: false,
  list: ({ status, scope }) =>
    listStaffAppointments({
      status: status && status !== 'all' ? status : undefined,
      scope: scope ?? 'all',
    }),
  get: getStaffAppointment,
  approve: approveStaffAppointment,
  reject: rejectStaffAppointment,
  cancel: cancelStaffAppointment,
  reschedule: rescheduleStaffAppointment,
  reassign: async () => {
    throw new Error('Only an admin can reassign an appointment.')
  },
}

export const adminManagement: ManagementApi = {
  area: 'admin',
  basePath: '/admin/appointments',
  canReassign: true,
  list: ({ status, search }) =>
    listAdminAppointments({
      status: status && status !== 'all' ? status : undefined,
      q: search?.trim() ? search.trim() : undefined,
    }),
  get: getAdminAppointment,
  approve: approveAdminAppointment,
  reject: rejectAdminAppointment,
  cancel: cancelAdminAppointment,
  reschedule: rescheduleAdminAppointment,
  reassign: (publicReference, staffId, startAt) =>
    reassignAdminAppointment(publicReference, { staffId, startAt }),
}

export function managementFor(area: ManagementArea): ManagementApi {
  return area === 'admin' ? adminManagement : staffManagement
}

/** Where a management screen sends the user on success. */
export function managePath(area: ManagementArea, path = ''): string {
  const base = area === 'admin' ? '/admin' : '/staff'
  return path ? `${base}/${path}` : base
}
