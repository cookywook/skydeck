import { describe, expect, it } from 'vitest'
import type { AppBskyFeedDefs, AppBskyNotificationListNotifications } from '@atproto/api'
import {
  Arrivals,
  appendItems,
  groupNotifications,
  mergeItems,
  parseFeedRef,
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

const keys = (items: Item[]) => items.map((i) => i.key)

describe('mergeItems', () => {
  it('puts new items on top and keeps older ones once', () => {
    expect(keys(mergeItems([item('c'), item('b')], [item('b'), item('a')]))).toEqual(['c', 'b', 'a'])
  })

  it('prefers the fresh copy of an item', () => {
    const fresh = { ...item('a'), label: 'fresh' }
    expect(mergeItems([fresh], [item('a')])[0]).toBe(fresh)
  })

  it('caps the list', () => {
    expect(keys(mergeItems([item('c')], [item('b'), item('a')], 2))).toEqual(['c', 'b'])
  })
})

describe('appendItems', () => {
  it('adds an older page without duplicates', () => {
    expect(keys(appendItems([item('c'), item('b')], [item('b'), item('a')]))).toEqual(['c', 'b', 'a'])
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
