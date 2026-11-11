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
      const reposts = await resolveReposts(agent, repostUris(data.notifications))
      const uris = [...new Set([...subjectUris(data.notifications), ...reposts.values()])]
      const posts = new Map<string, PostView>()
      for (let i = 0; i < uris.length; i += 25) {
        const res = await agent.getPosts({ uris: uris.slice(i, i + 25) })
        for (const p of res.data.posts) posts.set(p.uri, p)
      }
      return { items: groupNotifications(data.notifications, posts, reposts), cursor: data.cursor }
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

export function feedItem(v: AppBskyFeedDefs.FeedViewPost): Item {
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

const REPOST_RECORD = /^at:\/\/([^/]+)\/app\.bsky\.feed\.repost\/([^/]+)$/

/**
 * The repost records that "liked your repost" / "reposted your repost"
 * notifications point at. Their reasonSubject is your repost, not the post.
 */
export function repostUris(notifs: Notification[]): string[] {
  return [...new Set(notifs.map((n) => n.reasonSubject).filter((u): u is string => !!u && REPOST_RECORD.test(u)))]
}

/** Which post each repost record reposted. A repost record never changes, so answers are kept for the session. */
const repostTargets = new Map<string, string>()
/** Reposts that have been undone, so they are not looked up again on every poll. */
const repostsGone = new Set<string>()

async function resolveReposts(agent: AtpAgent, uris: string[]): Promise<Map<string, string>> {
  await Promise.all(
    uris
      .filter((uri) => !repostTargets.has(uri) && !repostsGone.has(uri))
      .map(async (uri) => {
        const [, repo, rkey] = uri.match(REPOST_RECORD)!
        try {
          const { data } = await agent.com.atproto.repo.getRecord({ repo, collection: 'app.bsky.feed.repost', rkey })
          const target = (data.value as { subject?: { uri?: string } }).subject?.uri
          if (target) repostTargets.set(uri, target)
        } catch (e) {
          // The repost has since been undone; the notification shows without its post.
          // Any other failure (the network, say) is tried again on the next poll.
          if ((e as { status?: number }).status === 400) repostsGone.add(uri)
        }
      }),
  )
  return new Map(uris.flatMap((uri) => (repostTargets.has(uri) ? [[uri, repostTargets.get(uri)!] as const] : [])))
}

const GROUPABLE = new Set(['like', 'repost', 'like-via-repost', 'repost-via-repost'])

/**
 * Replies, mentions and quotes become ordinary posts. Likes and reposts of the
 * same post (or of the same repost of yours) collapse into one row ("A and 3 others liked your post"), placed
 * where the most recent of them falls.
 */
export function groupNotifications(
  notifs: Notification[],
  posts: Map<string, PostView>,
  reposts: Map<string, string> = new Map(),
): Item[] {
  const items: Item[] = []
  const groups = new Map<string, Extract<Item, { kind: 'notif' }>>()
  for (const n of notifs) {
    if (n.reason in POST_REASONS) {
      const post = posts.get(n.uri)
      if (post) items.push({ kind: 'post', key: `n:${n.uri}`, post, label: POST_REASONS[n.reason] })
      continue
    }
    const groupable = GROUPABLE.has(n.reason)
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
      subject: n.reasonSubject ? posts.get(reposts.get(n.reasonSubject) ?? n.reasonSubject) : undefined,
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

/** Where a fetched page ended: `cursor` continues with what is older than everything above it. Not shown. */
export interface Mark {
  kind: 'mark'
  key: string
  cursor: string
}

/** A place where posts were probably missed, for example while the machine was asleep. */
export interface Gap {
  kind: 'gap'
  key: string
}

/** What a column holds: its items, plus the places a page ended and the places posts are missing. */
export type Entry = Item | Mark | Gap

/** Marks closer together than this are thinned out; one is enough to resume from. */
const MARK_SPACING = 10

/** The page's items followed by a mark for where it ended, if anything older exists. */
function pageEntries(page: Page): Entry[] {
  return page.cursor ? [...page.items, { kind: 'mark', key: `mark:${page.cursor}`, cursor: page.cursor }] : page.items
}

/** Drops marks that have another one a few items below them. The last mark, and one above each gap, always survive. */
function thinMarks(entries: Entry[]): Entry[] {
  const out: Entry[] = []
  let since = Infinity
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.kind === 'mark') {
      if (since < MARK_SPACING) continue
      since = 0
    } else if (e.kind === 'gap') {
      // The mark above a gap is the only way to resume across it.
      since = Infinity
    } else since++
    out.push(e)
  }
  return out.reverse()
}

/**
 * Puts a freshly polled first page on top of what the column already shows, without duplicates.
 *
 * In a column that runs newest-first, a full page that shares nothing with what was there means
 * more arrived than one page holds, so a gap is recorded between the two rather than letting them
 * look continuous.
 *
 * The list is kept to about `cap` items by cutting at a mark, so "Load older" always resumes
 * exactly where the list ends.
 */
export function mergePage(page: Page, old: Entry[], opts: { newestFirst: boolean; cap?: number }): Entry[] {
  const cap = opts.cap ?? MAX_ITEMS
  const fresh = pageEntries(page)
  const had = new Set(old.map((e) => e.key))
  const missed =
    opts.newestFirst &&
    !!page.cursor &&
    page.items.length > 0 &&
    old.some((e) => e.kind === 'post' || e.kind === 'notif') &&
    !page.items.some((i) => had.has(i.key))
  const seen = new Set(fresh.map((e) => e.key))
  const rest = old.filter((e) => !seen.has(e.key))
  const all = thinMarks(missed ? [...fresh, { kind: 'gap', key: `gap:${page.cursor}` }, ...rest] : [...fresh, ...rest])

  let count = 0
  let lastMark = -1
  for (let i = 0; i < all.length; i++) {
    const e = all[i]
    if (e.kind === 'mark') lastMark = i
    else if (e.kind !== 'gap' && ++count > cap) {
      // Over the cap: end at the last mark, or failing that right here (with nothing more to load).
      return all.slice(0, lastMark >= 0 ? lastMark + 1 : i)
    }
  }
  return all
}

/** The cursor "Load older" continues from: set only while the list ends where a page ended. */
export function olderCursor(entries: Entry[]): string | undefined {
  const last = entries[entries.length - 1]
  return last?.kind === 'mark' ? last.cursor : undefined
}

/** Appends an older page, skipping anything already shown. The list then ends where that page did. */
export function appendPage(old: Entry[], page: Page): Entry[] {
  const seen = new Set(old.map((e) => e.key))
  const out = [...old, ...pageEntries(page).filter((e) => !seen.has(e.key))]
  // The last page can add nothing; the list must still stop ending on a mark.
  if (!page.cursor) while (out[out.length - 1]?.kind === 'mark') out.pop()
  return thinMarks(out)
}

/**
 * Discards everything below a gap, so the list ends where the page above the gap did and
 * "Load older" fetches the missing posts next.
 */
export function cutAtGap(entries: Entry[], key: string): Entry[] {
  const at = entries.findIndex((e) => e.key === key)
  return at < 0 ? entries : entries.slice(0, at)
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

/**
 * When to say a post was made. The author sets `createdAt` and can claim any time, so it is
 * believed only when it is a little before the time the network first saw the post.
 */
export function postTime(createdAt: string | undefined, indexedAt: string): string {
  if (!createdAt) return indexedAt
  const lead = Date.parse(indexedAt) - Date.parse(createdAt)
  return lead >= 0 && lead < 86_400_000 ? createdAt : indexedAt
}

/**
 * The real host of a link whose text names a different one ("bsky.app" pointing at another site),
 * or undefined when the text is not an address or agrees with the link.
 */
export function misleadingHost(text: string, uri: string): string | undefined {
  const shown = text.trim().match(/^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[/:?#.…]|$)/i)?.[1]
  if (!shown) return undefined
  let real: string
  try {
    real = new URL(uri).hostname
  } catch {
    return undefined
  }
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, '')
  return bare(shown) === bare(real) ? undefined : real
}

export function relativeTime(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
