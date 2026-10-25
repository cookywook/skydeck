import { describe, expect, it } from 'vitest'
import type { BlobRef } from '@atproto/api'
import { fitWithin, postEmbed } from './images'

const blob = { ref: 'bafy' } as unknown as BlobRef
const image = { blob, alt: '  a cat  ', width: 1200, height: 800 }
const quote = { uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'cid1' }

describe('fitWithin', () => {
  it('shrinks the longer side to the limit and keeps the shape', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(1000, 5000, 2000)).toEqual({ width: 400, height: 2000 })
  })

  it('never enlarges a small image', () => {
    expect(fitWithin(300, 200, 2000)).toEqual({ width: 300, height: 200 })
  })
})

describe('postEmbed', () => {
  it('is empty with no images or quote', () => {
    expect(postEmbed([])).toBeUndefined()
  })

  it('embeds images with trimmed alt text and their aspect ratio', () => {
    expect(postEmbed([image])).toEqual({
      $type: 'app.bsky.embed.images',
      images: [{ image: blob, alt: 'a cat', aspectRatio: { width: 1200, height: 800 } }],
    })
  })

  it('embeds a quote on its own', () => {
    expect(postEmbed([], quote)).toEqual({ $type: 'app.bsky.embed.record', record: quote })
  })

  it('combines images and a quote', () => {
    expect(postEmbed([image], quote)).toMatchObject({
      $type: 'app.bsky.embed.recordWithMedia',
      record: { $type: 'app.bsky.embed.record', record: quote },
      media: { $type: 'app.bsky.embed.images' },
    })
  })
})
