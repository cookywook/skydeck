import { NOTIF_TEXT, type Author, type Item } from './columns'

const KEY = 'skydeck.alerts'
const MAX_BODY = 140
const MAX_LINES = 3

/** Whether this browser can show desktop notifications at all. */
export function alertsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** On only when the person turned it on here and the browser still allows it. */
export function alertsEnabled(): boolean {
  if (!alertsSupported() || Notification.permission !== 'granted') return false
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Turns desktop alerts on or off. Turning them on asks the browser for
 * permission the first time, so it must run from a click. Returns whether
 * alerts ended up on.
 */
export async function setAlertsEnabled(on: boolean): Promise<boolean> {
  if (on) {
    if (!alertsSupported()) return false
    const permission =
      Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
    if (permission !== 'granted') return false
  }
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // Still on for this visit.
  }
  return on
}

function name(a: Author): string {
  return a.displayName?.trim() || `@${a.handle}`
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_BODY ? `${flat.slice(0, MAX_BODY - 1)}…` : flat
}

function postText(record: unknown): string {
  const text = (record as { text?: unknown } | undefined)?.text
  return typeof text === 'string' ? clip(text) : ''
}

/** One line saying what happened, and the post it is about. */
export function describe(item: Item): { line: string; text: string } {
  if (item.kind === 'post') {
    return { line: `${name(item.post.author)} ${item.label ?? 'posted'}`, text: postText(item.post.record) }
  }
  const [first, ...rest] = item.authors
  const who = rest.length === 0 ? name(first) : `${name(first)} and ${rest.length} other${rest.length > 1 ? 's' : ''}`
  return { line: `${who} ${NOTIF_TEXT[item.reason] ?? item.reason}`, text: postText(item.subject?.record) }
}

/** The title and body of the alert for a batch of new notifications. */
export function summarise(items: Item[]): { title: string; body: string } {
  if (items.length === 1) {
    const { line, text } = describe(items[0])
    return { title: line, body: text }
  }
  const lines = items.slice(0, MAX_LINES).map((i) => describe(i).line)
  if (items.length > MAX_LINES) lines.push(`and ${items.length - MAX_LINES} more`)
  return { title: `${items.length} new notifications`, body: lines.join('\n') }
}

/** Shows a desktop alert for new notifications, unless the person is already looking at the app. */
export function showAlert(items: Item[]) {
  if (!items.length || !alertsEnabled()) return
  if (document.visibilityState === 'visible' && document.hasFocus()) return
  const { title, body } = summarise(items)
  try {
    // One tag, so a newer alert replaces the last instead of piling up.
    const n = new Notification(title, { body, tag: 'skydeck', icon: `${import.meta.env.BASE_URL}icon-192.png` })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch {
    // Some browsers only allow notifications from a service worker; the chime still plays.
  }
}
