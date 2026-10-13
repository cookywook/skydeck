import { describe, expect, it } from 'vitest'
import type { AppBskyFeedDefs, AppBskyNotificationListNotifications } from '@atproto/api'
import { appendItems, groupNotifications, mergeItems, parseFeedRef, relativeTime, subjectUris, type Item } from './columns'
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
