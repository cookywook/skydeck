import { useMemo, useState } from 'react'
import { Ctx, useApp, useColumn, useNow } from '../hooks'
import { itemId, type ColumnConfig } from '../lib/columns'
import { NotifCard, PostCard } from './PostCard'
import { Thread } from './Thread'

interface Props {
  config: ColumnConfig
  onMove(delta: -1 | 1): void
  onRemove(): void
}

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

export function Column({ config, onMove, onRemove }: Props) {
  const app = useApp()
  const { session } = app
  const { items, fresh, poll, loadMore, loadingMore, hasMore, refresh } = useColumn(session, config)
  const now = useNow(5_000)

  // A clicked post opens its thread inside this column. The trail lets Back
  // retrace posts opened from within a thread before returning to the column.
  const [trail, setTrail] = useState<string[]>([])
  const ctx = useMemo(() => ({ ...app, openThread: (uri: string) => setTrail((t) => [...t, uri]) }), [app])

  // The health line is the point of this app: a column that has stopped
  // updating must say so rather than quietly showing old posts.
  const health = poll.error
    ? `${poll.error}${poll.lastSuccess ? ` · last updated ${ago(now - poll.lastSuccess)} ago` : ''}`
    : poll.lastSuccess
      ? `updated ${ago(now - poll.lastSuccess)} ago`
      : 'loading…'

  return (
    <section className="column">
      <header>
        <div className="title">
          <h2>{config.title}</h2>
          <span className="tools">
            <button type="button" title="Refresh now" onClick={refresh}>
              ↻
            </button>
            <button type="button" title="Move left" onClick={() => onMove(-1)}>
              ‹
            </button>
            <button type="button" title="Move right" onClick={() => onMove(1)}>
              ›
            </button>
            <button type="button" title="Remove column" onClick={onRemove}>
              ×
            </button>
          </span>
        </div>
        <div className={poll.error ? 'health error' : 'health muted'} role="status">
          {health}
        </div>
      </header>
      <Ctx.Provider value={ctx}>
        <div className="body-area">
          {/* The column's posts stay mounted underneath so its scroll position survives. */}
          <div className="scroll">
            {/* Keyed by state, so a like group that gains someone is highlighted afresh. */}
            {items.map((item) =>
              item.kind === 'post' ? (
                <PostCard key={itemId(item)} item={item} now={now} fresh={fresh.has(itemId(item))} />
              ) : (
                <NotifCard key={itemId(item)} item={item} now={now} fresh={fresh.has(itemId(item))} />
              ),
            )}
            {items.length === 0 && poll.lastSuccess && <p className="empty muted">Nothing here yet.</p>}
            {hasMore && items.length > 0 && (
              <button type="button" className="more" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? 'Loading…' : 'Load older'}
              </button>
            )}
          </div>
          {trail.length > 0 && (
            <Thread uri={trail[trail.length - 1]} onBack={() => setTrail((t) => t.slice(0, -1))} onClose={() => setTrail([])} />
          )}
        </div>
      </Ctx.Provider>
    </section>
  )
}
