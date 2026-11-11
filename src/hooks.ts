import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AppBskyFeedDefs, AtpAgent } from '@atproto/api'
import {
  Arrivals,
  appendPage,
  cutAtGap,
  fetchColumn,
  mergePage,
  olderCursor,
  pollInterval,
  type ColumnConfig,
  type Entry,
} from './lib/columns'
import { playChime } from './lib/chime'
import { Poller, watchWake, type PollState } from './lib/poller'
import type { SessionManager, SessionStatus } from './lib/session'
import type { MediaView } from './components/Lightbox'

export type Session = SessionManager<AtpAgent>

export interface AppContext {
  session: Session
  compose(replyTo?: AppBskyFeedDefs.PostView): void
  quote(post: AppBskyFeedDefs.PostView): void
  openThread(uri: string): void
  /** Shows someone's profile; takes a DID or handle. */
  openProfile(actor: string): void
  viewMedia(media: MediaView): void
}

export const Ctx = createContext<AppContext | null>(null)

export function useApp(): AppContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('App context missing')
  return ctx
}

export function useSessionStatus(session: Session): SessionStatus {
  return useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => session.status,
  )
}

const TICK_MS = 5_000
let tickNow = Date.now()
let tickTimer: ReturnType<typeof setInterval> | undefined
const tickListeners = new Set<() => void>()

function subscribeTick(fn: () => void) {
  if (!tickTimer) {
    tickNow = Date.now()
    tickTimer = setInterval(() => {
      tickNow = Date.now()
      for (const l of tickListeners) l()
    }, TICK_MS)
  }
  tickListeners.add(fn)
  return () => {
    tickListeners.delete(fn)
    if (!tickListeners.size) {
      clearInterval(tickTimer)
      tickTimer = undefined
    }
  }
}

/**
 * The current time, re-rendering every few seconds so relative times ("12s ago") stay current.
 * One shared timer serves every caller, and only the small components that show a time use it,
 * so a tick does not re-render the posts themselves.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribeTick, () => tickNow)
}

export function useColumn(session: Session, config: ColumnConfig) {
  const [items, setItems] = useState<Entry[]>([])
  const [poll, setPoll] = useState<PollState>({ loading: true })
  const [loadingMore, setLoadingMore] = useState(false)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set())
  const poller = useRef<Poller | null>(null)
  const source = JSON.stringify(config)

  useEffect(() => {
    let live = true
    setItems([])
    setFresh(new Set())
    // Only notifications announce arrivals; a busy timeline would never stop.
    const arrivals = config.kind === 'notifications' ? new Arrivals() : null
    const p = new Poller(async () => {
      await session.ensure()
      const page = await fetchColumn(session.agent, config)
      session.noteSuccess()
      if (!live) return
      const added = arrivals?.note(page.items) ?? []
      if (added.length) {
        setFresh((old) => new Set([...old, ...added]))
        playChime()
      }
      // A feed ranks its posts however it likes, so a page of unfamiliar posts is not a gap there.
      setItems((old) => mergePage(page, old, { newestFirst: config.kind !== 'feed' }))
    }, pollInterval(config))
    p.onChange = (s) => live && setPoll(s)
    p.start()
    poller.current = p
    const offWake = watchWake(() => p.poke())
    const offSession = session.subscribe(() => {
      if (session.status === 'ok') p.poke()
    })
    return () => {
      live = false
      p.stop()
      offWake()
      offSession()
    }
    // `source` captures every field of `config`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, source])

  // Where the list ends decides what "Load older" fetches, so trimming the list or
  // reaching the last page can never leave a hole or start again from the top.
  const cursor = olderCursor(items)
  const loadMore = async () => {
    if (loadingMore || !cursor) return
    setLoadingMore(true)
    try {
      const page = await fetchColumn(session.agent, config, cursor)
      setItems((old) => appendPage(old, page))
    } catch {
      // The header already shows connection problems; the button stays for a retry.
    } finally {
      setLoadingMore(false)
    }
  }

  return {
    items,
    fresh,
    poll,
    loadingMore,
    hasMore: !!cursor,
    loadMore,
    /** Drops what is below a gap, so the missing posts are what loads next. */
    fillGap: (key: string) => setItems((old) => cutAtGap(old, key)),
    refresh: () => poller.current?.poke(),
  }
}
