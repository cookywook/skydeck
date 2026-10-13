import type { AtpPersistSessionHandler, AtpSessionData, AtpSessionEvent } from '@atproto/api'

export type SessionStatus = 'loading' | 'signed-out' | 'ok' | 'offline' | 'expired'

/** The parts of AtpAgent the session manager relies on (narrow so tests can fake it). */
export interface AgentLike {
  login(opts: { identifier: string; password: string }): Promise<unknown>
  resumeSession(session: AtpSessionData): Promise<unknown>
  logout?(): Promise<unknown>
}

const SESSION_KEY = 'skydeck.session'
const HANDLE_KEY = 'skydeck.handle'

export class SessionStore {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}

  load(): AtpSessionData | null {
    try {
      const raw = this.storage.getItem(SESSION_KEY)
      return raw ? (JSON.parse(raw) as AtpSessionData) : null
    } catch {
      return null
    }
  }

  save(session: AtpSessionData) {
    this.storage.setItem(SESSION_KEY, JSON.stringify(session))
    this.storage.setItem(HANDLE_KEY, session.handle)
  }

  clear() {
    this.storage.removeItem(SESSION_KEY)
  }

  lastHandle(): string {
    return this.storage.getItem(HANDLE_KEY) ?? ''
  }
}

/**
 * Owns the Bluesky login for this browser profile.
 *
 * Refresh tokens are single-use, so a copy of the app that was asleep or in
 * another window can wake up holding one that has already been spent. When a
 * refresh is rejected we therefore re-read the stored session before giving
 * up, and if there is nothing newer we say so (`expired`) instead of carrying
 * on with stale columns.
 */
export class SessionManager<A extends AgentLike> {
  readonly agent: A
  status: SessionStatus = 'loading'

  private held: AtpSessionData | null = null
  private recovering = false
  private sawNetworkError = false
  private resuming: Promise<void> | null = null
  private listeners = new Set<() => void>()

  constructor(
    private store: SessionStore,
    makeAgent: (persist: AtpPersistSessionHandler) => A,
  ) {
    this.agent = makeAgent((evt, session) => this.onPersist(evt, session))
  }

  get handle(): string {
    return this.held?.handle ?? this.store.lastHandle()
  }

  get did(): string | undefined {
    return this.held?.did
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  async start(): Promise<void> {
    const saved = this.store.load()
    if (!saved) return this.setStatus('signed-out')
    await this.resume(saved)
  }

  async login(identifier: string, password: string): Promise<void> {
    await this.agent.login({ identifier, password })
    // A successful login always fires 'create', which sets status to 'ok'.
  }

  async logout(): Promise<void> {
    this.store.clear()
    this.held = null
    this.setStatus('signed-out')
    try {
      await this.agent.logout?.()
    } catch {
      // The server-side session lapses on its own if this fails.
    }
  }

  /** Call before a request: retries the login if we are offline, throws if signed out. */
  async ensure(): Promise<void> {
    if (this.status === 'ok') return
    if (this.status === 'offline') {
      const saved = this.store.load()
      if (saved) await this.resume(saved)
    }
    // resume() may have changed the status, which the compiler cannot see.
    const status = this.status as SessionStatus
    if (status !== 'ok') throw new Error(statusMessage(status))
  }

  /** A request succeeded, so the network is back even if no session event said so. */
  noteSuccess() {
    if (this.status === 'offline') this.setStatus('ok')
  }

  /** Another window changed the stored session: pick up its tokens or its sign-out. */
  async syncFromStore(): Promise<void> {
    const saved = this.store.load()
    if (!saved) {
      if (this.status !== 'signed-out' && this.status !== 'expired') {
        this.held = null
        this.setStatus('signed-out')
      }
      return
    }
    if (saved.refreshJwt !== this.held?.refreshJwt) await this.resume(saved)
  }

  private resume(session: AtpSessionData): Promise<void> {
    this.resuming ??= (async () => {
      this.held = session
      this.sawNetworkError = false
      try {
        await this.agent.resumeSession(session)
        if (this.status !== 'expired') this.setStatus('ok')
      } catch {
        // 'expired' and 'network-error' events have already set the status;
        // anything else (a failure with no event) is treated as offline.
        if (this.status === 'loading' || this.status === 'ok') this.setStatus('offline')
      } finally {
        this.resuming = null
      }
    })()
    return this.resuming
  }

  private onPersist(evt: AtpSessionEvent, session: AtpSessionData | undefined) {
    switch (evt) {
      case 'create':
      case 'update':
        if (session) {
          this.held = session
          this.store.save(session)
          this.setStatus('ok')
        }
        break
      case 'network-error':
        this.sawNetworkError = true
        this.setStatus('offline')
        break
      case 'expired':
        void this.recover()
        break
      case 'create-failed':
        break
    }
  }

  private async recover(): Promise<void> {
    if (this.recovering) return
    this.recovering = true
    try {
      const stored = this.store.load()
      if (stored && stored.refreshJwt !== this.held?.refreshJwt) {
        this.held = stored
        this.sawNetworkError = false
        try {
          await this.agent.resumeSession(stored)
          this.setStatus('ok')
          return
        } catch {
          if (this.sawNetworkError) return // status is 'offline'; ensure() will retry
        }
      }
      this.store.clear()
      this.setStatus('expired')
    } finally {
      this.recovering = false
    }
  }

  private setStatus(status: SessionStatus) {
    if (status === this.status) return
    this.status = status
    for (const fn of this.listeners) fn()
  }
}

export function statusMessage(status: SessionStatus): string {
  switch (status) {
    case 'expired':
      return 'Your Bluesky login has expired. Sign in again.'
    case 'signed-out':
      return 'Signed out.'
    case 'offline':
      return 'Cannot reach Bluesky. Retrying.'
    case 'loading':
      return 'Connecting.'
    case 'ok':
      return ''
  }
}
