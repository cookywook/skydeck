# skydeck

A small multi-column Bluesky client: Home, Notifications, feeds and saved searches side by side.

It exists because a deck-style client should never go quietly stale. Every column shows when it last
updated, and a login that can no longer be renewed produces a sign-in prompt rather than old posts.

## Use it

Open <https://cookywook.github.io/skydeck/> and sign in with your handle and an
[app password](https://bsky.app/settings/app-passwords). In Chrome, use *Cast, save and share → Install page
as app* to give it its own window.

Sign in separately on each device. Each one then holds its own login, so they cannot invalidate each other.

- **＋** adds a search or feed column (paste a `bsky.app/profile/…/feed/…` link).
- **⤓ / ⤒** export and import your columns as a JSON file, to copy them to another device.
- Like, repost and reply from any post; **✎** writes a new post (⌘/Ctrl + Enter sends).
- Attach up to four images to a post or reply with **🖼 Image**, or paste or drop them into the composer.
  They are resized and re-encoded before upload, which also strips location data from photos.

## What is stored

Everything stays in your browser's local storage: the login tokens Bluesky returns and your column list.
The app password is sent only to Bluesky and is not kept. There is no skydeck server; the page is static
files and talks directly to Bluesky.

## Not yet

Posting video, in-app video playback, full thread view, multiple accounts, moderation settings,
lists and DMs. Accounts on a self-hosted PDS need the service address in `src/main.tsx` changed.

## Develop

```bash
npm install
npm run dev     # http://localhost:5199
npm test
npm run build
```

- `src/lib/session.ts` owns the login, including recovery when a refresh token is rejected.
- `src/lib/poller.ts` is the polling loop and the wake-from-sleep detection.
- `src/lib/columns.ts` fetches and shapes each kind of column.

Pushing to `main` runs the tests and deploys to GitHub Pages.
