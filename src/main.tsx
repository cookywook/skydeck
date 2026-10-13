import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AtpAgent } from '@atproto/api'
import { App } from './App'
import { SessionManager, SessionStore } from './lib/session'
import './styles.css'

// bsky.social routes sign-in for every Bluesky-hosted account; after login the
// agent talks to the account's own server.
const SERVICE = 'https://bsky.social'

const session = new SessionManager(
  new SessionStore(localStorage),
  (persistSession) => new AtpAgent({ service: SERVICE, persistSession }),
)
void session.start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
)
