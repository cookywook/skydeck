import { describe as group, expect, it } from 'vitest'
import type { AppBskyFeedDefs } from '@atproto/api'
import { summarise } from './alerts'
import type { Author, Item } from './columns'

const alice: Author = { did: 'did:a', handle: 'alice.test', displayName: 'Alice' }
const bob: Author = { did: 'did:b', handle: 'bob.test' }
const carol: Author = { did: 'did:c', handle: 'carol.test', displayName: '  ' }

function post(author: Author, text: string): AppBskyFeedDefs.PostView {
  return { uri: `at://${author.did}/app.bsky.feed.post/1`, cid: 'c', author, record: { text }, indexedAt: '2026-01-01T00:00:00Z' }
}

const like = (authors: Author[]): Item => ({
  kind: 'notif',
  key: 'n:like:x',
  reason: 'like',
  authors,
  indexedAt: '2026-01-01T00:00:00Z',
  subject: post(alice, 'my post'),
})

group('summarise', () => {
  it('names one person and shows the post', () => {
    expect(summarise([like([bob])])).toEqual({ title: '@bob.test liked your post', body: 'my post' })
  })

  it('counts the others in a group', () => {
    expect(summarise([like([alice, bob])]).title).toBe('Alice and 1 other liked your post')
    expect(summarise([like([alice, bob, carol])]).title).toBe('Alice and 2 others liked your post')
  })

  it('falls back to the handle for a blank display name', () => {
    expect(summarise([like([carol])]).title).toBe('@carol.test liked your post')
  })

  it('uses the label of a reply and shortens long text', () => {
    const reply: Item = { kind: 'post', key: 'n:r', post: post(bob, 'x'.repeat(300)), label: 'replied to you' }
    const { title, body } = summarise([reply])
    expect(title).toBe('@bob.test replied to you')
    expect(body).toHaveLength(140)
    expect(body.endsWith('…')).toBe(true)
  })

  it('lists the first few of a batch', () => {
    const { title, body } = summarise([like([alice]), like([bob]), like([carol]), like([alice]), like([bob])])
    expect(title).toBe('5 new notifications')
    expect(body.split('\n')).toEqual([
      'Alice liked your post',
      '@bob.test liked your post',
      '@carol.test liked your post',
      'and 2 more',
    ])
  })
})
