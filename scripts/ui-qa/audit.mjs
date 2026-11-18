/**
 * Signed-out page audit at 390/768/1440: heading structure, duplicate ids,
 * unlabeled fields, unnamed controls, image alt text, horizontal overflow and
 * console/network noise. Run with a local Worker + Vite dev server.
 *
 *   npm run qa:ui:audit
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BASE, OUT, launch } from './browser.mjs'
import { check, exitCode, fail, reportLines, summary } from './report.mjs'

const AUDIT = `(() => {
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const accessibleName = (el) => {
    const label = el.labels && el.labels.length ? el.labels[0].innerText : '';
    return (el.getAttribute('aria-label') || label || el.getAttribute('title') || '').trim();
  };
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

  const unlabeledFields = [...document.querySelectorAll('input, select, textarea')]
    .filter((el) => visible(el) && el.type !== 'hidden')
    .filter((el) => !accessibleName(el))
    .map((el) => el.outerHTML.slice(0, 120));

  const namelessControls = [...document.querySelectorAll('button, a[href]')]
    .filter(visible)
    .filter((el) => !(el.innerText || '').trim() && !el.getAttribute('aria-label') && !el.getAttribute('title'))
    .map((el) => el.outerHTML.slice(0, 140));

  const imagesMissingAlt = [...document.querySelectorAll('img')].filter((el) => !el.hasAttribute('alt')).length;

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(visible)
    .map((el) => Number(el.tagName[1]));

  const headingJumps = [];
  for (let i = 1; i < headings.length; i += 1) {
    if (headings[i] - headings[i - 1] > 1) headingJumps.push(headings[i - 1] + '->' + headings[i]);
  }

  const overflow = {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };

  return {
    title: document.title,
    h1: [...document.querySelectorAll('h1')].map((el) => el.innerText.trim()),
    duplicateIds,
    unlabeledFields,
    namelessControls,
    imagesMissingAlt,
    headingJumps,
    overflow,
  };
})()`

async function main() {
  const services = await fetch(`${BASE}/api/public/services`).then((r) => r.json())
  const serviceId = services.data?.[0]?.id
  if (!serviceId) throw new Error('No public service found; seed local D1 first.')

  const startAt = Math.floor(Date.now() / 1000) + 86400
  const routes = [
    ['landing', '/'],
    ['book', '/book'],
    ['datetime', `/book/${serviceId}`],
    ['details', `/book/${serviceId}/details?start=${startAt}`],
    ['signin', '/signin'],
    ['change-password', '/change-password'],
    ['appointments', '/appointments'],
    ['guest-cancel-invalid', '/cancel/not-a-real-token'],
    ['staff', '/staff'],
    ['admin', '/admin'],
    ['not-found', '/does-not-exist'],
  ]

  const page = await launch()
  try {
    await page.send('Network.clearBrowserCookies')
    const results = []
    for (const [name, path] of routes) {
      for (const width of [1440, 768, 390]) {
        await page.setViewport(width)
        await page.navigate(`${BASE}${path}`)
        await page.sleep(700)
        const audit = await page.evaluate(AUDIT).catch((error) => ({ error: String(error) }))
        results.push({ name, path, width, ...audit, issues: page.consoleIssues() })
        if ([390, 1440].includes(width)) {
          await page.screenshot(`${name}-${width}.png`)
        }
      }
    }
    await writeFile(join(OUT, 'audit.json'), JSON.stringify(results, null, 2))

    for (const result of results) {
      const problems = []
      if (result.error) problems.push(result.error)
      if (result.h1 && result.h1.length !== 1) {
        problems.push(`h1 count=${result.h1.length} ${JSON.stringify(result.h1)}`)
      }
      if (result.duplicateIds?.length) problems.push(`duplicate ids: ${result.duplicateIds.join(',')}`)
      if (result.unlabeledFields?.length) problems.push(`unlabeled fields: ${result.unlabeledFields.join(' | ')}`)
      if (result.namelessControls?.length) problems.push(`nameless controls: ${result.namelessControls.join(' | ')}`)
      if (result.imagesMissingAlt) problems.push(`images without alt: ${result.imagesMissingAlt}`)
      if (result.headingJumps?.length) problems.push(`heading jumps: ${result.headingJumps.join(',')}`)
      if (result.overflow?.horizontal) {
        problems.push(`horizontal overflow ${result.overflow.scrollWidth} > ${result.overflow.clientWidth}`)
      }
      if (result.issues?.length) problems.push(`console/network: ${result.issues.join(' ; ')}`)

      check(`${result.name} @${result.width}`, problems.length === 0, problems.join(' | '))
    }
  } catch (error) {
    fail('signed-out audit', error)
  } finally {
    await writeFile(join(OUT, 'audit.log'), reportLines())
    await page.close()
  }

  summary()
  process.exit(exitCode())
}

main().catch((error) => {
  fail('signed-out audit', error)
  process.exit(1)
})
