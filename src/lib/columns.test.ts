import { describe, expect, it } from 'vitest'
import type { AppBskyFeedDefs, AppBskyNotificationListNotifications } from '@atproto/api'
import {
  Arrivals,
  appendPage,
  cutAtGap,
  mergePage,
  olderCursor,
  groupNotifications,
  parseFeedRef,
  repostUris,
  relativeTime,
  showInHome,
  subjectUris,
  type Item,
} from './columns'
import { flattenThread } from './thread'
import { defaultColumns, exportColumns, parseColumns } from './settings'

type Notification = AppBskyNotificationListNotifications.Notification
type PostView = AppBskyFeedDefs.PostView

const POST = 'at://did:plc:me/app.bsky.feed.post/'

function post(uri: string): PostView {
  return {
    uri,
    cid: 'cid',
    author: { did: 'did:plc:a', handle: 'a.test' },
    record: { text: uri },
    indexedAt: '2026-10-13T12:00:00Z',
  }
}

function item(key: string): Item {
  return { kind: 'post', key, post: post(key) }
}

function notif(reason: string, who: string, extra: Partial<Notification> = {}): Notification {
  return {
    uri: `at://did:plc:${who}/app.bsky.feed.${reason}/1`,
    cid: 'cid',
    author: { did: `did:plc:${who}`, handle: `${who}.test` },
    reason,
    record: {},
    isRead: false,
    indexedAt: '2026-10-13T12:00:00Z',
    ...extra,
  }
}

const keys = (items: { key: string }[]) => items.map((i) => i.key)

const page = (cursor: string | undefined, ...ks: string[]) => ({ items: ks.map(item), cursor })
const chrono = { newestFirst: true }

describe('mergePage', () => {
  it('puts new items first, drops duplicates, and marks where the page ended', () => {
    const first = mergePage(page('c1', 'b', 'a'), [], chrono)
    expect(keys(first)).toEqual(['b', 'a', 'mark:c1'])
    // The new page's own mark is dropped: the one just below it resumes from the same place.
    expect(keys(mergePage(page('c2', 'c', 'b'), first, chrono))).toEqual(['c', 'b', 'a', 'mark:c1'])
  })

  it('keeps the fresh copy of an item that was already shown', () => {
    const p = page('c1', 'a')
    expect(mergePage(p, [item('a')], chrono)[0]).toBe(p.items[0])
  })

  it('records a gap when a full page shares nothing with what was shown', () => {
    const old = mergePage(page('c1', 'b', 'a'), [], chrono)
    expect(keys(mergePage(page('c9', 'z', 'y'), old, chrono))).toEqual(['z', 'y', 'mark:c9', 'gap:c9', 'b', 'a', 'mark:c1'])
  })

  it('records no gap in a ranked feed, or when the page is all there is', () => {
    const old = mergePage(page('c1', 'b', 'a'), [], chrono)
    expect(keys(mergePage(page('c9', 'z'), old, { newestFirst: false }))).not.toContain('gap:c9')
    expect(keys(mergePage(page(undefined, 'z'), old, chrono))).toEqual(['z', 'b', 'a', 'mark:c1'])
  })

  it('trims to the cap at a mark, so loading older resumes exactly where the list ends', () => {
    const run = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => `p${from - i}`)
    let list = mergePage(page('after-25', ...run(36, 25)), [], chrono)
    list = appendPage(list, page('after-13', ...run(24, 13)))
    list = appendPage(list, page('after-1', ...run(12, 1)))
    list = mergePage(page('after-31', ...run(42, 31)), list, { newestFirst: true, cap: 30 })
    // 42 posts are known; the cut falls back from 30 to where the second page ended.
    expect(keys(list).filter((k) => k.startsWith('p'))).toEqual(run(42, 13))
    expect(olderCursor(list)).toBe('after-13')
  })
})

describe('appendPage', () => {
  it('adds only what is not already shown and moves the end of the list', () => {
    const list = appendPage(mergePage(page('c1', 'c', 'b'), [], chrono), page('c2', 'b', 'a'))
    expect(keys(list)).toEqual(['c', 'b', 'a', 'mark:c2'])
    expect(olderCursor(list)).toBe('c2')
  })

  it('stays at the end once the last page is loaded, even after later polls', () => {
    let list = appendPage(mergePage(page('c1', 'c', 'b'), [], chrono), page(undefined, 'a'))
    expect(olderCursor(list)).toBeUndefined()
    list = mergePage(page('c1', 'c', 'b'), list, chrono)
    list = mergePage(page('c3', 'd', 'c'), list, chrono)
    expect(keys(list).at(-1)).toBe('a')
    expect(olderCursor(list)).toBeUndefined()
  })

  it('keeps going past a page with nothing new in it', () => {
    const list = appendPage(mergePage(page('c1', 'b', 'a'), [], chrono), page('c2', 'a'))
    expect(olderCursor(list)).toBe('c2')
  })
})

describe('cutAtGap', () => {
  it('drops what is below the gap so the missing posts load next', () => {
    const old = mergePage(page('c1', 'b', 'a'), [], chrono)
    const list = cutAtGap(mergePage(page('c9', 'z', 'y'), old, chrono), 'gap:c9')
    expect(keys(list)).toEqual(['z', 'y', 'mark:c9'])
    expect(olderCursor(list)).toBe('c9')
  })
})

describe('marks', () => {
  it('are thinned out as polls pile them up, keeping the last', () => {
    let list = mergePage(page('c0', 'a0'), [], chrono)
    for (let i = 1; i <= 20; i++) list = mergePage(page(`c${i}`, `a${i}`, `a${i - 1}`), list, chrono)
    const marks = keys(list).filter((k) => k.startsWith('mark:'))
    expect(marks.length).toBeLessThanOrEqual(3)
    expect(olderCursor(list)).toBe('c0')
    expect(keys(list).filter((k) => k.startsWith('a')).length).toBe(21)
  })
})

describe('notifications', () => {
  const notifs = [
    notif('like', 'x', { reasonSubject: `${POST}1` }),
    notif('reply', 'y', { uri: 'at://did:plc:y/app.bsky.feed.post/r1' }),
    notif('like', 'z', { reasonSubject: `${POST}1` }),
    notif('like', 'x', { reasonSubject: `${POST}1` }),
    notif('repost', 'x', { reasonSubject: `${POST}1` }),
    notif('follow', 'w'),
    notif('like', 'w', { reasonSubject: `${POST}2` }),
  ]

  it('collects the posts to fetch', () => {
    expect(subjectUris(notifs)).toEqual([`${POST}1`, 'at://did:plc:y/app.bsky.feed.post/r1', `${POST}2`])
  })

  it('groups likes and reposts per post and turns replies into posts', () => {
    const posts = new Map([`${POST}1`, 'at://did:plc:y/app.bsky.feed.post/r1'].map((u) => [u, post(u)]))
    const items = groupNotifications(notifs, posts)
    expect(items.map((i) => (i.kind === 'post' ? `post:${i.label}` : `${i.reason}:${i.authors.length}`))).toEqual([
      'like:2',
      'post:replied to you',
      'repost:1',
      'follow:1',
      'like:1',
    ])
    const like = items[0]
    expect(like.kind === 'notif' && like.subject?.uri).toBe(`${POST}1`)
  })

  it('shows the original post for activity on your reposts', () => {
    const REPOST = 'at://did:plc:me/app.bsky.feed.repost/rp1'
    const vias = [
      notif('like-via-repost', 'x', { reasonSubject: REPOST }),
      notif('like-via-repost', 'z', { reasonSubject: REPOST }),
      notif('repost-via-repost', 'w', { reasonSubject: REPOST }),
    ]
    expect(repostUris(vias)).toEqual([REPOST])
    expect(subjectUris(vias)).toEqual([])
    const original = 'at://did:plc:other/app.bsky.feed.post/orig'
    const items = groupNotifications(vias, new Map([[original, post(original)]]), new Map([[REPOST, original]]))
    expect(items.map((i) => (i.kind === 'notif' ? `${i.reason}:${i.authors.length}:${i.subject?.uri}` : ''))).toEqual([
      `like-via-repost:2:${original}`,
      `repost-via-repost:1:${original}`,
    ])
  })

  it('drops a reply whose post could not be loaded', () => {
    expect(groupNotifications([notif('reply', 'y')], new Map())).toEqual([])
  })
})

describe('parseFeedRef', () => {
  const resolve = async (handle: string) => `did:plc:resolved-${handle}`

  it('passes an at:// feed address through', async () => {
    const uri = 'at://did:plc:abc/app.bsky.feed.generator/with-friends'
    expect(await parseFeedRef(` ${uri} `, resolve)).toBe(uri)
  })

  it('converts bsky.app links, resolving handles', async () => {
    expect(await parseFeedRef('https://bsky.app/profile/bsky.app/feed/whats-hot?x=1', resolve)).toBe(
      'at://did:plc:resolved-bsky.app/app.bsky.feed.generator/whats-hot',
    )
    expect(await parseFeedRef('https://bsky.app/profile/did:plc:abc/feed/f', resolve)).toBe(
      'at://did:plc:abc/app.bsky.feed.generator/f',
    )
  })

  it('rejects anything else', async () => {
    await expect(parseFeedRef('https://example.com/feed', resolve)).rejects.toThrow(/feed link/)
  })
})

describe('relativeTime', () => {
  const at = Date.parse('2026-10-13T12:00:00Z')
  it.each([
    [5_000, '5s'],
    [90_000, '1m'],
    [2 * 3600_000, '2h'],
    [3 * 86400_000, '3d'],
    [-5_000, '0s'],
  ])('%i ms ago is %s', (ms, text) => {
    expect(relativeTime('2026-10-13T12:00:00Z', at + ms)).toBe(text)
  })
})

describe('column settings', () => {
  it('round-trips through export and import', () => {
    const cols = [...defaultColumns(), { id: 's', kind: 'search' as const, title: 'cats', query: 'cats' }]
    expect(parseColumns(exportColumns(cols))).toEqual(cols)
  })

  it('rejects malformed files', () => {
    expect(() => parseColumns('{"columns":[{"kind":"feed"}]}')).toThrow(/Column 1/)
    expect(() => parseColumns('{}')).toThrow(/No columns/)
  })
})

describe('showInHome', () => {
  const ME = 'did:plc:me'
  type Who = 'followed' | 'stranger' | 'me'
  const author = (who: Who) => ({
    did: who === 'me' ? ME : `did:plc:${who}`,
    handle: `${who}.test`,
    viewer: who === 'followed' ? { following: 'at://follow' } : {},
  })
  const by = (who: Who): PostView => ({ ...post(`${POST}${who}`), author: author(who) })
  const reply = (from: Who, to: Who) => ({
    post: by(from),
    reply: { root: { $type: 'app.bsky.feed.defs#postView' as const, ...by(to) }, parent: { $type: 'app.bsky.feed.defs#postView' as const, ...by(to) } },
  })

  it('shows posts that are not replies', () => {
    expect(showInHome({ post: by('followed') }, ME)).toBe(true)
  })

  it('shows a reply only when both people are followed', () => {
    expect(showInHome(reply('followed', 'followed'), ME)).toBe(true)
    expect(showInHome(reply('followed', 'stranger'), ME)).toBe(false)
    expect(showInHome(reply('stranger', 'followed'), ME)).toBe(false)
  })

  it('counts your own posts as followed', () => {
    expect(showInHome(reply('followed', 'me'), ME)).toBe(true)
    expect(showInHome(reply('me', 'followed'), ME)).toBe(true)
    expect(showInHome(reply('me', 'stranger'), ME)).toBe(false)
  })

  it('hides a reply to a post that is gone or blocked', () => {
    const v = reply('followed', 'followed')
    const gone = { $type: 'app.bsky.feed.defs#notFoundPost' as const, uri: 'at://x', notFound: true as const }
    expect(showInHome({ ...v, reply: { ...v.reply, parent: gone } }, ME)).toBe(false)
  })

  it('always shows reposts', () => {
    const repost = {
      ...reply('stranger', 'stranger'),
      reason: { $type: 'app.bsky.feed.defs#reasonRepost' as const, by: author('followed'), indexedAt: '2026-10-13T12:00:00Z' },
    }
    expect(showInHome(repost, ME)).toBe(true)
  })
})

describe('flattenThread', () => {
  const node = (uri: string, extra: object = {}) => ({ $type: 'app.bsky.feed.defs#threadViewPost', post: post(uri), ...extra })

  it('lists parents oldest first, then the post, then direct replies', () => {
    const thread = node('c', {
      parent: node('b', { parent: node('a') }),
      replies: [node('d'), { $type: 'app.bsky.feed.defs#blockedPost', uri: 'x', blocked: true }, node('e')],
    })
    const flat = flattenThread(thread)!
    expect(flat.parents.map((p) => p?.uri)).toEqual(['a', 'b'])
    expect(flat.post.uri).toBe('c')
    expect(flat.replies.map((p) => p.uri)).toEqual(['d', 'e'])
  })

  it('marks an unavailable parent and stops there', () => {
    const thread = node('c', { parent: node('b', { parent: { $type: 'app.bsky.feed.defs#notFoundPost', uri: 'a', notFound: true } }) })
    expect(flattenThread(thread)!.parents.map((p) => p?.uri ?? null)).toEqual([null, 'b'])
  })

  it('returns null when the post itself is unavailable', () => {
    expect(flattenThread({ $type: 'app.bsky.feed.defs#notFoundPost', uri: 'a', notFound: true })).toBeNull()
  })
})

describe('Arrivals', () => {
  const like = (subject: string, at: string, ...who: string[]): Item => ({
    kind: 'notif',
    key: `n:like:${subject}`,
    reason: 'like',
    authors: who.map((w) => ({ did: `did:plc:${w}`, handle: `${w}.test` })),
    indexedAt: at,
  })

  it('announces nothing on the first page', () => {
    expect(new Arrivals().note([like('a', '2026-10-13T12:00:00Z', 'x')])).toEqual([])
  })

  it('announces items that arrive later, once', () => {
    const a = new Arrivals()
    const old = like('a', '2026-10-13T12:00:00Z', 'x')
    a.note([old])
    const added = like('b', '2026-10-13T12:05:00Z', 'y')
    expect(a.note([added, old])).toEqual(['n:like:b@2026-10-13T12:05:00Z'])
    expect(a.note([added, old])).toEqual([])
  })

  it('announces a like group again when someone new joins it', () => {
    const a = new Arrivals()
    a.note([like('a', '2026-10-13T12:00:00Z', 'x')])
    expect(a.note([like('a', '2026-10-13T12:09:00Z', 'y', 'x')])).toEqual(['n:like:a@2026-10-13T12:09:00Z'])
  })

  it('ignores an older item that slides into the page', () => {
    const a = new Arrivals()
    a.note([like('b', '2026-10-13T12:05:00Z', 'y')])
    expect(a.note([like('a', '2026-10-13T11:00:00Z', 'x')])).toEqual([])
  })
})
