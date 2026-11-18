/**
 * Account and schedule browser flows: staff time-off conflict blocking, adding
 * and removing free time off, a voluntary password change, and the forced
 * first-login password change.
 *
 * Local-only: it creates rows in the local D1 database. The forced-change user
 * comes from `scripts/ui-qa/fixtures/forced-password-user.sql`
 * (`npm run qa:ui:fixture`). Clean up with `npm run qa:ui:cleanup`.
 *
 *   npm run qa:ui:accounts
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE, OUT, launch } from './browser.mjs'
import { check, exitCode, fail, reportLines, summary } from './report.mjs'

async function goto(page, path) {
  await page.navigate(`${BASE}${path}`)
  await page
    .waitFor(`document.querySelector('h1')`, 20000, `heading on ${path}`)
    .catch(() => {})
  await page.sleep(300)
}

async function signIn(page, email, password) {
  await page.send('Network.clearBrowserCookies')
  await page.navigate(`${BASE}/signin`)
  await page.waitForText('Sign in')
  await page.fillByLabel('Email', email)
  await page.fillByLabel('Password', password)
  await page.evaluate(`document.querySelector('form button[type="submit"]').click()`)
  await page.sleep(2200)
}

/**
 * Creates a confirmed booking through the public API while signed in as admin,
 * so the flow does not depend on pre-existing seed appointments.
 */
async function createConfirmedBooking(page) {
  return page.evaluate(`(async () => {
    const call = async (path, options) => {
      const response = await fetch(path, { credentials: 'include', ...options });
      const body = await response.json().catch(() => null);
      return { status: response.status, body };
    };
    const headers = { 'Content-Type': 'application/json' };

    const services = await call('/api/public/services');
    const service = services.body?.data?.[0];
    if (!service) return { error: 'no public service' };

    // Walk forward through the booking window until a day with open slots.
    const month = await call('/api/public/availability/month?serviceId=' + service.id + '&month=' + new Date().toISOString().slice(0, 7));
    const days = (month.body?.data?.days ?? []).filter((day) => day.state === 'open');
    for (const day of days) {
      const availability = await call('/api/public/availability?serviceId=' + service.id + '&date=' + day.dateKey);
      const slot = (availability.body?.data?.slots ?? [])[0];
      if (!slot) continue;

      const created = await call('/api/public/bookings', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          serviceId: service.id,
          startAt: slot.startAt,
          guestName: 'QA Schedule Guest',
          guestEmail: 'qa-schedule@example.com',
        }),
      });
      if (created.status !== 201) return { error: 'booking failed', detail: created.body };
      const reference = created.body.data.appointment.publicReference;

      const approved = await call('/api/admin/appointments/' + reference + '/approve', {
        method: 'POST',
        headers,
        body: '{}',
      });
      if (approved.status !== 200) return { error: 'approval failed', detail: approved.body };
      const appointment = approved.body.data;
      return {
        reference: appointment.publicReference,
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        staffEmail: appointment.assignedStaff.email,
      };
    }
    return { error: 'no open slot in the booking window' };
  })()`)
}

/** Fills the time-off form by field label inside that form only. */
async function fillTimeOff(page, entries) {
  await page.evaluate(`(() => {
    const form = document.querySelector('form.timeoff-form');
    const values = ${JSON.stringify(entries)};
    for (const [label, value] of Object.entries(values)) {
      const el = [...form.querySelectorAll('input')].find((input) => {
        const own = input.labels && input.labels.length ? input.labels[0].innerText.trim() : '';
        return own.startsWith(label);
      });
      if (!el) continue;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`)
}

async function run(page) {
  await page.send('Network.clearBrowserCookies')
  await page.setViewport(1440)

  // ---------- Setup: an approved booking owned by one staff member ----------
  await signIn(page, 'admin@slotly.studio', 'slotly-demo')
  const business = await page.evaluate(
    `fetch('/api/public/business', { credentials: 'include' }).then((r) => r.json()).then((b) => b.data)`,
  )
  const timezone = business.businessTimezone
  const booking = await createConfirmedBooking(page)
  check('setup: confirmed booking created for the schedule check', !booking.error, JSON.stringify(booking).slice(0, 200))
  if (booking.error) return

  const localParts = (seconds) => {
    const dateKey = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(seconds * 1000))
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(seconds * 1000))
    return { dateKey, time }
  }

  const start = localParts(booking.startAt - 3600)
  const end = localParts(booking.endAt + 3600)

  // ---------- Staff time off ----------
  await signIn(page, booking.staffEmail, 'slotly-demo')
  check('availability: staff workspace loads', (await page.evaluate('location.pathname')) === '/staff')
  await goto(page, '/staff/availability')
  await page.waitForText('Weekly hours')
  check('availability: weekly hours + time off render', (await page.text()).includes('Time off'))
  await page.screenshot('flow-staff-availability-1440.png')

  if (start.dateKey === end.dateKey) {
    await fillTimeOff(page, {
      Date: start.dateKey,
      Start: start.time,
      End: end.time,
      Reason: 'QA conflict check',
    })
    await page.clickText('Add time off')
    await page.sleep(1600)
    const conflictText = await page.text()
    check(
      'availability: time off overlapping a confirmed booking is blocked',
      conflictText.includes('Existing appointments block this change') &&
        conflictText.includes(booking.reference),
      conflictText.slice(
        Math.max(0, conflictText.indexOf('That change was not saved')),
        Math.max(0, conflictText.indexOf('That change was not saved')) + 260,
      ),
    )
    await page.screenshot('flow-staff-availability-conflict.png')
  } else {
    check('availability: conflict check skipped (booking spans midnight)', false)
  }

  const freeStart = Math.floor(Date.now() / 1000) + 40 * 86400
  const free = localParts(freeStart)
  await fillTimeOff(page, {
    Date: free.dateKey,
    Start: '09:00',
    End: '10:00',
    Reason: 'QA availability check',
  })
  await page.clickText('Add time off')
  await page.sleep(1600)
  const added = await page.text()
  const addedAt = added.indexOf('Time off added')
  check(
    'availability: non-overlapping time off is added',
    addedAt >= 0,
    added.slice(Math.max(0, addedAt), Math.max(0, addedAt) + 120),
  )
  const removeButtons = await page.evaluate(`[...document.querySelectorAll('.timeoff-row button')].length`)
  check('availability: time off is listed with a remove action', removeButtons > 0, `buttons=${removeButtons}`)
  if (removeButtons > 0) {
    await page.evaluate(`document.querySelector('.timeoff-row button').click()`)
    await page.sleep(1600)
    const removed = await page.text()
    const removedAt = removed.indexOf('Time off removed')
    check(
      'availability: time off can be removed',
      removedAt >= 0,
      removed.slice(Math.max(0, removedAt), Math.max(0, removedAt) + 120),
    )
  }
  await page.screenshot('flow-staff-availability-after.png')

  // ---------- Voluntary password change ----------
  await page.send('Network.clearBrowserCookies')
  const email = `qa-${Date.now()}@example.com`
  const initial = 'qa-initial-pass'
  const updated = 'qa-updated-pass'
  await page.navigate(`${BASE}/signin`)
  await page.waitForText('Sign in')
  await page.clickText('Create account')
  await page.sleep(300)
  await page.fillByLabel('Full name', 'QA Password User')
  await page.fillByLabel('Email', email)
  await page.fillByLabel('Password', initial)
  await page.evaluate(`document.querySelector('form button[type="submit"]').click()`)
  await page.sleep(2500)
  check('password: registration signs in', (await page.evaluate('location.pathname')) === '/appointments')

  const navLink = await page.evaluate(
    `Boolean([...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/change-password'))`,
  )
  check('password: signed-in nav exposes change password', navLink)
  if (navLink) {
    await page.evaluate(
      `([...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/change-password')).click()`,
    )
    await page.waitForText('Change password')
    await page.waitFor(`document.querySelector('form button[type="submit"]')`, 10000, 'the password form')
    await page.fillByLabel('Current password', initial)
    await page.fillByLabel('New password', updated)
    await page.fillByLabel('Confirm new password', updated)
    await page.evaluate(`document.querySelector('form button[type="submit"]').click()`)
    await page.sleep(2500)
    check(
      'password: voluntary change returns to appointments',
      (await page.evaluate('location.pathname')) === '/appointments',
    )

    await signIn(page, email, updated)
    check('password: new password works', (await page.evaluate('location.pathname')) === '/appointments')
    await signIn(page, email, initial)
    check(
      'password: old password is rejected',
      (await page.evaluate('location.pathname')) === '/signin',
    )
  }

  // ---------- Forced first-login password change (fixture user) ----------
  await signIn(page, 'qa-forced@example.com', 'slotly-demo')
  const forcedPath = await page.evaluate('location.pathname')
  if (forcedPath !== '/change-password') {
    check(
      'forced: fixture user is missing',
      false,
      'run `npm run qa:ui:fixture` before this check',
    )
    return
  }
  check('forced: redirected to the password page', true)
  const flagged = await page.evaluate(
    `fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()).then((b) => b.data?.mustChangePassword)`,
  )
  check('forced: session still flagged before the change', flagged === true, String(flagged))
  await page.screenshot('flow-forced-password.png')

  await page.fillByLabel('Temporary password', 'slotly-demo')
  await page.fillByLabel('New password', 'qa-forced-new-pass')
  await page.fillByLabel('Confirm new password', 'qa-forced-new-pass')
  await page.evaluate(`document.querySelector('form button[type="submit"]').click()`)
  await page.sleep(3000)
  check(
    'forced: lands in appointments after saving',
    (await page.evaluate('location.pathname')) === '/appointments',
  )
  const cleared = await page.evaluate(
    `fetch('/api/auth/me', { credentials: 'include' }).then((r) => r.json()).then((b) => b.data?.mustChangePassword)`,
  )
  check('forced: flag cleared after the change', cleared === false, String(cleared))
  await page.screenshot('flow-forced-after.png')
}

const page = await launch()
try {
  await run(page)
} catch (error) {
  fail('accounts', error)
} finally {
  await writeFile(join(OUT, 'accounts.log'), reportLines())
  await page.close()
}

summary()
process.exit(exitCode())
