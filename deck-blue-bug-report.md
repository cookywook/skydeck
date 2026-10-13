# deck.blue bug report: columns silently stop updating after sleep when the session refresh is rejected

## Summary

After my Mac has been asleep for a while, deck.blue stops loading new posts in every column. The app looks alive (relative timestamps keep counting up) but nothing new arrives until I reload the page. The console shows `com.atproto.server.refreshSession` returning 400 over and over, followed by 400s on every other request. A reload fixes it immediately, with no need to sign in again.

It happens on both of my machines, which run deck.blue on the same account.

## Environment

- deck.blue v2.24.7+1068
- Installed as a Chrome web app (PWA), Google Chrome 155.0.8059.40
- macOS 26.6.2 (25G83), Apple M1
- Same deck.blue account and Bluesky account open on a second laptop (same setup)
- PDS host: lionsmane.us-east.host.bsky.network

## Steps to reproduce

1. Open deck.blue on two devices (or two browser profiles/windows) signed in to the same account.
2. Put device A to sleep for several hours (long enough for device B's copy to refresh the Bluesky session at least once). Leave deck.blue open on device B.
3. Wake device A and look at deck.blue.

## Expected

Columns resume updating after wake. If the stored refresh token is no longer valid, the app fetches the current session (as it evidently does on a page reload) or shows an error / asks me to sign in again.

## Actual

- No column updates. In my case the Home column was stuck on posts from about 20 hours earlier, i.e. from when the Mac went to sleep.
- No error is shown in the UI. Post ages keep updating ("20h", "21h"), so the app appears to be working.
- The state does not recover on its own. I checked about two minutes after wake and it was still stuck; previously I have seen it stay stuck until reloaded.
- Reloading the page (Cmd+R) restores everything straight away without a new sign-in.

## Console output while stuck

162 errors, in this pattern:

```
POST https://lionsmane.us-east.host.bsky.network/xrpc/com.atproto.server.refreshSession 400 (Bad Request)   main.dart.js:217115
POST https://lionsmane.us-east.host.bsky.network/xrpc/com.atproto.server.refreshSession 400 (Bad Request)   main.dart.js:217115
POST https://lionsmane.us-east.host.bsky.network/xrpc/com.atproto.server.refreshSession 400 (Bad Request)   main.dart.js:217115
GET  https://lionsmane.us-east.host.bsky.network/xrpc/app.bsky.notification.listNotifications?...  400 (Bad Request)   main.dart.js:217115
Failed to load resource: the server responded with a status of 400 ()   ...refreshSession
Failed to load resource: the server responded with a status of 400 ()   ...getUnreadCount
```

I did not capture the response bodies, so I can't confirm the exact error code (I'd guess `ExpiredToken` or `InvalidToken`).

## Comparison that points at the cause

For one sleep (22:54 to 19:11 the next day) I had a second copy of deck.blue open in a normal Chrome tab on the same Mac, same account, with a logger recording every `getTimeline` call:

- The tab's copy polled successfully during the Mac's hourly maintenance wakes through the sleep, and its session refreshes succeeded.
- On wake, the tab's copy resumed 15-second polling within 8 seconds, all 200s.
- The installed PWA copy, asleep over the same period and holding its own in-memory session, got 400 on every `refreshSession` after wake and never recovered.

Before the sleep, both copies ran side by side for 45 minutes with no errors.

## Suspected cause (my inference, not confirmed)

Bluesky refresh tokens are single-use. Two running copies of deck.blue on one account appear to share one session. When one copy refreshes, the other copy's in-memory refresh token becomes invalid. A copy that is awake seems to pick up the new session; a copy that was asleep comes back holding the stale token, gets 400 from `refreshSession`, and keeps retrying with the same token instead of re-reading the current session.

A refresh that is interrupted by the machine going back to sleep (request sent, response never processed) might produce the same state with only one device, but I haven't observed that.

## Suggested handling

- When `refreshSession` returns 400, re-fetch the stored session before retrying, rather than retrying with the same token.
- If that also fails, surface it: a banner or a sign-in prompt, instead of columns that silently stop.
- Possibly re-check the session on `visibilitychange` / after a long timer gap, since that is when the stale state appears.

## Workaround

Reload the page after waking the machine.
