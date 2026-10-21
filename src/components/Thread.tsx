import { useEffect, useRef, useState } from 'react'
import { useApp, useNow } from '../hooks'
import { flattenThread, type Thread as ThreadData } from '../lib/thread'
import { PostCard } from './PostCard'

/** A post with the posts it replies to above and its direct replies below. */
export function Thread({ uri }: { uri: string }) {
  const { session } = useApp()
  const [thread, setThread] = useState<ThreadData | null>(null)
  const [error, setError] = useState('')
  const focused = useRef<HTMLDivElement>(null)
  const now = useNow(30_000)

  useEffect(() => {
    let live = true
    session.agent
      .getPostThread({ uri, depth: 1, parentHeight: 30 })
      .then((res) => {
        if (!live) return
        const flat = flattenThread(res.data.thread)
        if (flat) setThread(flat)
        else setError('This post is unavailable.')
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : 'Could not load the thread.'))
    return () => {
      live = false
    }
  }, [session, uri])

  // Start at the post that was clicked; what it replies to is just above.
  useEffect(() => {
    if (thread) focused.current?.scrollIntoView({ block: thread.parents.length ? 'center' : 'start' })
  }, [thread])

  if (error) return <p className="error empty">{error}</p>
  if (!thread) return <p className="muted empty">Loading…</p>
  return (
    <>
      {thread.parents.map((post, i) =>
        post ? (
          <PostCard key={post.uri} item={{ kind: 'post', key: post.uri, post }} now={now} />
        ) : (
          <p key={i} className="post muted">
            Post unavailable
          </p>
        ),
      )}
      <div ref={focused}>
        <PostCard item={{ kind: 'post', key: thread.post.uri, post: thread.post }} now={now} current />
      </div>
      {thread.replies.map((post) => (
        <PostCard key={post.uri} item={{ kind: 'post', key: post.uri, post }} now={now} />
      ))}
    </>
  )
}
