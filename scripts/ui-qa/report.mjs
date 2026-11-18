/** Tiny assertion/reporting helper shared by the UI QA scripts. */
const lines = []
let failures = 0

export function check(name, condition, detail = '') {
  const ok = Boolean(condition)
  if (!ok) failures += 1
  const suffix = detail
    ? ` — ${String(detail).replace(/\s+/g, ' ').slice(0, 170)}`
    : ''
  const line = `${ok ? 'PASS' : 'FAIL'} ${name}${suffix}`
  console.log(line)
  lines.push(line)
  return ok
}

export function fail(name, error) {
  failures += 1
  const line = `HARNESS ERROR ${name}: ${error?.stack ?? error}`
  console.error(line)
  lines.push(line)
}

export function summary() {
  console.log(`\n${failures} failure(s)`)
  return failures
}

export function exitCode() {
  return failures ? 1 : 0
}

export function reportLines() {
  return lines.join('\n')
}
