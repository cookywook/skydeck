import { useEffect, useRef, useState } from 'react'
import { useApp, useNow } from '../hooks'
import { flattenThread, type Thread as ThreadData } from '../lib/thread'
import { PostCard } from './PostCard'

/** A thread shown inside its column, over the column's own posts. */
export function Thread({ uri, onBack, onClose }: { uri: string; onBack(): void; onClose(): void }) {
  const { session } = useApp()
  const [thread, setThread] = useState<ThreadData | null>(null)
  const [error, setError] = useState('')
  const focused = useRef<HTMLDivElement>(null)
  const now = useNow(30_000)

  useEffect(() => {
    let live = true
    setThread(null)
    setError('')
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

  return (
    <div className="thread">
      <div className="thread-bar">
        <button type="button" onClick={onBack}>
          ‹ Back
        </button>
        <strong>Thread</strong>
        <button type="button" title="Close thread" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="scroll">
        {error && <p className="error empty">{error}</p>}
        {!thread && !error && <p className="muted empty">Loading…</p>}
        {thread && (
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
        )}
      </div>
    </div>
  )
}
