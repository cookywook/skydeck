import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { RichText, type AppBskyFeedDefs } from '@atproto/api'
import { useApp, type Session } from '../hooks'
import { parseFeedRef, type ColumnConfig } from '../lib/columns'
import { MAX_IMAGES, postEmbed, prepareImage, type PreparedImage } from '../lib/images'
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

interface ModalProps {
  title: string
  onClose?: () => void
  /** Files dropped onto the dialog. */
  onFiles?: (files: File[]) => void
  children: ReactNode
}

function Modal({ title, onClose, onFiles, children }: ModalProps) {
  useEscape(onClose)
  const takesFiles = (e: DragEvent) => !!onFiles && e.dataTransfer.types.includes('Files')
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        className="modal"
        role="dialog"
        aria-label={title}
        onDragOver={(e) => takesFiles(e) && e.preventDefault()}
        onDrop={(e) => {
          if (!takesFiles(e)) return
          e.preventDefault()
          onFiles!([...e.dataTransfer.files])
        }}
      >
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

interface ComposerProps {
  replyTo?: AppBskyFeedDefs.PostView
  /** A post to quote: it is embedded below the new post's text. */
  quote?: AppBskyFeedDefs.PostView
  onClose(): void
}

function PostPreview({ post }: { post: AppBskyFeedDefs.PostView }) {
  return (
    <div className="quote">
      <div className="byline">
        <Avatar author={post.author} small />
        <strong>{displayName(post.author)}</strong>
        <span className="muted">@{post.author.handle}</span>
      </div>
      <div className="body muted">{(post.record as { text?: string }).text}</div>
    </div>
  )
}

interface Attachment extends PreparedImage {
  id: string
  /** An object URL for the thumbnail. */
  url: string
  alt: string
}

export function Composer({ replyTo, quote, onClose }: ComposerProps) {
  const { session } = useApp()
  const [text, setText] = useState('')
  const [images, setImages] = useState<Attachment[]>([])
  const [preparing, setPreparing] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const left = MAX_GRAPHEMES - new RichText({ text }).graphemeLength
  const slots = MAX_IMAGES - images.length - preparing
  // A quote or images can go out with no text of their own, as in the Bluesky app.
  const canSend = !busy && !preparing && (text.trim().length > 0 || !!quote || images.length > 0) && left >= 0

  const urls = useRef<string[]>([])
  urls.current = images.map((img) => img.url)
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), [])

  const attach = async (files: File[]) => {
    const wanted = files.filter((f) => f.type.startsWith('image/'))
    if (!wanted.length) return
    setError(wanted.length > slots ? `A post can have at most ${MAX_IMAGES} images.` : '')
    const taken = wanted.slice(0, Math.max(slots, 0))
    setPreparing((n) => n + taken.length)
    await Promise.all(
      taken.map(async (file) => {
        try {
          const prepared = await prepareImage(file)
          const url = URL.createObjectURL(prepared.blob)
          setImages((list) => [...list, { ...prepared, id: newId(), url, alt: '' }])
        } catch (err) {
          setError(errorText(err))
        } finally {
          setPreparing((n) => n - 1)
        }
      }),
    )
  }

  const remove = (id: string) =>
    setImages((list) => {
      const gone = list.find((img) => img.id === id)
      if (gone) URL.revokeObjectURL(gone.url)
      return list.filter((img) => img.id !== id)
    })

  const setAlt = (id: string, alt: string) =>
    setImages((list) => list.map((img) => (img.id === id ? { ...img, alt } : img)))

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
      const uploaded = await Promise.all(
        images.map(async (img) => {
          const res = await session.agent.uploadBlob(img.blob, { encoding: img.blob.type })
          return { ...img, blob: res.data.blob }
        }),
      )
      await session.agent.post({
        text: rt.text,
        facets: rt.facets,
        reply: parent && { root: root ?? parent, parent },
        embed: postEmbed(uploaded, quote),
        langs: [navigator.language.split('-')[0]],
      })
      onClose()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={replyTo ? 'Reply' : quote ? 'Quote post' : 'New post'}
      onClose={busy ? undefined : onClose}
      onFiles={busy ? undefined : attach}
    >
      {replyTo && <PostPreview post={replyTo} />}
      <textarea
        autoFocus
        rows={6}
        value={text}
        placeholder={replyTo ? 'Write your reply' : quote ? 'Add a comment' : "What's up?"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && send()}
        onPaste={(e) => {
          const files = [...e.clipboardData.files]
          if (files.some((f) => f.type.startsWith('image/'))) {
            e.preventDefault()
            attach(files)
          }
        }}
      />
      {(images.length > 0 || preparing > 0) && (
        <div className="attachments">
          {images.map((img) => (
            <div key={img.id} className="attachment">
              <div className="thumb">
                <img src={img.url} alt="" />
                <button type="button" title="Remove image" onClick={() => remove(img.id)} disabled={busy}>
                  ×
                </button>
              </div>
              <input
                value={img.alt}
                onChange={(e) => setAlt(img.id, e.target.value)}
                placeholder="Alt text"
                aria-label="Alt text"
                maxLength={2000}
                disabled={busy}
              />
            </div>
          ))}
          {Array.from({ length: preparing }, (_, i) => (
            <div key={`preparing-${i}`} className="attachment">
              <div className="thumb muted">…</div>
            </div>
          ))}
        </div>
      )}
      {quote && <PostPreview post={quote} />}
      {error && <p className="error">{error}</p>}
      <div className="buttons">
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            attach([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
        <button
          type="button"
          className="add-image"
          onClick={() => picker.current?.click()}
          disabled={busy || slots <= 0}
          title="Add images (or paste or drop them)"
        >
          🖼 Image
        </button>
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
