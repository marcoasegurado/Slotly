/**
 * Local PBKDF2 benchmark for the password hashing parameters in
 * `worker/auth/password.ts`.
 *
 * This measures Node's WebCrypto on the development machine. It is a sanity
 * check only: workerd caps PBKDF2 at 100,000 iterations and production hashing
 * runs inside the PasswordHasher Durable Object, not the request Worker.
 *
 * Usage:
 *   npm run auth:bench
 *   npm run auth:bench -- 10
 */
import {
  hashPassword,
  PBKDF2_ITERATIONS,
  verifyPassword,
} from '../worker/auth/password'

const iterations = Math.max(1, Number(process.argv[2] ?? 5) || 5)
const sampleHash = await hashPassword('slotly-benchmark-not-a-credential')

const hashDurations: number[] = []
for (let index = 0; index < iterations; index += 1) {
  const start = performance.now()
  await hashPassword('slotly-benchmark-not-a-credential')
  hashDurations.push(performance.now() - start)
}

const verifyDurations: number[] = []
for (let index = 0; index < iterations; index += 1) {
  const start = performance.now()
  await verifyPassword('slotly-benchmark-not-a-credential', sampleHash)
  verifyDurations.push(performance.now() - start)
}

function summarize(label: string, durations: number[]): void {
  const total = durations.reduce((sum, value) => sum + value, 0)
  const average = total / durations.length
  const min = Math.min(...durations)
  const max = Math.max(...durations)
  console.log(
    `${label}: avg ${average.toFixed(1)} ms, min ${min.toFixed(1)} ms, max ${max.toFixed(1)} ms (${durations.length} runs)`,
  )
}

console.log(`PBKDF2-HMAC-SHA-256 iterations: ${PBKDF2_ITERATIONS}`)
summarize('hash  ', hashDurations)
summarize('verify', verifyDurations)
console.log(
  'Compare these numbers with the CPU limit of the Cloudflare Workers plan before deploying.',
)
