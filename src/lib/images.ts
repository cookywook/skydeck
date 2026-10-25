import type { BlobRef } from '@atproto/api'

export const MAX_IMAGES = 4
/** Bluesky refuses image blobs larger than this. */
export const MAX_BYTES = 1_000_000
const MAX_SIDE = 2000

export interface PreparedImage {
  blob: Blob
  width: number
  height: number
}

export interface UploadedImage {
  blob: BlobRef
  alt: string
  width: number
  height: number
}

/** Scales a width and height down (never up) so the longer side is at most `max`. */
export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * Re-encodes an image so it fits Bluesky's size limit. Drawing it to a canvas also drops EXIF data,
 * such as the location a phone photo was taken at.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('That file is not an image this browser can read.')
  })
  try {
    // PNG and WebP keep any transparency; everything else goes out as JPEG.
    const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg'
    let side = Math.min(Math.max(bitmap.width, bitmap.height), MAX_SIDE)
    for (let attempt = 0; attempt < 8; attempt++) {
      const { width, height } = fitWithin(bitmap.width, bitmap.height, side)
      const canvas = new OffscreenCanvas(width, height)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
      // Lossless PNG can only get smaller by becoming JPEG, losing any transparency.
      const lossy = type === 'image/png' ? 'image/jpeg' : type
      const tries = [{ type }, { type: lossy, quality: 0.85 }, { type: lossy, quality: 0.7 }]
      for (const options of tries) {
        const blob = await canvas.convertToBlob(options)
        if (blob.size <= MAX_BYTES) return { blob, width, height }
      }
      side = Math.round(side * 0.75)
    }
    throw new Error('That image is too large to post.')
  } finally {
    bitmap.close()
  }
}

/** The embed for a new post: its images, the post it quotes, both, or neither. */
export function postEmbed(images: UploadedImage[], quote?: { uri: string; cid: string }) {
  const media = images.length
    ? {
        $type: 'app.bsky.embed.images',
        images: images.map((img) => ({
          image: img.blob,
          alt: img.alt.trim(),
          aspectRatio: { width: img.width, height: img.height },
        })),
      }
    : undefined
  const record = quote && { $type: 'app.bsky.embed.record', record: { uri: quote.uri, cid: quote.cid } }
  if (media && record) return { $type: 'app.bsky.embed.recordWithMedia', record, media }
  return media ?? record
}
