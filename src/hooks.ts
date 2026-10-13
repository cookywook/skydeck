import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AppBskyFeedDefs, AtpAgent } from '@atproto/api'
import { appendItems, fetchColumn, mergeItems, pollInterval, type ColumnConfig, type Item } from './lib/columns'
import { Poller, watchWake, type PollState } from './lib/poller'
import type { SessionManager, SessionStatus } from './lib/session'

export type Session = SessionManager<AtpAgent>

export interface AppContext {
  session: Session
  compose(replyTo?: AppBskyFeedDefs.PostView): void
  openThread(uri: string): void
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

/** Re-renders on an interval so relative times ("12s ago") stay current. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(h)
  }, [intervalMs])
  return now
}

export function useColumn(session: Session, config: ColumnConfig) {
  const [items, setItems] = useState<Item[]>([])
  const [poll, setPoll] = useState<PollState>({ loading: true })
  const [loadingMore, setLoadingMore] = useState(false)
  const cursor = useRef<string | undefined>(undefined)
  const poller = useRef<Poller | null>(null)
  const source = JSON.stringify(config)

  useEffect(() => {
    let live = true
    setItems([])
    cursor.current = undefined
    const p = new Poller(async () => {
      await session.ensure()
      const page = await fetchColumn(session.agent, config)
      session.noteSuccess()
      if (!live) return
      setItems((old) => mergeItems(page.items, old))
      cursor.current ??= page.cursor
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

  const loadMore = async () => {
    if (loadingMore || !cursor.current) return
    setLoadingMore(true)
    try {
      const page = await fetchColumn(session.agent, config, cursor.current)
      cursor.current = page.cursor
      setItems((old) => appendItems(old, page.items))
    } catch {
      // The header already shows connection problems; the button stays for a retry.
    } finally {
      setLoadingMore(false)
    }
  }

  return {
    items,
    poll,
    loadingMore,
    hasMore: !!cursor.current,
    loadMore,
    refresh: () => poller.current?.poke(),
  }
}
