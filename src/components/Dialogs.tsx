import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { RichText, type AppBskyFeedDefs } from '@atproto/api'
import { useApp, type Session } from '../hooks'
import { parseFeedRef, type ColumnConfig } from '../lib/columns'
import { newId } from '../lib/settings'
import { Avatar, displayName } from './PostCard'

const MAX_GRAPHEMES = 300

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong.'
}

const openModals: object[] = []

/** Escape calls `onClose` only for the topmost open dialog or preview. */
export function useEscape(onClose?: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const id = {}
    openModals.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals.at(-1) === id) close.current?.()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      openModals.splice(openModals.indexOf(id), 1)
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}

function Modal({ title, onClose, children }: { title: string; onClose?: () => void; children: ReactNode }) {
  useEscape(onClose)
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function Login({ session, expired }: { session: Session; expired?: boolean }) {
  const [handle, setHandle] = useState(session.handle)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await session.login(handle.trim().replace(/^@/, ''), password)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const looksLikeAppPassword = /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/.test(password)

  return (
    <Modal title={expired ? 'Sign in again' : 'Sign in to Bluesky'}>
      {expired && <p className="error">Your Bluesky login expired, so the columns have stopped updating.</p>}
      <form onSubmit={submit}>
        <label>
          Handle
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="you.bsky.social"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </label>
        <label>
          App password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="xxxx-xxxx-xxxx-xxxx"
            autoComplete="current-password"
            required
          />
        </label>
        <p className="muted small">
          Use an{' '}
          <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noreferrer noopener">
            app password
          </a>
          , not your main password. It is sent only to Bluesky and is not stored; this browser keeps the login
          token Bluesky returns.
        </p>
        {password && !looksLikeAppPassword && (
          <p className="error small">That does not look like an app password (xxxx-xxxx-xxxx-xxxx).</p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="buttons">
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function Composer({ replyTo, onClose }: { replyTo?: AppBskyFeedDefs.PostView; onClose(): void }) {
  const { session } = useApp()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const left = MAX_GRAPHEMES - new RichText({ text }).graphemeLength
  const canSend = !busy && text.trim().length > 0 && left >= 0

  const send = async () => {
    if (!canSend) return
    setBusy(true)
    setError('')
    try {
      const rt = new RichText({ text: text.trim() })
      await rt.detectFacets(session.agent)
      const parent = replyTo && { uri: replyTo.uri, cid: replyTo.cid }
      // A reply to a reply keeps the original thread root.
      const root = (replyTo?.record as { reply?: { root?: { uri: string; cid: string } } } | undefined)?.reply?.root
      await session.agent.post({
        text: rt.text,
        facets: rt.facets,
        reply: parent && { root: root ?? parent, parent },
        langs: [navigator.language.split('-')[0]],
      })
      onClose()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title={replyTo ? 'Reply' : 'New post'} onClose={busy ? undefined : onClose}>
      {replyTo && (
        <div className="quote">
          <div className="byline">
            <Avatar author={replyTo.author} small />
            <strong>{displayName(replyTo.author)}</strong>
          </div>
          <div className="body muted">{(replyTo.record as { text?: string }).text}</div>
        </div>
      )}
      <textarea
        autoFocus
        rows={6}
        value={text}
        placeholder={replyTo ? 'Write your reply' : "What's up?"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
      />
      {error && <p className="error">{error}</p>}
      <div className="buttons">
        <span className={left < 0 ? 'error' : 'muted'}>{left}</span>
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={send} disabled={!canSend} title="⌘/Ctrl + Enter">
          {busy ? 'Posting…' : replyTo ? 'Reply' : 'Post'}
        </button>
      </div>
    </Modal>
  )
}

export function AddColumn({ onAdd, onClose }: { onAdd(c: ColumnConfig): void; onClose(): void }) {
  const { session } = useApp()
  const [kind, setKind] = useState<ColumnConfig['kind']>('search')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const id = newId()
      if (kind === 'home') onAdd({ id, kind, title: 'Home' })
      else if (kind === 'notifications') onAdd({ id, kind, title: 'Notifications' })
      else if (kind === 'search') onAdd({ id, kind, title: value.trim(), query: value.trim() })
      else {
        const agent = session.agent
        const feed = await parseFeedRef(value, async (handle) => (await agent.resolveHandle({ handle })).data.did)
        const info = await agent.app.bsky.feed.getFeedGenerator({ feed })
        onAdd({ id, kind, title: info.data.view.displayName, feed })
      }
      onClose()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Add column" onClose={onClose}>
      <form onSubmit={submit}>
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as ColumnConfig['kind'])}>
            <option value="search">Search</option>
            <option value="feed">Feed</option>
            <option value="home">Home timeline</option>
            <option value="notifications">Notifications</option>
          </select>
        </label>
        {(kind === 'search' || kind === 'feed') && (
          <label>
            {kind === 'search' ? 'Search for' : 'Feed link'}
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === 'search' ? 'words or #hashtag' : 'https://bsky.app/profile/…/feed/…'}
              required
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <div className="buttons">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Add
          </button>
        </div>
      </form>
    </Modal>
  )
}
