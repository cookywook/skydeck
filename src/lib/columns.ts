import { AppBskyFeedDefs, type AppBskyNotificationListNotifications, type AtpAgent } from '@atproto/api'

type PostView = AppBskyFeedDefs.PostView
type Notification = AppBskyNotificationListNotifications.Notification
/** The profile fields the UI shows; every Bluesky profile view has them. */
export interface Author {
  did: string
  handle: string
  displayName?: string
  avatar?: string
}

export type ColumnConfig =
  | { id: string; kind: 'home'; title: string }
  | { id: string; kind: 'notifications'; title: string }
  | { id: string; kind: 'feed'; title: string; feed: string }
  | { id: string; kind: 'search'; title: string; query: string }

export type Item =
  | { kind: 'post'; key: string; post: PostView; repostBy?: Author; replyTo?: Author; label?: string }
  | {
      kind: 'notif'
      key: string
      reason: string
      authors: Author[]
      indexedAt: string
      subject?: PostView
    }

export interface Page {
  items: Item[]
  cursor?: string
}

const PAGE = 30
const MAX_ITEMS = 300

/** How often each kind of column polls. */
export function pollInterval(c: ColumnConfig): number {
  return c.kind === 'home' || c.kind === 'notifications' ? 15_000 : c.kind === 'search' ? 30_000 : 60_000
}

export async function fetchColumn(agent: AtpAgent, c: ColumnConfig, cursor?: string): Promise<Page> {
  switch (c.kind) {
    case 'home': {
      const { data } = await agent.getTimeline({ limit: PAGE, cursor })
      const myDid = agent.session?.did
      return { items: data.feed.filter((v) => showInHome(v, myDid)).map(feedItem), cursor: data.cursor }
    }
    case 'feed': {
      const { data } = await agent.app.bsky.feed.getFeed({ feed: c.feed, limit: PAGE, cursor })
      return { items: data.feed.map(feedItem), cursor: data.cursor }
    }
    case 'search': {
      const { data } = await agent.app.bsky.feed.searchPosts({ q: c.query, sort: 'latest', limit: PAGE, cursor })
      return { items: data.posts.map((post) => ({ kind: 'post', key: post.uri, post })), cursor: data.cursor }
    }
    case 'notifications': {
      const { data } = await agent.listNotifications({ limit: PAGE, cursor })
      const uris = subjectUris(data.notifications)
      const posts = new Map<string, PostView>()
      for (let i = 0; i < uris.length; i += 25) {
        const res = await agent.getPosts({ uris: uris.slice(i, i + 25) })
        for (const p of res.data.posts) posts.set(p.uri, p)
      }
      return { items: groupNotifications(data.notifications, posts), cursor: data.cursor }
    }
  }
}

/**
 * Home hides a reply unless you follow both its author and the person being
 * replied to (your own posts count as followed). Reposts are always shown.
 */
export function showInHome(v: AppBskyFeedDefs.FeedViewPost, myDid?: string): boolean {
  if (!v.reply || AppBskyFeedDefs.isReasonRepost(v.reason)) return true
  const followed = (a: { did: string; viewer?: { following?: string } }) => a.did === myDid || !!a.viewer?.following
  const parent = v.reply.parent
  return AppBskyFeedDefs.isPostView(parent) && followed((parent as PostView).author) && followed(v.post.author)
}

function feedItem(v: AppBskyFeedDefs.FeedViewPost): Item {
  const repostBy = AppBskyFeedDefs.isReasonRepost(v.reason) ? v.reason.by : undefined
  const parent = v.reply?.parent
  const replyTo = parent && AppBskyFeedDefs.isPostView(parent) ? parent.author : undefined
  return {
    kind: 'post',
    key: repostBy ? `${v.post.uri}#repost:${repostBy.did}` : v.post.uri,
    post: v.post,
    repostBy,
    replyTo,
  }
}

const POST_REASONS: Record<string, string> = {
  reply: 'replied to you',
  mention: 'mentioned you',
  quote: 'quoted you',
}

/** The post each notification is about: the liked/reposted post, or the reply/mention/quote itself. */
export function subjectUris(notifs: Notification[]): string[] {
  const uris = new Set<string>()
  for (const n of notifs) {
    if (n.reason in POST_REASONS) uris.add(n.uri)
    else if (n.reasonSubject?.includes('/app.bsky.feed.post/')) uris.add(n.reasonSubject)
  }
  return [...uris]
}

/**
 * Replies, mentions and quotes become ordinary posts. Likes and reposts of the
 * same post collapse into one row ("A and 3 others liked your post"), placed
 * where the most recent of them falls.
 */
export function groupNotifications(notifs: Notification[], posts: Map<string, PostView>): Item[] {
  const items: Item[] = []
  const groups = new Map<string, Extract<Item, { kind: 'notif' }>>()
  for (const n of notifs) {
    if (n.reason in POST_REASONS) {
      const post = posts.get(n.uri)
      if (post) items.push({ kind: 'post', key: `n:${n.uri}`, post, label: POST_REASONS[n.reason] })
      continue
    }
    const groupable = n.reason === 'like' || n.reason === 'repost'
    const key = groupable ? `n:${n.reason}:${n.reasonSubject}` : `n:${n.uri}`
    const existing = groups.get(key)
    if (existing) {
      if (!existing.authors.some((a) => a.did === n.author.did)) existing.authors.push(n.author)
      continue
    }
    const item: Extract<Item, { kind: 'notif' }> = {
      kind: 'notif',
      key,
      reason: n.reason,
      authors: [n.author],
      indexedAt: n.indexedAt,
      subject: n.reasonSubject ? posts.get(n.reasonSubject) : undefined,
    }
    groups.set(key, item)
    items.push(item)
  }
  return items
}

/** When an item happened: a notification's time, or a post's. */
export function itemTime(item: Item): string {
  return item.kind === 'notif' ? item.indexedAt : item.post.indexedAt
}

/** Identifies one state of an item: a like group gets a new id when someone else joins it. */
export function itemId(item: Item): string {
  return `${item.key}@${itemTime(item)}`
}

/**
 * Tracks which items have arrived since the column was first loaded. The
 * first page only sets the baseline. After that an item counts as new when it
 * has not been seen and is more recent than everything seen before, so an old
 * item sliding back into the page is not announced.
 */
export class Arrivals {
  private seen = new Set<string>()
  private newest = ''
  private primed = false

  /** Records a freshly polled page and returns the ids that are new in it. */
  note(items: Item[]): string[] {
    const fresh: string[] = []
    let newest = this.newest
    for (const item of items) {
      const id = itemId(item)
      const time = itemTime(item)
      if (this.primed && !this.seen.has(id) && time > this.newest) fresh.push(id)
      this.seen.add(id)
      if (time > newest) newest = time
    }
    this.newest = newest
    this.primed = true
    return fresh
  }
}

/** Newly fetched items go on top; older ones we already had stay below, without duplicates. */
export function mergeItems(fresh: Item[], old: Item[], cap = MAX_ITEMS): Item[] {
  const seen = new Set<string>()
  const out: Item[] = []
  for (const item of [...fresh, ...old]) {
    if (seen.has(item.key)) continue
    seen.add(item.key)
    out.push(item)
    if (out.length >= cap) break
  }
  return out
}

/** Appends an older page, skipping anything already shown. */
export function appendItems(old: Item[], more: Item[]): Item[] {
  const seen = new Set(old.map((i) => i.key))
  return [...old, ...more.filter((i) => !seen.has(i.key))]
}

/**
 * Accepts an at:// feed URI or a bsky.app feed link and returns the at:// URI.
 * `resolveHandle` is only called when the link uses a handle rather than a DID.
 */
export async function parseFeedRef(input: string, resolveHandle: (handle: string) => Promise<string>): Promise<string> {
  const text = input.trim()
  if (/^at:\/\/did:[a-z]+:[^/]+\/app\.bsky\.feed\.generator\/[^/]+$/.test(text)) return text
  const m = text.match(/^https?:\/\/bsky\.app\/profile\/([^/]+)\/feed\/([^/?#]+)/)
  if (!m) throw new Error('Paste a bsky.app feed link or an at:// feed address.')
  const did = m[1].startsWith('did:') ? m[1] : await resolveHandle(m[1])
  return `at://${did}/app.bsky.feed.generator/${m[2]}`
}

export function postUrl(post: PostView): string {
  return `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').pop()}`
}

export function relativeTime(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
