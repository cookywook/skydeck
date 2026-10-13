export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export interface PollState {
  loading: boolean
  lastSuccess?: number
  error?: string
}

const MAX_BACKOFF_MS = 120_000

/**
 * Runs `fn` on an interval, forever. A failed or hung request never ends the
 * loop: errors back off and retry, and a request that has not settled within
 * `timeoutMs` (for example one that was in flight when the machine slept) is
 * abandoned.
 */
export class Poller {
  state: PollState = { loading: false }
  onChange?: (state: PollState) => void

  private timer: unknown
  private running = false
  private again = false
  private stopped = true
  private failures = 0

  constructor(
    private fn: () => Promise<void>,
    private intervalMs: number,
    private clock: Clock = realClock,
    private timeoutMs = 30_000,
  ) {}

  start() {
    if (!this.stopped) return
    this.stopped = false
    void this.run()
  }

  stop() {
    this.stopped = true
    this.clock.clearTimeout(this.timer)
  }

  /** Poll now rather than waiting for the next tick (used after wake and on demand). */
  poke() {
    if (this.stopped) return
    if (this.running) {
      this.again = true
      return
    }
    this.clock.clearTimeout(this.timer)
    void this.run()
  }

  private async run(): Promise<void> {
    this.running = true
    this.set({ ...this.state, loading: true })
    try {
      await this.withTimeout(this.fn())
      this.failures = 0
      this.set({ loading: false, lastSuccess: this.clock.now() })
    } catch (e) {
      this.failures++
      this.set({
        loading: false,
        lastSuccess: this.state.lastSuccess,
        error: e instanceof Error ? e.message : String(e),
      })
    }
    this.running = false
    if (this.stopped) return
    if (this.again) {
      this.again = false
      return void this.run()
    }
    const delay = this.failures
      ? Math.min(this.intervalMs * 2 ** this.failures, MAX_BACKOFF_MS)
      : this.intervalMs
    this.timer = this.clock.setTimeout(() => void this.run(), delay)
  }

  private withTimeout(p: Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const h = this.clock.setTimeout(() => reject(new Error('Request timed out')), this.timeoutMs)
      p.then(
        () => {
          this.clock.clearTimeout(h)
          resolve()
        },
        (e) => {
          this.clock.clearTimeout(h)
          reject(e)
        },
      )
    })
  }

  private set(state: PollState) {
    this.state = state
    this.onChange?.(state)
  }
}

/**
 * Calls `cb` when the machine has probably just woken: a heartbeat that fires
 * far later than scheduled means timers were suspended. Returns a stop function.
 */
export function watchClockGap(cb: () => void, clock: Clock = realClock, beatMs = 5_000, gapMs = 90_000) {
  let last = clock.now()
  let handle: unknown
  let stopped = false
  const beat = () => {
    if (stopped) return
    const now = clock.now()
    if (now - last > gapMs) cb()
    last = now
    handle = clock.setTimeout(beat, beatMs)
  }
  handle = clock.setTimeout(beat, beatMs)
  return () => {
    stopped = true
    clock.clearTimeout(handle)
  }
}

/** Browser wiring: wake from sleep, window shown again, or network back. */
export function watchWake(cb: () => void): () => void {
  const stopGap = watchClockGap(cb)
  const onVisible = () => {
    if (document.visibilityState === 'visible') cb()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', cb)
  return () => {
    stopGap()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', cb)
  }
}
