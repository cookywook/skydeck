import Anthropic from '@anthropic-ai/sdk'

/** The stored key was refused, so the person needs to enter another. */
export class BadKeyError extends Error {
  constructor() {
    super('Anthropic did not accept that API key.')
    this.name = 'BadKeyError'
  }
}

const SYSTEM = `You write alt text for images in Bluesky posts, for people using screen readers.
Describe what matters about the image in one or two plain sentences; add more only for screenshots or images whose text carries the meaning, and transcribe that text.
Do not start with "Image of" or "A picture of", and do not guess at who real people are.
Reply with the alt text alone.`

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Asks Claude to describe an image, using the post's text (if any) as context. */
export async function describeImage(apiKey: string, image: Blob, postText: string): Promise<string> {
  // The key belongs to the person using the app and stays in their browser.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const context = postText.trim()
    ? `The post this image is attached to says:\n<post>${postText.trim()}</post>`
    : 'The post has no text yet.'
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: image.type as ImageType, data: await base64(image) },
            },
            { type: 'text', text: `${context}\n\nWrite the alt text for this image.` },
          ],
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to describe this image.')
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim()
    if (!text) throw new Error('Claude did not return a description.')
    return text
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new BadKeyError()
    }
    if (err instanceof Anthropic.RateLimitError) throw new Error('Claude is busy right now; try again shortly.')
    throw err
  }
}
