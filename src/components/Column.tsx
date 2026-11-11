import { Component, useMemo, useState, type ReactNode } from 'react'
import { Ctx, useApp, useColumn, useNow } from '../hooks'
import { itemId, type ColumnConfig } from '../lib/columns'
import { NotifCard, PostCard } from './PostCard'
import { Panel } from './Panel'
import { Profile } from './Profile'
import { Thread } from './Thread'

type View = { kind: 'thread'; uri: string } | { kind: 'profile'; actor: string }

interface Props {
  config: ColumnConfig
  onMove(delta: -1 | 1): void
  onRemove(): void
}

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

/**
 * Keeps a failure while drawing one column (a post in a shape the app did not expect, say)
 * from blanking the whole deck.
 */
class ColumnBoundary extends Component<{ title: string; onRemove(): void; children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="column">
        <header>
          <div className="title">
            <h2>{this.props.title}</h2>
          </div>
          <div className="health error" role="alert">
            This column stopped working
          </div>
        </header>
        <div className="gap">
          <span className="muted">{this.state.error.message || 'Something in it could not be shown.'}</span>
          <button type="button" onClick={() => this.setState({ error: undefined })}>
            Reload column
          </button>
          <button type="button" onClick={this.props.onRemove}>
            Remove column
          </button>
        </div>
      </section>
    )
  }
}

export function Column(props: Props) {
  return (
    <ColumnBoundary title={props.config.title} onRemove={props.onRemove}>
      <ColumnView {...props} />
    </ColumnBoundary>
  )
}

function ColumnView({ config, onMove, onRemove }: Props) {
  const app = useApp()
  const { session } = app
  const { items, fresh, poll, loadMore, loadingMore, hasMore, refresh, fillGap } = useColumn(session, config)
  const now = useNow()

  // A clicked post or name opens a thread or profile inside this column. The
  // trail lets Back retrace each step before returning to the column itself.
  const [trail, setTrail] = useState<View[]>([])
  const ctx = useMemo(
    () => ({
      ...app,
      openThread: (uri: string) => setTrail((t) => [...t, { kind: 'thread', uri }]),
      openProfile: (actor: string) => setTrail((t) => [...t, { kind: 'profile', actor }]),
    }),
    [app],
  )
  const view = trail[trail.length - 1]
  const shown = items.filter((i) => i.kind === 'post' || i.kind === 'notif').length

  // The health line is the point of this app: a column that has stopped
  // updating must say so rather than quietly showing old posts.
  // The age changes every few seconds, so only the error is announced to screen readers;
  // announcing the age too would have every column talking without pause.
  const age = poll.lastSuccess ? `updated ${ago(now - poll.lastSuccess)} ago` : poll.error ? '' : 'loading…'

  return (
    <section className="column">
      {/* Clicking the header (but not its buttons) scrolls back to the top of
          whatever the column is showing: its posts, or an open thread. */}
      <header
        title="Back to top"
        onClick={(e) => {
          if ((e.target as Element).closest('button')) return
          const views = e.currentTarget.parentElement?.querySelectorAll('.body-area .scroll')
          views?.[views.length - 1]?.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      >
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
        <div className={poll.error ? 'health error' : 'health muted'}>
          <span role="status">{poll.error}</span>
          {poll.error && age ? ` · last ${age}` : age}
        </div>
      </header>
      <Ctx.Provider value={ctx}>
        <div className="body-area">
          {/* The column's posts stay mounted underneath so its scroll position survives. */}
          <div className="scroll">
            {/* Keyed by state, so a like group that gains someone is highlighted afresh. */}
            {items.map((item) =>
              item.kind === 'post' ? (
                <PostCard key={itemId(item)} item={item} fresh={fresh.has(itemId(item))} />
              ) : item.kind === 'notif' ? (
                <NotifCard key={itemId(item)} item={item} fresh={fresh.has(itemId(item))} />
              ) : item.kind === 'gap' ? (
                // Saying so matters more than looking seamless: what is below is older than it appears.
                <div key={item.key} className="gap">
                  <span className="muted">More arrived than was loaded, so posts are missing here.</span>
                  <button type="button" onClick={() => fillGap(item.key)}>
                    Continue from here
                  </button>
                </div>
              ) : null,
            )}
            {shown === 0 && poll.lastSuccess && <p className="empty muted">Nothing here yet.</p>}
            {hasMore && shown > 0 && (
              <button type="button" className="more" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? 'Loading…' : 'Load older'}
              </button>
            )}
          </div>
          {view && (
            <Panel
              // A fresh panel per step, so each view starts at its own top.
              key={trail.length}
              title={view.kind === 'thread' ? 'Thread' : 'Profile'}
              onBack={() => setTrail((t) => t.slice(0, -1))}
              onClose={() => setTrail([])}
            >
              {view.kind === 'thread' ? <Thread uri={view.uri} /> : <Profile actor={view.actor} />}
            </Panel>
          )}
        </div>
      </Ctx.Provider>
    </section>
  )
}
