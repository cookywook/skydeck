import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
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

export function displayName(author: Author): string {
  return author.displayName?.trim() || author.handle
}

export function Body({ text, facets }: { text: string; facets?: AppBskyRichtextFacet.Main[] }) {
  const out: ReactNode[] = []
  let i = 0
  for (const seg of new RichText({ text, facets }).segments()) {
    const href = seg.link
      ? safeHref(seg.link.uri)
      : seg.mention
        ? `https://bsky.app/profile/${seg.mention.did}`
        : seg.tag
          ? `https://bsky.app/hashtag/${encodeURIComponent(seg.tag.tag)}`
          : undefined
    out.push(
      href ? (
        <a key={i++} href={href} target="_blank" rel="noreferrer noopener">
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

function Media({ embed, href }: { embed: unknown; href: string }) {
  const images = asImages(embed)
  if (images) {
    return (
      <div className={`images n${Math.min(images.images.length, 4)}`}>
        {images.images.map((img) => (
          <a key={img.thumb} href={img.fullsize} target="_blank" rel="noreferrer noopener">
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
      <a className="video" href={href} target="_blank" rel="noreferrer noopener" title="Play on bsky.app">
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
  if (!record) {
    return <div className="quote muted">Quoted post unavailable</div>
  }
  const value = record.value as PostRecord
  const href = `https://bsky.app/profile/${record.author.handle}/post/${record.uri.split('/').pop()}`
  return (
    <div className="quote">
      <div className="byline">
        <Avatar author={record.author} small />
        <strong>{displayName(record.author)}</strong>
        <span className="muted">@{record.author.handle}</span>
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

function Actions({ post }: { post: PostView }) {
  const { session, compose } = useApp()
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
      <button type="button" title="Repost" className={repost.active ? 'on repost' : ''} onClick={repost.toggle}>
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
}

export function PostCard({ item, now, current }: PostCardProps) {
  const { post } = item
  const record = post.record as PostRecord
  const href = postUrl(post)
  const open = useOpenThread(current ? undefined : post.uri)
  return (
    <article className={current ? 'post current' : 'post clickable'} onClick={open}>
      {item.repostBy && <div className="context">⟳ Reposted by {displayName(item.repostBy)}</div>}
      {item.label && (
        <div className="context">
          {displayName(post.author)} {item.label}
        </div>
      )}
      <div className="byline">
        <Avatar author={post.author} />
        <span className="names">
          <strong>{displayName(post.author)}</strong>
          <span className="muted">@{post.author.handle}</span>
        </span>
        <a className="time muted" href={href} target="_blank" rel="noreferrer noopener" title="Open on bsky.app">
          {relativeTime(record.createdAt ?? post.indexedAt, now)}
        </a>
      </div>
      {item.replyTo && <div className="context">↩ Replying to {displayName(item.replyTo)}</div>}
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

export function NotifCard({ item, now }: { item: Extract<Item, { kind: 'notif' }>; now: number }) {
  const [first, ...rest] = item.authors
  const subject = item.subject?.record as PostRecord | undefined
  const open = useOpenThread(item.subject?.uri)
  return (
    <article className={item.subject ? 'post notif clickable' : 'post notif'} onClick={open}>
      <div className="byline">
        <span className={`notif-icon ${item.reason.includes('like') ? 'like' : ''}`}>
          {item.reason.includes('like') ? '♥' : item.reason.includes('repost') ? '⇄' : '＋'}
        </span>
        {item.authors.slice(0, 5).map((a) => (
          <Avatar key={a.did} author={a} small />
        ))}
        <span className="time muted">{relativeTime(item.indexedAt, now)}</span>
      </div>
      <div>
        <strong>{displayName(first)}</strong>
        {rest.length > 0 && ` and ${rest.length} other${rest.length > 1 ? 's' : ''}`}{' '}
        {NOTIF_TEXT[item.reason] ?? item.reason}
      </div>
      {subject?.text && <div className="body muted">{subject.text}</div>}
    </article>
  )
}
