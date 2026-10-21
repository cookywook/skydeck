import { useEffect, useMemo, useState } from 'react'
import { RichText, type AppBskyActorDefs } from '@atproto/api'
import { useApp, useNow } from '../hooks'
import { feedItem, type Item } from '../lib/columns'
import { Body, PostCard, displayName } from './PostCard'

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

function errorText(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback
}

/** Someone's profile card and their recent posts. */
export function Profile({ actor }: { actor: string }) {
  const { session } = useApp()
  const [profile, setProfile] = useState<AppBskyActorDefs.ProfileViewDetailed | null>(null)
  const [error, setError] = useState('')
  const [posts, setPosts] = useState<Item[] | null>(null)
  const [postsError, setPostsError] = useState('')
  const now = useNow(30_000)

  useEffect(() => {
    let live = true
    const agent = session.agent
    agent
      .getProfile({ actor })
      .then((res) => live && setProfile(res.data))
      .catch((e) => live && setError(errorText(e, 'Could not load this profile.')))
    agent
      .getAuthorFeed({ actor, limit: 30, filter: 'posts_and_author_threads' })
      .then((res) => live && setPosts(res.data.feed.map(feedItem)))
      .catch((e) => live && setPostsError(errorText(e, 'Could not load their posts.')))
    return () => {
      live = false
    }
  }, [session, actor])

  // Links and hashtags in a bio arrive as plain text, so find them here.
  const bio = useMemo(() => {
    if (!profile?.description) return null
    const rt = new RichText({ text: profile.description })
    rt.detectFacetsWithoutResolution()
    return rt
  }, [profile?.description])

  if (error) return <p className="error empty">{error}</p>
  if (!profile) return <p className="muted empty">Loading…</p>

  const viewer = profile.viewer
  return (
    <>
      <section className="profile">
        {profile.banner ? <img className="banner" src={profile.banner} alt="" /> : <div className="banner" />}
        <div className="profile-head">
          {profile.avatar ? <img className="avatar large" src={profile.avatar} alt="" /> : <span className="avatar large" />}
          <a
            className="muted small"
            href={`https://bsky.app/profile/${profile.handle}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Open on bsky.app
          </a>
        </div>
        <div className="profile-names">
          <strong>{displayName(profile)}</strong>
          <span className="muted">
            @{profile.handle}
            {viewer?.followedBy && <span className="pill">Follows you</span>}
            {viewer?.following && <span className="pill">Following</span>}
            {(viewer?.blocking || viewer?.blockedBy) && <span className="pill error">Blocked</span>}
            {viewer?.muted && <span className="pill">Muted</span>}
          </span>
        </div>
        {bio && <Body text={bio.text} facets={bio.facets} />}
        <div className="counts muted">
          <span>
            <strong>{compact.format(profile.followersCount ?? 0)}</strong> followers
          </span>
          <span>
            <strong>{compact.format(profile.followsCount ?? 0)}</strong> following
          </span>
          <span>
            <strong>{compact.format(profile.postsCount ?? 0)}</strong> posts
          </span>
        </div>
      </section>
      {postsError && <p className="error empty">{postsError}</p>}
      {!posts && !postsError && <p className="muted empty">Loading posts…</p>}
      {posts?.map((item) => item.kind === 'post' && <PostCard key={item.key} item={item} now={now} />)}
      {posts?.length === 0 && <p className="muted empty">No posts yet.</p>}
    </>
  )
}
