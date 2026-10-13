import { describe, expect, it } from 'vitest'
import { Poller, watchClockGap, type Clock } from './poller'

/** A manual clock: timers fire only when the test advances time. */
class FakeClock implements Clock {
  t = 0
  private seq = 0
  private timers = new Map<number, { at: number; fn: () => void }>()

  now = () => this.t
  setTimeout = (fn: () => void, ms: number) => {
    this.timers.set(++this.seq, { at: this.t + ms, fn })
    return this.seq
  }
  clearTimeout = (h: unknown) => void this.timers.delete(h as number)

  /** Moves time forward, firing due timers in order and letting promises settle between them. */
  async advance(ms: number) {
    const end = this.t + ms
    for (;;) {
      await flush()
      const due = [...this.timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      this.timers.delete(due[0])
      this.t = Math.max(this.t, due[1].at)
      due[1].fn()
    }
    this.t = end
    await flush()
  }

  /** Jumps the clock without firing anything in between, as a sleeping machine does. */
  sleep(ms: number) {
    this.t += ms
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('Poller', () => {
  it('polls immediately and then on the interval', async () => {
    const clock = new FakeClock()
    let calls = 0
    const p = new Poller(async () => void calls++, 15_000, clock)
    p.start()
    await clock.advance(0)
    expect(calls).toBe(1)
    await clock.advance(45_000)
    expect(calls).toBe(4)
    expect(p.state).toMatchObject({ loading: false, lastSuccess: 45_000 })
    expect(p.state.error).toBeUndefined()
  })

  it('keeps polling after errors, backing off, and clears the error on success', async () => {
    const clock = new FakeClock()
    let calls = 0
    let failing = true
    const p = new Poller(
      async () => {
        calls++
        if (failing) throw new Error('boom')
      },
      15_000,
      clock,
    )
    p.start()
    await clock.advance(0)
    expect(p.state.error).toBe('boom')
    await clock.advance(30_000) // first retry after 30s
    expect(calls).toBe(2)
    await clock.advance(60_000) // second after 60s
    expect(calls).toBe(3)
    await clock.advance(600_000) // capped at 120s from here on
    expect(calls).toBe(8)

    failing = false
    await clock.advance(120_000)
    expect(p.state.error).toBeUndefined()
    const before = calls
    await clock.advance(15_000)
    expect(calls).toBe(before + 1)
  })

  it('remembers the last success while failing', async () => {
    const clock = new FakeClock()
    let failing = false
    const p = new Poller(
      async () => {
        if (failing) throw new Error('down')
      },
      15_000,
      clock,
    )
    p.start()
    await clock.advance(15_000)
    failing = true
    await clock.advance(15_000)
    expect(p.state).toMatchObject({ error: 'down', lastSuccess: 15_000 })
  })

  it('abandons a request that never settles and carries on', async () => {
    const clock = new FakeClock()
    let calls = 0
    const p = new Poller(() => (++calls === 1 ? new Promise<void>(() => {}) : Promise.resolve()), 15_000, clock, 30_000)
    p.start()
    await clock.advance(29_000)
    expect(p.state.loading).toBe(true)
    await clock.advance(1_000)
    expect(p.state.error).toBe('Request timed out')
    await clock.advance(30_000)
    expect(calls).toBe(2)
    expect(p.state.error).toBeUndefined()
  })

  it('polls at once when poked, and restarts the interval from there', async () => {
    const clock = new FakeClock()
    let calls = 0
    const p = new Poller(async () => void calls++, 60_000, clock)
    p.start()
    await clock.advance(10_000)
    p.poke()
    await clock.advance(0)
    expect(calls).toBe(2)
    await clock.advance(59_000)
    expect(calls).toBe(2)
    await clock.advance(1_000)
    expect(calls).toBe(3)
  })

  it('runs once more after an in-flight request when poked meanwhile', async () => {
    const clock = new FakeClock()
    let calls = 0
    let release!: () => void
    const p = new Poller(
      () => {
        calls++
        return calls === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve()
      },
      60_000,
      clock,
    )
    p.start()
    await clock.advance(0)
    p.poke()
    p.poke()
    expect(calls).toBe(1)
    release()
    await clock.advance(0)
    expect(calls).toBe(2)
  })

  it('stops', async () => {
    const clock = new FakeClock()
    let calls = 0
    const p = new Poller(async () => void calls++, 15_000, clock)
    p.start()
    await clock.advance(0)
    p.stop()
    p.poke()
    await clock.advance(120_000)
    expect(calls).toBe(1)
  })
})

describe('watchClockGap', () => {
  it('fires after the clock jumps, as it does when the machine wakes', async () => {
    const clock = new FakeClock()
    let wakes = 0
    const stop = watchClockGap(() => wakes++, clock)
    await clock.advance(60_000)
    expect(wakes).toBe(0)

    clock.sleep(8 * 3600_000)
    await clock.advance(5_000)
    expect(wakes).toBe(1)

    await clock.advance(60_000)
    expect(wakes).toBe(1)
    stop()
    clock.sleep(3600_000)
    await clock.advance(10_000)
    expect(wakes).toBe(1)
  })
})
