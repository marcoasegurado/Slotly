import { describe, expect, it } from 'vitest'
import {
  dateKeyUnixRange,
  isValidDateKey,
  toDateKey,
  zonedTimeToUtc,
} from '../worker/lib/time'
import {
  findScheduleConflicts,
  fitsIntervals,
  getDayAvailability,
  overlaps,
  type AvailabilityContext,
} from '../worker/services/availability'

const MANILA = 'Asia/Manila'
const MONDAY = '2026-11-16'
const MONDAY_EARLY_UTC = new Date('2026-11-16T00:00:00Z')

function unix(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000)
}

function context(
  overrides: Partial<AvailabilityContext> = {},
): AvailabilityContext {
  return {
    timezone: MANILA,
    maxAdvanceBookingDays: 60,
    staff: [
      {
        id: 'stf_a',
        workingHours: [{ weekday: 1, startMinute: 540, endMinute: 660 }],
        timeOff: [],
      },
    ],
    confirmedAppointments: [],
    ...overrides,
  }
}

describe('worker time helpers', () => {
  it('converts business-local times to UTC and back', () => {
    const instant = zonedTimeToUtc(MONDAY, 540, MANILA)

    expect(instant.toISOString()).toBe('2026-11-16T01:00:00.000Z')
    expect(toDateKey(instant, MANILA)).toBe(MONDAY)
  })

  it('handles DST offsets on both sides of a transition', () => {
    expect(
      zonedTimeToUtc('2026-03-08', 540, 'America/New_York').toISOString(),
    ).toBe('2026-03-08T13:00:00.000Z')
    expect(
      zonedTimeToUtc('2026-11-01', 540, 'America/New_York').toISOString(),
    ).toBe('2026-11-01T14:00:00.000Z')

    const springForward = dateKeyUnixRange('2026-03-08', 'America/New_York')
    expect(springForward.end - springForward.start).toBe(23 * 60 * 60)
  })

  it('strictly validates date keys', () => {
    expect(isValidDateKey(MONDAY)).toBe(true)
    expect(isValidDateKey('2026-02-29')).toBe(false)
    expect(isValidDateKey('2024-02-29')).toBe(true)
    expect(isValidDateKey('2026-13-01')).toBe(false)
    expect(isValidDateKey('16-11-2026')).toBe(false)
    expect(isValidDateKey('')).toBe(false)
  })
})

describe('interval helpers', () => {
  it('treats intervals as half-open', () => {
    expect(overlaps(100, 200, 200, 300)).toBe(false)
    expect(overlaps(100, 200, 199, 300)).toBe(true)
    expect(overlaps(100, 200, 50, 100)).toBe(false)
  })

  it('requires the whole duration to fit one working interval', () => {
    const intervals = [{ weekday: 1, startMinute: 540, endMinute: 1020 }]

    expect(fitsIntervals(intervals, 1, 540, 600)).toBe(true)
    expect(fitsIntervals(intervals, 1, 1020, 1080)).toBe(false)
    expect(fitsIntervals(intervals, 2, 540, 600)).toBe(false)
  })
})

describe('getDayAvailability', () => {
  it('returns 15-minute starts that fit the full service duration', () => {
    const availability = getDayAvailability(
      context(),
      60,
      MONDAY,
      MONDAY_EARLY_UTC,
    )

    expect(availability.state).toBe('open')
    expect(availability.slots.map((slot) => slot.startAt)).toEqual([
      unix('2026-11-16T01:00:00Z'),
      unix('2026-11-16T01:15:00Z'),
      unix('2026-11-16T01:30:00Z'),
      unix('2026-11-16T01:45:00Z'),
      unix('2026-11-16T02:00:00Z'),
    ])
    expect(availability.slots.at(-1)?.endAt).toBe(
      unix('2026-11-16T03:00:00Z'),
    )
  })

  it("blocks the staff member's time off and confirmed bookings", () => {
    const timeOff = getDayAvailability(
      context({
        staff: [
          {
            id: 'stf_a',
            workingHours: [{ weekday: 1, startMinute: 540, endMinute: 660 }],
            timeOff: [
              {
                startAt: unix('2026-11-16T01:00:00Z'),
                endAt: unix('2026-11-16T02:00:00Z'),
              },
            ],
          },
        ],
      }),
      60,
      MONDAY,
      MONDAY_EARLY_UTC,
    )

    expect(timeOff.slots[0]?.startAt).toBe(unix('2026-11-16T02:00:00Z'))
    expect(timeOff.slots).toHaveLength(1)

    const confirmed = getDayAvailability(
      context({
        confirmedAppointments: [
          {
            staffUserId: 'stf_a',
            startAt: unix('2026-11-16T01:00:00Z'),
            endAt: unix('2026-11-16T01:30:00Z'),
          },
        ],
      }),
      60,
      MONDAY,
      MONDAY_EARLY_UTC,
    )

    expect(confirmed.slots[0]?.startAt).toBe(unix('2026-11-16T01:30:00Z'))
  })

  it('chooses the least-loaded eligible staff member without changing duration', () => {
    const availability = getDayAvailability(
      context({
        staff: [
          {
            id: 'stf_a',
            workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
            timeOff: [],
          },
          {
            id: 'stf_b',
            workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
            timeOff: [],
          },
        ],
        confirmedAppointments: [
          {
            staffUserId: 'stf_a',
            startAt: unix('2026-11-16T01:00:00Z'),
            endAt: unix('2026-11-16T02:00:00Z'),
          },
        ],
      }),
      60,
      MONDAY,
      MONDAY_EARLY_UTC,
    )

    // 09:00–10:00 is full for stf_a, so stf_b covers the early slots.
    expect(availability.slots[0]).toMatchObject({
      staffId: 'stf_b',
      startAt: unix('2026-11-16T01:00:00Z'),
    })
    // 10:00 both are free; stf_b has zero load and wins the tie-break.
    expect(
      availability.slots.find(
        (slot) => slot.startAt === unix('2026-11-16T02:00:00Z'),
      )?.staffId,
    ).toBe('stf_b')
  })

  it('returns truthful states for past, outside-window, closed and full days', () => {
    expect(
      getDayAvailability(context(), 60, '2026-11-15', MONDAY_EARLY_UTC).state,
    ).toBe('past')
    expect(
      getDayAvailability(context(), 60, '2027-03-01', MONDAY_EARLY_UTC).state,
    ).toBe('outside-booking-window')
    expect(
      getDayAvailability(
        context({
          staff: [
            {
              id: 'stf_a',
              workingHours: [{ weekday: 2, startMinute: 540, endMinute: 1020 }],
              timeOff: [],
            },
          ],
        }),
        60,
        MONDAY,
        MONDAY_EARLY_UTC,
      ).state,
    ).toBe('closed')
    expect(
      getDayAvailability(
        context({
          staff: [
            {
              id: 'stf_a',
              workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
              timeOff: [
                {
                  startAt: unix('2026-11-16T00:00:00Z'),
                  endAt: unix('2026-11-16T15:00:00Z'),
                },
              ],
            },
          ],
        }),
        60,
        MONDAY,
        MONDAY_EARLY_UTC,
      ).state,
    ).toBe('full')
  })

  it('excludes starts that are not strictly in the future', () => {
    const atNineManila = new Date('2026-11-16T01:00:00Z')
    const availability = getDayAvailability(
      context(),
      60,
      MONDAY,
      atNineManila,
    )

    expect(availability.slots[0]?.startAt).toBe(unix('2026-11-16T01:15:00Z'))
  })
})

describe('findScheduleConflicts', () => {
  const appointment = {
    publicReference: 'SLO-TEST01',
    status: 'confirmed' as const,
    staffUserId: 'stf_a',
    startAt: unix('2026-11-16T02:00:00Z'), // 10:00 Manila
    endAt: unix('2026-11-16T03:00:00Z'),
    durationMinutes: 60,
  }

  function conflicts(input: {
    intervals?: Array<{ weekday: number; startMinute: number; endMinute: number }>
    timeOff?: Array<{ startAt: number; endAt: number }>
  }) {
    return findScheduleConflicts({
      timezone: MANILA,
      staffId: 'stf_a',
      intervals: input.intervals ?? [
        { weekday: 1, startMinute: 540, endMinute: 1020 },
      ],
      timeOff: input.timeOff ?? [],
      appointments: [appointment],
      now: MONDAY_EARLY_UTC,
    })
  }

  it('blocks working-hour changes that would invalidate a future booking', () => {
    expect(
      conflicts({
        intervals: [{ weekday: 1, startMinute: 540, endMinute: 600 }],
      }),
    ).toEqual([
      {
        publicReference: 'SLO-TEST01',
        status: 'confirmed',
        startAt: appointment.startAt,
      },
    ])
  })

  it('blocks time off that overlaps a future booking', () => {
    expect(
      conflicts({
        timeOff: [
          {
            startAt: unix('2026-11-16T02:30:00Z'),
            endAt: unix('2026-11-16T03:30:00Z'),
          },
        ],
      }),
    ).toHaveLength(1)
  })

  it('allows changes that keep the booking inside an interval', () => {
    expect(
      conflicts({
        intervals: [{ weekday: 1, startMinute: 600, endMinute: 660 }],
      }),
    ).toEqual([])
    expect(
      conflicts({
        timeOff: [
          {
            startAt: unix('2026-11-16T03:00:00Z'),
            endAt: unix('2026-11-16T04:00:00Z'),
          },
        ],
      }),
    ).toEqual([])
  })
})
