import { describe, expect, it } from 'vitest'
import type { AtpPersistSessionHandler, AtpSessionData } from '@atproto/api'
import { SessionManager, SessionStore, type AgentLike } from './session'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

function sess(refreshJwt: string): AtpSessionData {
  return { refreshJwt, accessJwt: `access-${refreshJwt}`, handle: 'me.test', did: 'did:plc:me', active: true }
}

/** A fake server: `valid` is the set of refresh tokens it still accepts. */
class FakeAgent implements AgentLike {
  valid = new Set<string>()
  online = true
  resumed: string[] = []
  persist!: AtpPersistSessionHandler

  async login() {
    const s = sess('fresh-login')
    this.valid.add(s.refreshJwt)
    await this.persist('create', s)
  }

  async resumeSession(s: AtpSessionData) {
    this.resumed.push(s.refreshJwt)
    if (!this.online) {
      await this.persist('network-error', s)
      throw new Error('fetch failed')
    }
    if (!this.valid.has(s.refreshJwt)) {
      await this.persist('expired', undefined)
      throw new Error('ExpiredToken')
    }
  }
}

function setup() {
  const storage = memoryStorage()
  const store = new SessionStore(storage)
  const agent = new FakeAgent()
  const make = () =>
    new SessionManager(store, (persist) => {
      agent.persist = persist
      return agent
    })
  return { store, agent, make }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('SessionManager', () => {
  it('is signed out when nothing is stored', async () => {
    const { make } = setup()
    const m = make()
    await m.start()
    expect(m.status).toBe('signed-out')
  })

  it('stores the session on login and resumes it on the next start', async () => {
    const { make, store } = setup()
    const first = make()
    await first.start()
    await first.login('me.test', 'pw')
    expect(first.status).toBe('ok')
    expect(store.load()?.refreshJwt).toBe('fresh-login')

    const second = make()
    await second.start()
    expect(second.status).toBe('ok')
  })

  it('saves renewed tokens', async () => {
    const { make, store, agent } = setup()
    const m = make()
    await m.login('me.test', 'pw')
    await agent.persist('update', sess('renewed'))
    expect(store.load()?.refreshJwt).toBe('renewed')
    expect(m.status).toBe('ok')
  })

  it('reports expiry instead of carrying on when the refresh token is rejected', async () => {
    const { make, store, agent } = setup()
    store.save(sess('spent'))
    const m = make()
    await m.start()
    await settle()
    expect(m.status).toBe('expired')
    expect(store.load()).toBeNull()
    await expect(m.ensure()).rejects.toThrow(/expired/i)
    expect(agent.resumed).toEqual(['spent'])
  })

  it('recovers with the stored session when another window already renewed it', async () => {
    const { make, store, agent } = setup()
    store.save(sess('old'))
    agent.valid.add('old')
    const m = make()
    await m.start()
    expect(m.status).toBe('ok')

    // Another window renews: the server now only accepts the new token.
    agent.valid = new Set(['new'])
    store.save(sess('new'))
    // This window's next request finds its own token rejected.
    await agent.persist('expired', undefined)
    await settle()

    expect(m.status).toBe('ok')
    expect(agent.resumed).toEqual(['old', 'new'])
    expect(store.load()?.refreshJwt).toBe('new')
  })

  it('expires when the stored session is the same rejected one', async () => {
    const { make, store, agent } = setup()
    store.save(sess('old'))
    agent.valid.add('old')
    const m = make()
    await m.start()
    agent.valid.clear()
    await agent.persist('expired', undefined)
    await settle()
    expect(m.status).toBe('expired')
    expect(agent.resumed).toEqual(['old'])
  })

  it('goes offline without discarding the session, then recovers', async () => {
    const { make, store, agent } = setup()
    store.save(sess('good'))
    agent.valid.add('good')
    agent.online = false
    const m = make()
    await m.start()
    expect(m.status).toBe('offline')
    expect(store.load()?.refreshJwt).toBe('good')
    await expect(m.ensure()).rejects.toThrow(/reach/i)

    agent.online = true
    await m.ensure()
    expect(m.status).toBe('ok')
  })

  it('returns to ok when a request succeeds after a network error', async () => {
    const { make, agent } = setup()
    const m = make()
    await m.login('me.test', 'pw')
    await agent.persist('network-error', sess('fresh-login'))
    expect(m.status).toBe('offline')
    m.noteSuccess()
    expect(m.status).toBe('ok')
  })

  it('follows a sign-out or renewal made in another window', async () => {
    const { make, store, agent } = setup()
    const m = make()
    await m.login('me.test', 'pw')

    agent.valid.add('other-window')
    store.save(sess('other-window'))
    await m.syncFromStore()
    expect(agent.resumed).toEqual(['other-window'])
    expect(m.status).toBe('ok')

    store.clear()
    await m.syncFromStore()
    expect(m.status).toBe('signed-out')
  })

  it('notifies subscribers once per status change', async () => {
    const { make } = setup()
    const m = make()
    const seen: string[] = []
    m.subscribe(() => seen.push(m.status))
    await m.start()
    await m.login('me.test', 'pw')
    await m.logout()
    expect(seen).toEqual(['signed-out', 'ok', 'signed-out'])
  })
})
