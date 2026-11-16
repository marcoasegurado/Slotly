import type {
  Appointment,
  Business,
  Customer,
  GuestCancellationToken,
  Service,
  StaffMember,
} from './types'
import {
  addDaysToDateKey,
  todayDateKey,
  weekdayOfDateKey,
  zonedTimeToUtc,
} from '../lib/time'

export interface MockDatabase {
  business: Business
  services: Service[]
  staff: StaffMember[]
  customers: Customer[]
  appointments: Appointment[]
  cancellationTokens: GuestCancellationToken[]
  sessionCustomerId: string | null
}

export function newId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${random}`
}

const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function newPublicReference(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  const body = Array.from(bytes, (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join('')
  return `SLO-${body}`
}

export function newCancellationToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function nextDateKeyWhere(
  fromDateKey: string,
  predicate: (dateKey: string) => boolean,
  limit = 21,
): string {
  for (let offset = 0; offset < limit; offset += 1) {
    const candidate = addDaysToDateKey(fromDateKey, offset)
    if (predicate(candidate)) return candidate
  }
  return fromDateKey
}

const WEEKDAYS = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 0,
} as const

/** 09:00 in minutes from midnight. */
function at(hour: number, minute = 0): number {
  return hour * 60 + minute
}

/**
 * Sample data for UI review. Every record is relative to "today" so the
 * calendar always shows a realistic, non-empty week. This never runs against
 * a real database; the demo banner in the UI makes that explicit.
 */
export function createSeedDatabase(now: Date = new Date()): MockDatabase {
  const business: Business = {
    businessName: 'Slotly Studio',
    businessEmail: 'hello@slotly.studio',
    timezone: 'Asia/Manila',
    maxAdvanceBookingDays: 60,
  }

  const timezone = business.timezone
  const today = todayDateKey(timezone, now)

  const services: Service[] = [
    {
      id: 'svc_consult',
      name: 'Initial consultation',
      description: 'A first visit to talk through what you need and agree on next steps.',
      durationMinutes: 60,
      isActive: true,
    },
    {
      id: 'svc_standard',
      name: 'Standard appointment',
      description: 'A regular appointment for returning clients.',
      durationMinutes: 45,
      isActive: true,
    },
    {
      id: 'svc_extended',
      name: 'Extended session',
      description: 'More time for a detailed visit or two services in one trip.',
      durationMinutes: 90,
      isActive: true,
    },
    {
      id: 'svc_group',
      name: 'Group session',
      description: 'Currently unavailable while the room is being refurbished.',
      durationMinutes: 60,
      isActive: false,
    },
  ]

  const staff: StaffMember[] = [
    {
      id: 'stf_ana',
      name: 'Ana Reyes',
      isActive: true,
      intervals: [
        { weekday: WEEKDAYS.monday, startMinute: at(9), endMinute: at(17) },
        { weekday: WEEKDAYS.tuesday, startMinute: at(9), endMinute: at(17) },
        { weekday: WEEKDAYS.wednesday, startMinute: at(9), endMinute: at(17) },
        { weekday: WEEKDAYS.thursday, startMinute: at(9), endMinute: at(17) },
        { weekday: WEEKDAYS.friday, startMinute: at(9), endMinute: at(17) },
      ],
      timeOff: [],
    },
    {
      id: 'stf_ben',
      name: 'Ben Cruz',
      isActive: true,
      intervals: [
        { weekday: WEEKDAYS.tuesday, startMinute: at(10), endMinute: at(18) },
        { weekday: WEEKDAYS.wednesday, startMinute: at(10), endMinute: at(18) },
        { weekday: WEEKDAYS.thursday, startMinute: at(10), endMinute: at(18) },
        { weekday: WEEKDAYS.friday, startMinute: at(10), endMinute: at(18) },
        { weekday: WEEKDAYS.saturday, startMinute: at(10), endMinute: at(18) },
      ],
      timeOff: [],
    },
    {
      id: 'stf_ciel',
      name: 'Ciel Santos',
      isActive: true,
      intervals: [
        { weekday: WEEKDAYS.monday, startMinute: at(8), endMinute: at(12) },
        { weekday: WEEKDAYS.monday, startMinute: at(13), endMinute: at(17) },
        { weekday: WEEKDAYS.wednesday, startMinute: at(8), endMinute: at(12) },
        { weekday: WEEKDAYS.wednesday, startMinute: at(13), endMinute: at(17) },
        { weekday: WEEKDAYS.friday, startMinute: at(8), endMinute: at(12) },
        { weekday: WEEKDAYS.friday, startMinute: at(13), endMinute: at(17) },
      ],
      timeOff: [],
    },
  ]

  const staffById = new Map(staff.map((member) => [member.id, member]))

  // One clear day off, so "that day is unavailable" is reproducible in review.
  const anaDayOff = nextDateKeyWhere(
    addDaysToDateKey(today, 1),
    (dateKey) => weekdayOfDateKey(dateKey) === WEEKDAYS.tuesday,
  )
  staffById.get('stf_ana')?.timeOff.push({
    id: 'tof_ana_1',
    staffId: 'stf_ana',
    startAt: zonedTimeToUtc(anaDayOff, at(0), timezone).toISOString(),
    endAt: zonedTimeToUtc(anaDayOff, at(23, 59), timezone).toISOString(),
    reason: 'Personal leave',
  })

  const benShortDay = nextDateKeyWhere(
    addDaysToDateKey(today, 2),
    (dateKey) => {
      const weekday = weekdayOfDateKey(dateKey)
      return weekday >= 2 && weekday <= 6
    },
  )
  staffById.get('stf_ben')?.timeOff.push({
    id: 'tof_ben_1',
    staffId: 'stf_ben',
    startAt: zonedTimeToUtc(benShortDay, at(10), timezone).toISOString(),
    endAt: zonedTimeToUtc(benShortDay, at(12), timezone).toISOString(),
    reason: 'Training',
  })

  const customers: Customer[] = [
    {
      id: 'cus_maria',
      name: 'Maria Santos',
      email: 'maria@example.com',
      password: 'slotly-demo',
    },
  ]

  const firstOpenDay = nextDateKeyWhere(addDaysToDateKey(today, 1), (dateKey) => {
    const weekday = weekdayOfDateKey(dateKey)
    return weekday >= 1 && weekday <= 6
  })

  const appointments: Appointment[] = []

  const seededConfirmed = (
    id: string,
    staffId: string,
    dateKey: string,
    startMinute: number,
    service: Service,
    customer: Customer | null,
    guest: { name: string; email: string } | null,
    reference: string,
  ): Appointment => {
    const start = zonedTimeToUtc(dateKey, startMinute, timezone)
    const end = zonedTimeToUtc(dateKey, startMinute + service.durationMinutes, timezone)
    return {
      id,
      publicReference: reference,
      customerUserId: customer ? customer.id : null,
      guestName: guest ? guest.name : null,
      guestEmail: guest ? guest.email : null,
      serviceId: service.id,
      serviceNameSnapshot: service.name,
      durationMinutesSnapshot: service.durationMinutes,
      assignedStaffUserId: staffId,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      status: 'confirmed',
      customerNote: null,
      resolutionNote: null,
      createdAt: start.toISOString(),
      updatedAt: start.toISOString(),
    }
  }

  appointments.push(
    seededConfirmed(
      'apt_confirmed_ana',
      'stf_ana',
      firstOpenDay,
      at(10),
      services[0],
      customers[0],
      null,
      'SLO-7K2M4A',
    ),
    seededConfirmed(
      'apt_confirmed_ben',
      'stf_ben',
      firstOpenDay,
      at(14),
      services[1],
      null,
      { name: 'Daniel Okafor', email: 'daniel@example.com' },
      'SLO-3QW8PZ',
    ),
  )

  // A pending guest request tied to a stable demo cancellation token, so the
  // cancellation screens can be reviewed at any time.
  const pendingDay = nextDateKeyWhere(addDaysToDateKey(firstOpenDay, 1), (dateKey) => {
    const weekday = weekdayOfDateKey(dateKey)
    return weekday >= 1 && weekday <= 6
  })
  const pendingStart = zonedTimeToUtc(pendingDay, at(11), timezone)
  const pendingEnd = zonedTimeToUtc(pendingDay, at(12), timezone)

  appointments.push({
    id: 'apt_demo_pending',
    publicReference: 'SLO-9XB6RT',
    customerUserId: null,
    guestName: 'Priya Nair',
    guestEmail: 'priya@example.com',
    serviceId: services[0].id,
    serviceNameSnapshot: services[0].name,
    durationMinutesSnapshot: services[0].durationMinutes,
    assignedStaffUserId: 'stf_ana',
    startAt: pendingStart.toISOString(),
    endAt: pendingEnd.toISOString(),
    status: 'pending',
    customerNote: 'First visit — a morning slot would be ideal.',
    resolutionNote: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  })

  // A past booking so customer history has a truthful, completed record.
  const pastDay = addDaysToDateKey(today, -18)
  appointments.push({
    ...seededConfirmed(
      'apt_past_maria',
      'stf_ana',
      pastDay,
      at(11),
      services[1],
      customers[0],
      null,
      'SLO-5H1N8C',
    ),
  })

  const cancellationTokens: GuestCancellationToken[] = [
    {
      token: 'demo-pending',
      appointmentId: 'apt_demo_pending',
      expiresAt: pendingStart.toISOString(),
      usedAt: null,
    },
    {
      token: 'demo-used',
      appointmentId: 'apt_demo_pending',
      expiresAt: pendingStart.toISOString(),
      usedAt: now.toISOString(),
    },
    {
      token: 'demo-expired',
      appointmentId: 'apt_demo_pending',
      expiresAt: addDaysToDateKey(today, -1),
      usedAt: null,
    },
  ]

  return {
    business,
    services,
    staff,
    customers,
    appointments,
    cancellationTokens,
    sessionCustomerId: null,
  }
}
