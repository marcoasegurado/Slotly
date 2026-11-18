/**
 * Dependency-free browser driver for Slotly's local UI QA.
 *
 * It speaks the Chrome DevTools Protocol directly over Node's built-in
 * WebSocket (Node 22+), so the repository needs no Playwright/Puppeteer
 * dependency. It only drives a real Chromium-family browser against a locally
 * running app; it never touches remote Cloudflare resources.
 *
 * Environment:
 *   CHROME_PATH   Path to chrome.exe / msedge.exe / Google Chrome binary.
 *   QA_BASE_URL   App origin. Default: http://localhost:5173
 *   QA_PORT       Remote debugging port. Default: 9333
 *   QA_OUT        Artifact directory. Default: <cwd>/qa-artifacts
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export const BASE = process.env.QA_BASE_URL ?? 'http://localhost:5173'
export const OUT = process.env.QA_OUT ?? join(process.cwd(), 'qa-artifacts')
const PORT = Number(process.env.QA_PORT ?? 9333)
const PROFILE = join(tmpdir(), 'slotly-qa-profile')

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)

function resolveChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error(
      'No Chrome/Edge binary found. Set CHROME_PATH to a Chromium-based browser.',
    )
  }
  return found
}

/** Launches headless Chrome and attaches to its first page target. */
export async function launch() {
  await mkdir(PROFILE, { recursive: true })
  await mkdir(OUT, { recursive: true })

  const child = spawn(
    resolveChrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1440,960',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let target
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await response.json()
      target = list.find((entry) => entry.type === 'page')
      if (target) break
    } catch {
      // Browser is still starting.
    }
    await sleep(250)
  }
  if (!target) throw new Error('Chrome debugging target never became available')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let nextId = 1
  const pending = new Map()
  let events = []

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    } else if (message.method) {
      events.push(message)
    }
  })

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${result.exceptionDetails.text} ${
          result.exceptionDetails.exception?.description ?? ''
        }`,
      )
    }
    return result.result.value
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Network.enable')
  await send('DOM.enable')

  const setViewport = (width, height = width < 600 ? 844 : 960) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 600,
    })

  const navigate = async (url) => {
    events = []
    const loaded = new Promise((resolve) => {
      const onMessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.method === 'Page.loadEventFired') {
          ws.removeEventListener('message', onMessage)
          resolve()
        }
      }
      ws.addEventListener('message', onMessage)
    })
    await send('Page.navigate', { url })
    await Promise.race([loaded, sleep(15000)])
    // The app renders a boot screen while public settings and the session
    // probe resolve; wait it out so assertions read the real page.
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const booting = await evaluate(
        `document.body ? document.body.innerText.includes('Loading Slotly') : true`,
      )
      if (!booting) break
      await sleep(150)
    }
    await sleep(250)
  }

  const waitFor = async (expression, timeout = 15000, label = expression) => {
    const started = Date.now()
    while (Date.now() - started < timeout) {
      if (await evaluate(`Boolean(${expression})`)) return true
      await sleep(120)
    }
    throw new Error(`Timed out waiting for ${label}`)
  }

  const waitForText = (text, timeout = 15000) =>
    waitFor(
      `document.body && document.body.innerText.includes(${JSON.stringify(text)})`,
      timeout,
      `text ${JSON.stringify(text)}`,
    )

  const screenshot = async (name) => {
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    })
    await writeFile(join(OUT, name), Buffer.from(data, 'base64'))
  }

  /**
   * Collects console, log and network problems for the last navigation.
   *
   * Two responses are normal operation and are not defects:
   * - a signed-out session probe answers 401 from `/api/auth/me`
   * - an unknown/used guest-cancellation token answers 404
   */
  const consoleIssues = () => {
    const isExpected = (url = '', status = 0) =>
      (url.includes('/api/auth/me') && status === 401) ||
      (url.includes('/api/public/guest-cancellation/') && status === 404) ||
      url.includes('favicon')

    const expectedUrls = new Set(
      events
        .filter((event) => event.method === 'Network.responseReceived')
        .filter((event) =>
          isExpected(event.params.response.url, event.params.response.status),
        )
        .map((event) => event.params.response.url),
    )

    const issues = []
    for (const event of events) {
      if (
        event.method === 'Runtime.consoleAPICalled' &&
        event.params.type === 'error'
      ) {
        issues.push(
          `console.error: ${event.params.args
            .map((arg) => arg.value ?? arg.description ?? arg.type)
            .join(' ')}`,
        )
      }
      if (event.method === 'Runtime.exceptionThrown') {
        issues.push(
          `exception: ${
            event.params.exceptionDetails.exception?.description ??
            event.params.exceptionDetails.text
          }`,
        )
      }
      if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
        const url = event.params.entry.url ?? ''
        if (!expectedUrls.has(url) && !isExpected(url)) {
          issues.push(`log: ${event.params.entry.text} ${url}`.trim())
        }
      }
      if (event.method === 'Network.loadingFailed' && !event.params.canceled) {
        issues.push(`network: ${event.params.errorText} ${event.params.type}`)
      }
      if (event.method === 'Network.responseReceived') {
        const { status, url } = event.params.response
        if (status >= 400 && !isExpected(url, status)) {
          issues.push(`http ${status}: ${url}`)
        }
      }
    }
    return [...new Set(issues)]
  }

  const setValue = (selector, value) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)

  const fillByLabel = (label, value) =>
    evaluate(`(() => {
      const wanted = ${JSON.stringify(label)};
      const fields = [...document.querySelectorAll('input, textarea, select')];
      const el = fields.find((field) => {
        const own = field.labels && field.labels.length
          ? [...field.labels].map((entry) => entry.innerText.trim()).join(' ')
          : '';
        return own.includes(wanted) || field.getAttribute('aria-label') === wanted;
      });
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.focus();
      return true;
    })()`)

  const click = (selector) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`)

  const clickText = (text, tag = 'button') =>
    evaluate(`(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(tag)})]
        .find((el) => el.innerText.trim() === ${JSON.stringify(text)} || el.innerText.trim().startsWith(${JSON.stringify(text)}));
      if (!node) return false;
      node.click();
      return true;
    })()`)

  const press = async (key) => {
    const mapping = {
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    }
    const info = mapping[key]
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...info })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...info })
    await sleep(60)
  }

  const activeElement = () =>
    evaluate(`(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName,
        text: (el.innerText || '').trim().slice(0, 60),
        label: el.getAttribute('aria-label'),
        id: el.id,
        insideDialog: Boolean(el.closest('[role="dialog"]')),
      };
    })()`)

  const text = () => evaluate('document.body.innerText')

  const close = async () => {
    try {
      await send('Browser.close')
    } catch {
      // Already closing.
    }
    ws.close()
    child.kill()
  }

  return {
    send,
    evaluate,
    navigate,
    waitFor,
    waitForText,
    screenshot,
    consoleIssues,
    setValue,
    fillByLabel,
    press,
    activeElement,
    text,
    click,
    clickText,
    setViewport,
    sleep,
    close,
  }
}
