import { AppBskyFeedDefs } from '@atproto/api'

type PostView = AppBskyFeedDefs.PostView
type ThreadNode = AppBskyFeedDefs.ThreadViewPost

const asNode = (n: unknown) => (AppBskyFeedDefs.isThreadViewPost(n) ? (n as ThreadNode) : undefined)

export interface Thread {
  /** Oldest first. `null` marks a post that is deleted, blocked or otherwise unavailable. */
  parents: (PostView | null)[]
  post: PostView
  replies: PostView[]
}

/** Turns a getPostThread response into the chain above a post and the direct replies below it. */
export function flattenThread(root: unknown): Thread | null {
  const node = asNode(root)
  if (!node) return null
  const parents: (PostView | null)[] = []
  for (let p: unknown = node.parent; p; ) {
    const n = asNode(p)
    parents.unshift(n ? n.post : null)
    p = n?.parent
  }
  const replies = (node.replies ?? []).flatMap((r) => asNode(r)?.post ?? [])
  return { parents, post: node.post, replies }
}
