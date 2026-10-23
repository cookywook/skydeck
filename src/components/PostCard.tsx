import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react'
import {
  AppBskyEmbedExternal,
  AppBskyEmbedImages,
  AppBskyEmbedRecord,
  AppBskyEmbedRecordWithMedia,
  AppBskyEmbedVideo,
  RichText,
  type AppBskyFeedDefs,
  type AppBskyRichtextFacet,
} from '@atproto/api'
import { useApp } from '../hooks'
import { useEscape } from './Dialogs'
import { postUrl, relativeTime, type Author, type Item } from '../lib/columns'

type PostView = AppBskyFeedDefs.PostView
type PostRecord = { text?: string; facets?: AppBskyRichtextFacet.Main[]; createdAt?: string }

/** Only http(s) links are rendered as links; anything else is shown as text. */
function safeHref(uri: string): string | undefined {
  return /^https?:\/\//i.test(uri) ? uri : undefined
}

export function Avatar({ author, small }: { author: Author; small?: boolean }) {
  return author.avatar ? (
    <img className={small ? 'avatar small' : 'avatar'} src={author.avatar} alt="" loading="lazy" />
  ) : (
    <span className={small ? 'avatar small' : 'avatar'} />
  )
}

/** A name or avatar that opens that person's profile in the column. */
export function Who({ author, className, children }: { author: Author; className?: string; children: ReactNode }) {
  const { openProfile } = useApp()
  return (
    <button
      type="button"
      className={className ? `who ${className}` : 'who'}
      title={`@${author.handle}`}
      onClick={() => openProfile(author.did)}
    >
      {children}
    </button>
  )
}

export function displayName(author: Author): string {
  return author.displayName?.trim() || author.handle
}

export function Body({ text, facets }: { text: string; facets?: AppBskyRichtextFacet.Main[] }) {
  const { openProfile } = useApp()
  const out: ReactNode[] = []
  let i = 0
  for (const seg of new RichText({ text, facets }).segments()) {
    // An @mention opens that profile in the column; ⌘-click still goes to bsky.app.
    const mention = seg.mention?.did
    const href = seg.link
      ? safeHref(seg.link.uri)
      : seg.mention
        ? `https://bsky.app/profile/${seg.mention.did}`
        : seg.tag
          ? `https://bsky.app/hashtag/${encodeURIComponent(seg.tag.tag)}`
          : undefined
    out.push(
      href ? (
        <a
          key={i++}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={mention ? previewClick(() => openProfile(mention)) : undefined}
        >
          {seg.text}
        </a>
      ) : (
        seg.text
      ),
    )
  }
  return <div className="body">{out}</div>
}

// The library's guards narrow `unknown` to just `$type`, so these return the full view type.
const asImages = (e: unknown) => (AppBskyEmbedImages.isView(e) ? (e as AppBskyEmbedImages.View) : undefined)
const asVideo = (e: unknown) => (AppBskyEmbedVideo.isView(e) ? (e as AppBskyEmbedVideo.View) : undefined)
const asExternal = (e: unknown) => (AppBskyEmbedExternal.isView(e) ? (e as AppBskyEmbedExternal.View) : undefined)
const asRecord = (e: unknown) => (AppBskyEmbedRecord.isView(e) ? (e as AppBskyEmbedRecord.View) : undefined)
const asRecordWithMedia = (e: unknown) =>
  AppBskyEmbedRecordWithMedia.isView(e) ? (e as AppBskyEmbedRecordWithMedia.View) : undefined
const asViewRecord = (e: unknown) =>
  AppBskyEmbedRecord.isViewRecord(e) ? (e as AppBskyEmbedRecord.ViewRecord) : undefined

/** A plain click previews in the app; ⌘/Ctrl/Shift-click or middle-click still opens the link in a browser. */
function previewClick(open: () => void) {
  return (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    open()
  }
}

function Media({ embed, href }: { embed: unknown; href: string }) {
  const { viewMedia } = useApp()
  const images = asImages(embed)
  if (images) {
    return (
      <div className={`images n${Math.min(images.images.length, 4)}`}>
        {images.images.map((img, index) => (
          <a
            key={img.thumb}
            href={img.fullsize}
            target="_blank"
            rel="noreferrer noopener"
            onClick={previewClick(() => viewMedia({ kind: 'images', images: images.images, index }))}
          >
            <img
              src={img.thumb}
              alt={img.alt}
              title={img.alt || undefined}
              loading="lazy"
              // A lone image keeps its own shape (up to the height cap) so text in it is not cropped.
              style={
                images.images.length === 1 && img.aspectRatio
                  ? { aspectRatio: `${img.aspectRatio.width} / ${img.aspectRatio.height}` }
                  : undefined
              }
            />
          </a>
        ))}
      </div>
    )
  }
  const video = asVideo(embed)
  if (video) {
    return (
      <a
        className="video"
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        title="Play"
        onClick={previewClick(() =>
          viewMedia({
            kind: 'video',
            playlist: video.playlist,
            thumbnail: video.thumbnail,
            alt: video.alt,
            gif: video.presentation === 'gif',
          }),
        )}
      >
        {video.thumbnail && <img src={video.thumbnail} alt={video.alt ?? ''} loading="lazy" />}
        <span className="play">▶</span>
      </a>
    )
  }
  const ext = asExternal(embed)?.external
  if (ext) {
    const link = safeHref(ext.uri)
    let host = ''
    try {
      host = new URL(ext.uri).hostname
    } catch {
      // Leave the host blank for malformed links.
    }
    return (
      <a className="card" href={link} target="_blank" rel="noreferrer noopener">
        {ext.thumb && <img src={ext.thumb} alt="" loading="lazy" />}
        <span className="card-text">
          <span className="muted">{host}</span>
          <strong>{ext.title || ext.uri}</strong>
          {ext.description && <span className="card-desc">{ext.description}</span>}
        </span>
      </a>
    )
  }
  return null
}

function Quote({ record: quoted }: { record: unknown }) {
  const record = asViewRecord(quoted)
  const open = useOpenThread(record?.uri)
  if (!record) {
    return <div className="quote muted">Quoted post unavailable</div>
  }
  const value = record.value as PostRecord
  const href = `https://bsky.app/profile/${record.author.handle}/post/${record.uri.split('/').pop()}`
  return (
    // Opens the quoted post's own thread, not the thread of the post quoting it.
    <div
      className="quote clickable"
      onClick={(e) => {
        e.stopPropagation()
        open(e)
      }}
    >
      <div className="byline">
        <Who author={record.author} className="inline">
          <Avatar author={record.author} small />
          <strong>{displayName(record.author)}</strong>
          <span className="muted">@{record.author.handle}</span>
        </Who>
      </div>
      {value.text && <Body text={value.text} facets={value.facets} />}
      {record.embeds?.[0] != null && <Media embed={record.embeds[0]} href={href} />}
    </div>
  )
}

function Embed({ embed, href }: { embed: unknown; href: string }) {
  const record = asRecord(embed)
  if (record) return <Quote record={record.record} />
  const withMedia = asRecordWithMedia(embed)
  if (withMedia) {
    return (
      <>
        <Media embed={withMedia.media} href={href} />
        <Quote record={withMedia.record.record} />
      </>
    )
  }
  return <Media embed={embed} href={href} />
}

/** Like or repost toggle with an optimistic count that rolls back if the request fails. */
function useToggle(
  initial: string | undefined,
  initialCount: number,
  add: () => Promise<{ uri: string }>,
  remove: (uri: string) => Promise<void>,
) {
  const [uri, setUri] = useState(initial)
  const [count, setCount] = useState(initialCount)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setUri(initial)
    setCount(initialCount)
  }, [initial, initialCount])

  const toggle = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    const before = { uri, count }
    try {
      if (uri) {
        setUri(undefined)
        setCount((n) => Math.max(0, n - 1))
        await remove(uri)
      } else {
        setUri('pending')
        setCount((n) => n + 1)
        setUri((await add()).uri)
      }
    } catch {
      setUri(before.uri)
      setCount(before.count)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return { active: !!uri, count, toggle, failed }
}

/**
 * The repost button's choices. Closes on Escape or a click anywhere else; a
 * click on the button itself is left to the button, which toggles the menu.
 */
function RepostMenu({ trigger, reposted, onRepost, onQuote, onClose }: {
  trigger: RefObject<HTMLButtonElement | null>
  reposted: boolean
  onRepost(): void
  onQuote(): void
  onClose(): void
}) {
  useEscape(onClose)
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !trigger.current?.contains(target)) close.current()
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [trigger])
  const pick = (fn: () => void) => () => {
    onClose()
    fn()
  }
  return (
    <div className="menu" role="menu" ref={ref}>
      <button type="button" role="menuitem" onClick={pick(onRepost)}>
        {reposted ? 'Undo repost' : 'Repost'}
      </button>
      <button type="button" role="menuitem" onClick={pick(onQuote)}>
        Quote post
      </button>
    </div>
  )
}

function Actions({ post }: { post: PostView }) {
  const { session, compose, quote } = useApp()
  const [menu, setMenu] = useState(false)
  const repostButton = useRef<HTMLButtonElement>(null)
  const agent = session.agent
  const like = useToggle(
    post.viewer?.like,
    post.likeCount ?? 0,
    () => agent.like(post.uri, post.cid),
    (uri) => agent.deleteLike(uri),
  )
  const repost = useToggle(
    post.viewer?.repost,
    post.repostCount ?? 0,
    () => agent.repost(post.uri, post.cid),
    (uri) => agent.deleteRepost(uri),
  )
  return (
    <div className="actions">
      <button type="button" title="Reply" onClick={() => compose(post)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 20l1.3-5.2A8.4 8.4 0 1 1 21 11.5z" />
        </svg>
        {post.replyCount || ''}
      </button>
      <button
        ref={repostButton}
        type="button"
        title="Repost or quote"
        aria-haspopup="menu"
        aria-expanded={menu}
        className={repost.active ? 'on repost' : ''}
        onClick={() => setMenu((m) => !m)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />
        </svg>
        {repost.count || ''}
      </button>
      <button type="button" title="Like" className={like.active ? 'on like' : ''} onClick={like.toggle}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
        </svg>
        {like.count || ''}
      </button>
      {menu && (
        <RepostMenu
          trigger={repostButton}
          reposted={repost.active}
          onRepost={repost.toggle}
          onQuote={() => quote(post)}
          onClose={() => setMenu(false)}
        />
      )}
      {(like.failed || repost.failed) && <span className="error">Failed, try again</span>}
    </div>
  )
}

/** Opens the thread unless the click was on a link or button, or was the end of a text selection. */
function useOpenThread(uri: string | undefined) {
  const { openThread } = useApp()
  return (e: MouseEvent) => {
    if (!uri || (e.target as Element).closest('a, button')) return
    if (window.getSelection()?.toString()) return
    openThread(uri)
  }
}

interface PostCardProps {
  item: Extract<Item, { kind: 'post' }>
  now: number
  /** The post a thread view is centred on: highlighted, and not clickable. */
  current?: boolean
  /** Arrived while the app was open: briefly highlighted. */
  fresh?: boolean
}

export function PostCard({ item, now, current, fresh }: PostCardProps) {
  const { post } = item
  const record = post.record as PostRecord
  const href = postUrl(post)
  const open = useOpenThread(current ? undefined : post.uri)
  return (
    <article className={`post ${current ? 'current' : 'clickable'}${fresh ? ' fresh' : ''}`} onClick={open}>
      {item.repostBy && (
        <div className="context">
          ⟳ Reposted by <Who author={item.repostBy}>{displayName(item.repostBy)}</Who>
        </div>
      )}
      {item.label && (
        <div className="context">
          <Who author={post.author}>{displayName(post.author)}</Who> {item.label}
        </div>
      )}
      <div className="byline">
        <Who author={post.author}>
          <Avatar author={post.author} />
        </Who>
        <Who author={post.author} className="names">
          <strong>{displayName(post.author)}</strong>
          <span className="muted">@{post.author.handle}</span>
        </Who>
        <a className="time muted" href={href} target="_blank" rel="noreferrer noopener" title="Open on bsky.app">
          {relativeTime(record.createdAt ?? post.indexedAt, now)}
        </a>
      </div>
      {item.replyTo && (
        <div className="context">
          ↩ Replying to <Who author={item.replyTo}>{displayName(item.replyTo)}</Who>
        </div>
      )}
      {record.text && <Body text={record.text} facets={record.facets} />}
      {post.embed != null && <Embed embed={post.embed} href={href} />}
      <Actions post={post} />
    </article>
  )
}

const NOTIF_TEXT: Record<string, string> = {
  like: 'liked your post',
  repost: 'reposted your post',
  follow: 'followed you',
  'starterpack-joined': 'joined via your starter pack',
  'like-via-repost': 'liked your repost',
  'repost-via-repost': 'reposted your repost',
}

export function NotifCard({ item, now, fresh }: { item: Extract<Item, { kind: 'notif' }>; now: number; fresh?: boolean }) {
  const [first, ...rest] = item.authors
  const subject = item.subject?.record as PostRecord | undefined
  const open = useOpenThread(item.subject?.uri)
  return (
    <article className={`post notif${item.subject ? ' clickable' : ''}${fresh ? ' fresh' : ''}`} onClick={open}>
      <div className="byline">
        <span className={`notif-icon ${item.reason.includes('like') ? 'like' : ''}`}>
          {item.reason.includes('like') ? '♥' : item.reason.includes('repost') ? '⇄' : '＋'}
        </span>
        {item.authors.slice(0, 5).map((a) => (
          <Who key={a.did} author={a}>
            <Avatar author={a} small />
          </Who>
        ))}
        <span className="time muted">{relativeTime(item.indexedAt, now)}</span>
      </div>
      <div>
        <Who author={first}>
          <strong>{displayName(first)}</strong>
        </Who>
        {rest.length > 0 && ` and ${rest.length} other${rest.length > 1 ? 's' : ''}`}{' '}
        {NOTIF_TEXT[item.reason] ?? item.reason}
      </div>
      {subject?.text && <div className="body muted">{subject.text}</div>}
    </article>
  )
}
