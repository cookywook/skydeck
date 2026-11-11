import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AtpAgent } from '@atproto/api'
import { App } from './App'
import { armChime } from './lib/chime'
import { SessionManager, SessionStore } from './lib/session'
import './styles.css'

// bsky.social routes sign-in for every Bluesky-hosted account; after login the
// agent talks to the account's own server.
const SERVICE = 'https://bsky.social'

const session = new SessionManager(
  new SessionStore(localStorage),
  (persistSession) => new AtpAgent({ service: SERVICE, persistSession }),
  (agent, tokens) => {
    agent.sessionManager.session = tokens
  },
)

// Inside another site's frame the deck could be overlaid to trick clicks on Like,
// Repost or Follow. A static page cannot send the header that forbids framing,
// so the app declines to start there.
const framed = window.top !== window.self
if (!framed) {
  void session.start()
  armChime()
}

// Lets the stylesheet hold a new notification's highlight until the window is actually in view.
const markHidden = () => document.documentElement.toggleAttribute('data-hidden', document.visibilityState !== 'visible')
document.addEventListener('visibilitychange', markHidden)
markHidden()

createRoot(document.getElementById('root')!).render(
  framed ? (
    <p className="splash muted">skydeck does not run inside another page.</p>
  ) : (
    <StrictMode>
      <App session={session} />
    </StrictMode>
  ),
)
