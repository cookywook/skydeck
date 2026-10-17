import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppBskyFeedDefs } from '@atproto/api'
import { Column } from './components/Column'
import { AddColumn, Composer, Login } from './components/Dialogs'
import { Lightbox, type MediaView } from './components/Lightbox'
import { Ctx, useSessionStatus, type Session } from './hooks'
import type { ColumnConfig } from './lib/columns'
import { isMuted, setMuted } from './lib/chime'
import { statusMessage } from './lib/session'
import { exportColumns, loadColumns, parseColumns, saveColumns } from './lib/settings'

type Draft = { replyTo?: AppBskyFeedDefs.PostView; quote?: AppBskyFeedDefs.PostView }

export function App({ session }: { session: Session }) {
  const status = useSessionStatus(session)
  const [columns, setColumns] = useState<ColumnConfig[]>(() => loadColumns(localStorage))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState('')
  const [muted, setMutedState] = useState(isMuted)
  const [media, setMedia] = useState<MediaView | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => saveColumns(localStorage, columns), [columns])

  // Another window of the app signed in, out, or renewed the login.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'skydeck.session') void session.syncFromStore()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [session])

  const ctx = useMemo(
    () => ({
      session,
      compose: (replyTo?: AppBskyFeedDefs.PostView) => setDraft({ replyTo }),
      quote: (quote: AppBskyFeedDefs.PostView) => setDraft({ quote }),
      // Each column supplies its own; outside a column there is nowhere to show a thread.
      openThread: () => {},
      viewMedia: setMedia,
    }),
    [session],
  )

  if (status === 'loading') return <p className="splash muted">Connecting…</p>
  if (status === 'signed-out') return <Login session={session} />

  const move = (index: number, delta: -1 | 1) =>
    setColumns((cols) => {
      const to = index + delta
      if (to < 0 || to >= cols.length) return cols
      const next = [...cols]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportColumns(columns)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'skydeck-columns.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    try {
      setColumns(parseColumns(await file.text()))
      setNotice('')
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not read that file.')
    }
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <nav className="sidebar">
          <button type="button" className="primary" title="New post" onClick={() => setDraft({})}>
            ✎
          </button>
          <button type="button" title="Add column" onClick={() => setAdding(true)}>
            ＋
          </button>
          <button
            type="button"
            title={muted ? 'Notification sound is off' : 'Notification sound is on'}
            aria-pressed={!muted}
            className={muted ? 'dim' : ''}
            onClick={() => {
              setMuted(!muted)
              setMutedState(!muted)
            }}
          >
            {muted ? '🔕' : '🔔'}
          </button>
          <span className="spacer" />
          <button type="button" title="Export columns to a file" onClick={download}>
            ⤓
          </button>
          <button type="button" title="Import columns from a file" onClick={() => fileInput.current?.click()}>
            ⤒
          </button>
          <button type="button" title={`Sign out @${session.handle}`} onClick={() => void session.logout()}>
            ⏻
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void importFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </nav>
        <main>
          {(status === 'offline' || notice) && (
            <div className="banner" role="alert">
              {notice || statusMessage(status)}
            </div>
          )}
          <div className="columns">
            {columns.map((c, i) => (
              <Column
                key={c.id}
                config={c}
                onMove={(d) => move(i, d)}
                onRemove={() => setColumns((cols) => cols.filter((x) => x.id !== c.id))}
              />
            ))}
            {columns.length === 0 && <p className="splash muted">No columns. Add one with ＋.</p>}
          </div>
        </main>
        {media && <Lightbox media={media} onClose={() => setMedia(null)} />}
        {draft && <Composer replyTo={draft.replyTo} quote={draft.quote} onClose={() => setDraft(null)} />}
        {adding && <AddColumn onAdd={(c) => setColumns((cols) => [...cols, c])} onClose={() => setAdding(false)} />}
        {status === 'expired' && <Login session={session} expired />}
      </div>
    </Ctx.Provider>
  )
}
