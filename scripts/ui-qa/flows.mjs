/**
 * End-to-end browser flows against the local API: guest booking, private
 * cancellation, customer account, staff review, admin management, responsive
 * layouts and dialog keyboard containment.
 *
 * Prerequisites: local D1 migrated and seeded, `npm run dev:worker` on 8787 and
 * `npm run dev` on 5173. This creates real rows in the local database.
 *
 *   npm run qa:ui:flows
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
  await page.sleep(2000)
}

async function clickEnabled(page, pattern, label) {
  await page.waitFor(
    `[...document.querySelectorAll('button')].some((b) => ${pattern}.test(b.innerText) && !b.disabled)`,
    15000,
    label,
  )
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((entry) => ${pattern}.test(entry.innerText) && !entry.disabled);
    button.click();
    return true;
  })()`)
}

/** Chooses a service and books the first slot on a day the API marks available. */
async function fillBooking(page, details) {
  await goto(page, '/book')
  await page.waitFor(
    `[...document.querySelectorAll('button.service-row')].length > 0`,
    20000,
    'service rows',
  )
  await page.evaluate(`(() => {
    const row = [...document.querySelectorAll('button.service-row')]
      .find((entry) => entry.innerText.includes(${JSON.stringify(details.service)}));
    row.click();
    return true;
  })()`)
  await clickEnabled(page, '/Continue to time/', 'continue to time')
  await page.waitForText('Pick a date and time')
  await page.waitFor(
    `document.querySelector('button.day:not([disabled])')`,
    20000,
    'a bookable day',
  )

  const pickAvailableDay = () =>
    page.evaluate(`(() => {
      const open = [...document.querySelectorAll('button.day:not([disabled])')]
        .find((day) => /available/i.test(day.getAttribute('aria-label') || ''));
      if (!open) return null;
      open.click();
      return open.getAttribute('aria-label');
    })()`)

  if (!(await pickAvailableDay())) {
    // The visible month can be exhausted after repeated runs; move forward.
    await page.evaluate(`(() => {
      const next = [...document.querySelectorAll('button')]
        .find((b) => /Next month/i.test(b.getAttribute('aria-label') || ''));
      if (next) next.click();
      return true;
    })()`)
    await page.sleep(900)
    await page.waitFor(
      `[...document.querySelectorAll('button.day:not([disabled])')].some((day) => /available/i.test(day.getAttribute('aria-label') || ''))`,
      20000,
      'an available day next month',
    )
    await pickAvailableDay()
  }

  await page.waitFor(
    `document.querySelector('button.slot:not([disabled])')`,
    15000,
    'a time slot',
  )
  await page.evaluate(`document.querySelector('button.slot:not([disabled])').click()`)
  await clickEnabled(page, '/Continue to details/', 'continue to details')
  await page.waitFor(
    `document.querySelector('form button[type="submit"]')`,
    20000,
    'the details form',
  )
  if (details.name) await page.fillByLabel('Full name', details.name)
  if (details.email) await page.fillByLabel('Email', details.email)
  await page.evaluate(`document.querySelector('form button[type="submit"]').click()`)
  await page.waitForText('SLO-', 20000)
  await page.sleep(400)

  const text = await page.text()
  const reference = (text.match(/SLO-[A-Z0-9]+/) ?? [null])[0]
  const cancelHref = await page.evaluate(`(() => {
    const link = [...document.querySelectorAll('a')]
      .find((entry) => entry.getAttribute('href')?.startsWith('/cancel/'));
    return link ? link.getAttribute('href') : null;
  })()`)
  return { text, reference, cancelHref }
}

/** Tabs around a dialog and reports whether focus ever escaped it. */
async function dialogContainsFocus(page, repeats = 14) {
  const trail = []
  let inside = true
  for (let index = 0; index < repeats; index += 1) {
    await page.press('Tab')
    const active = await page.activeElement()
    trail.push(`${active?.tag}:${(active?.text || active?.label || active?.id || '').slice(0, 20)}`)
    if (!active?.insideDialog) inside = false
  }
  return { inside, trail: trail.join(' > ') }
}

async function run(page) {
  await page.send('Network.clearBrowserCookies')
  await page.setViewport(1440)

  // ---------- 1. Guest booking + private cancellation ----------
  const guest = await fillBooking(page, {
    service: 'Extended session',
    name: 'QA Guest',
    email: 'qa-guest@example.com',
  })
  check('guest: request received with a reference', Boolean(guest.reference), guest.reference)
  check('guest: private cancellation link present', Boolean(guest.cancelHref), guest.cancelHref)
  await page.screenshot('flow-guest-received.png')

  if (guest.cancelHref) {
    await page.navigate(`${BASE}${guest.cancelHref}`)
    await page.waitForText('Cancel this appointment?')
    const meta = await page.evaluate(`(() => ({
      robots: document.querySelector('meta[name="robots"]')?.content ?? null,
      referrer: document.querySelector('meta[name="referrer"]')?.content ?? null,
      headings: document.querySelectorAll('h1').length,
    }))()`)
    check(
      'cancel: private-link meta + heading',
      meta.robots === 'noindex, nofollow' && meta.referrer === 'no-referrer' && meta.headings === 1,
      JSON.stringify(meta),
    )
    await page.clickText('Cancel this request')
    await page.waitForText('Request cancelled')
    check('cancel: pending request cancelled', true)
    await page.navigate(`${BASE}${guest.cancelHref}`)
    await page.waitForText('This link is no longer available')
    check('cancel: link is single use', true)
    check(
      'cancel: unavailable state has an h1',
      (await page.evaluate(`document.querySelectorAll('h1').length`)) === 1,
    )
  }

  // ---------- 2. Customer account ----------
  await signIn(page, 'maria@example.com', 'slotly-demo')
  check(
    'customer: lands on appointments',
    (await page.evaluate('location.pathname')) === '/appointments',
  )

  const customerBooking = await fillBooking(page, { service: 'Standard appointment' })
  check('customer: signed-in booking succeeds', Boolean(customerBooking.reference), customerBooking.reference)
  check(
    'customer: no guest cancellation link for a signed-in booking',
    customerBooking.cancelHref === null,
  )

  await goto(page, '/appointments')
  await page.waitFor(
    `document.querySelectorAll('a[href^="/appointments/"]').length > 0`,
    15000,
    'appointment links',
  )
  const customerLinks = await page.evaluate(
    `[...document.querySelectorAll('a[href^="/appointments/"]')].map((a) => a.getAttribute('href'))`,
  )
  check(
    'customer: history lists the new booking',
    customerLinks.some((href) => href.endsWith(customerBooking.reference)),
    customerLinks.join(','),
  )
  await page.screenshot('flow-customer-appointments.png')

  await goto(page, `/appointments/${customerBooking.reference}`)
  await page.waitForText(customerBooking.reference)
  const cancelOpened = await page.evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button')].find((entry) => /cancel/i.test(entry.innerText));
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`)
  check('customer: cancel dialog opens', cancelOpened)
  if (cancelOpened) {
    await page.sleep(400)
    const trap = await dialogContainsFocus(page)
    check('customer dialog: focus stays inside', trap.inside, trap.trail)
    await page.press('Escape')
    await page.sleep(300)
    check(
      'customer dialog: Escape closes',
      await page.evaluate(`!document.querySelector('[role="dialog"]')`),
    )
  }
  await page.screenshot('flow-customer-detail.png')

  // ---------- 3. Pending requests for the staff flow ----------
  const declineTarget = await fillBooking(page, {
    service: 'Initial consultation',
    name: 'QA Decline Guest',
    email: 'qa-decline@example.com',
  })
  check('setup: decline target created', Boolean(declineTarget.reference), declineTarget.reference)

  const approveTarget = await fillBooking(page, {
    service: 'Standard appointment',
    name: 'QA Approve Guest',
    email: 'qa-approve@example.com',
  })
  check('setup: approve target created', Boolean(approveTarget.reference), approveTarget.reference)

  // ---------- 4. Staff workspace ----------
  // Staff only see their own assignments, so resolve each owner through the
  // admin API before signing in as that staff member.
  await signIn(page, 'admin@slotly.studio', 'slotly-demo')
  const owners = await page.evaluate(`(async () => {
    const refs = ${JSON.stringify([declineTarget.reference, approveTarget.reference])};
    const out = {};
    for (const ref of refs) {
      const response = await fetch('/api/admin/appointments/' + ref, { credentials: 'include' });
      const body = await response.json();
      out[ref] = body.data?.assignedStaff?.email ?? null;
    }
    return out;
  })()`)
  const declineOwner = owners[declineTarget.reference]
  const approveOwner = owners[approveTarget.reference]
  check(
    'setup: both requests resolved to staff owners',
    Boolean(declineOwner && approveOwner),
    JSON.stringify(owners),
  )

  await signIn(page, declineOwner ?? 'ana@slotly.studio', 'slotly-demo')
  check('staff: lands in staff workspace', (await page.evaluate('location.pathname')) === '/staff')
  await page.waitForText('Dashboard')
  await page.screenshot('flow-staff-dashboard.png')

  await goto(page, '/staff/appointments')
  await page.waitFor(
    `document.querySelectorAll('a[href^="/staff/appointments/"]').length > 0`,
    15000,
    'staff appointment links',
  )
  const staffLinks = await page.evaluate(
    `[...document.querySelectorAll('a[href^="/staff/appointments/"]')].map((a) => a.getAttribute('href'))`,
  )
  check('staff: queue lists assigned requests', staffLinks.length > 0, staffLinks.join(','))
  await page.screenshot('flow-staff-queue.png')

  await goto(page, `/staff/appointments/${declineTarget.reference}`)
  await page.waitForText(declineTarget.reference)
  await page.setViewport(390)
  await page.sleep(500)
  const detailProbe = await page.evaluate(`(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))()`)
  check(
    'staff detail @390: no horizontal overflow',
    detailProbe.scroll <= detailProbe.client + 1,
    JSON.stringify(detailProbe),
  )
  await page.screenshot('flow-staff-detail-390.png')

  const declineOpened = await page.evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button')].find((entry) => /decline request/i.test(entry.innerText));
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`)
  check('staff: decline dialog opens', declineOpened)
  if (declineOpened) {
    await page.sleep(400)
    const trap = await dialogContainsFocus(page)
    check('staff dialog: focus stays inside', trap.inside, trap.trail)
    const fits = await page.evaluate(`(() => {
      const sheet = document.querySelector('[role="dialog"]');
      if (!sheet) return null;
      const rect = sheet.getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), viewport: innerHeight };
    })()`)
    check(
      'staff dialog @390: fits the viewport',
      fits && fits.top >= 0 && fits.bottom <= fits.viewport + 1,
      JSON.stringify(fits),
    )
    await page.screenshot('flow-staff-decline-390.png')
    await page.press('Escape')
    await page.sleep(300)
    check(
      'staff dialog: Escape closes',
      await page.evaluate(`!document.querySelector('[role="dialog"]')`),
    )

    // Decline for real through the dialog.
    await page.evaluate(`(() => {
      const trigger = [...document.querySelectorAll('button')].find((entry) => /decline request/i.test(entry.innerText));
      trigger.click();
      return true;
    })()`)
    await page.sleep(400)
    await page.evaluate(`(() => {
      const field = document.querySelector('[role="dialog"] textarea');
      const proto = HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, 'Automated QA decline');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`)
    await page.evaluate(`(() => {
      const sheet = document.querySelector('[role="dialog"]');
      const button = [...sheet.querySelectorAll('button')].find((entry) => /decline request/i.test(entry.innerText));
      button.click();
      return true;
    })()`)
    await page.sleep(2000)
    const declined = await page.text()
    check('staff: decline persists a rejected status', /rejected/i.test(declined), declined.slice(0, 160))
    await page.screenshot('flow-staff-declined.png')
  }
  await page.setViewport(1440)

  if (approveOwner && approveOwner !== declineOwner) {
    await signIn(page, approveOwner, 'slotly-demo')
  }
  await goto(page, `/staff/appointments/${approveTarget.reference}`)
  await page.waitForText(approveTarget.reference)
  const approveClicked = await page.evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button')].find((entry) => /approve appointment/i.test(entry.innerText));
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`)
  check('staff: approve action available', approveClicked)
  if (approveClicked) {
    await page.waitForText('Appointment confirmed', 15000).catch(() => {})
    await page.sleep(800)
    const approved = await page.text()
    check('staff: approve persists a confirmed status', /confirmed/i.test(approved), approved.slice(0, 160))
    await page.screenshot('flow-staff-approved.png')
  }

  // ---------- 5. Admin workspace ----------
  await signIn(page, 'admin@slotly.studio', 'slotly-demo')
  check('admin: lands in admin workspace', (await page.evaluate('location.pathname')) === '/admin')
  await page.waitForText('Dashboard')
  await page.screenshot('flow-admin-dashboard.png')

  await goto(page, '/admin/appointments')
  await page.waitFor(
    `document.querySelectorAll('a[href^="/admin/appointments/"]').length > 0`,
    15000,
    'admin appointment links',
  )
  const adminLinks = await page.evaluate(
    `[...document.querySelectorAll('a[href^="/admin/appointments/"]')].map((a) => a.getAttribute('href'))`,
  )
  check('admin: appointment queue lists bookings', adminLinks.length > 0, `count=${adminLinks.length}`)
  check(
    'admin: queue includes the staff-approved booking',
    adminLinks.some((href) => href.endsWith(approveTarget.reference)),
  )
  await page.screenshot('flow-admin-appointments.png')

  await goto(page, `/admin/appointments/${approveTarget.reference}`)
  await page.waitForText(approveTarget.reference)
  const adminForm = await page.evaluate(`(() => ({
    reschedule: /Reschedule/.test(document.body.innerText),
    reassign: Boolean([...document.querySelectorAll('label')].find((label) => /staff/i.test(label.innerText))),
  }))()`)
  check(
    'admin: reschedule + reassignment controls render',
    adminForm.reschedule && adminForm.reassign,
    JSON.stringify(adminForm),
  )
  const adminCancelOpened = await page.evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button')].find((entry) => /cancel appointment|cancel pending request/i.test(entry.innerText));
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`)
  check('admin: cancel dialog opens', adminCancelOpened)
  if (adminCancelOpened) {
    await page.sleep(400)
    const trap = await dialogContainsFocus(page)
    check('admin dialog: focus stays inside', trap.inside, trap.trail)
    await page.press('Escape')
    await page.sleep(300)
  }
  await page.screenshot('flow-admin-detail.png')

  await goto(page, '/admin/services')
  await page.waitForText('Services')
  const serviceForm = await page.evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button')].find((entry) => /new service|add service/i.test(entry.innerText));
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`)
  check('admin: new-service form opens', serviceForm)
  if (serviceForm) {
    await page.sleep(400)
    const fields = await page.evaluate(`(() => {
      const visible = (el) => el.getBoundingClientRect().height > 0;
      const inputs = [...document.querySelectorAll('input, textarea, select')].filter(visible);
      const unlabeled = inputs.filter((el) => {
        const label = el.labels && el.labels.length ? el.labels[0].innerText.trim() : '';
        return !label && !el.getAttribute('aria-label');
      });
      return { inputs: inputs.length, unlabeled: unlabeled.map((el) => el.outerHTML.slice(0, 60)) };
    })()`)
    check(
      'admin: service form fields are labelled',
      fields.unlabeled.length === 0,
      JSON.stringify(fields),
    )
  }
  await page.screenshot('flow-admin-services.png')

  // ---------- 6. Responsive + unnamed-control checks ----------
  for (const [name, path] of [
    ['admin-dashboard', '/admin'],
    ['admin-services', '/admin/services'],
    ['admin-appointments', '/admin/appointments'],
    ['staff-dashboard', '/staff'],
    ['staff-availability', '/staff/availability'],
    ['staff-queue', '/staff/appointments'],
  ]) {
    for (const width of [390, 768, 1440]) {
      await page.setViewport(width)
      await goto(page, path)
      const probe = await page.evaluate(`(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
        h1s: document.querySelectorAll('h1').length,
        unnamed: [...document.querySelectorAll('button, a[href]')]
          .filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .filter((el) => !(el.innerText || '').trim() && !el.getAttribute('aria-label') && !el.getAttribute('title')).length,
      }))()`)
      check(
        `${name} @${width}`,
        probe.scroll <= probe.client + 1 && probe.unnamed === 0 && probe.h1s === 1,
        JSON.stringify(probe),
      )
      if ([390, 1440].includes(width)) {
        await page.screenshot(`${name}-${width}.png`)
      }
    }
  }
}

const page = await launch()
try {
  await run(page)
} catch (error) {
  fail('flows', error)
} finally {
  await writeFile(join(OUT, 'flows.log'), reportLines())
  await page.close()
}

summary()
process.exit(exitCode())
