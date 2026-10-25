import type { ColumnConfig } from './columns'

const KEY = 'skydeck.columns'

const POPULAR_WITH_FRIENDS = 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/with-friends'

export function defaultColumns(): ColumnConfig[] {
  return [
    { id: 'home', kind: 'home', title: 'Home' },
    { id: 'notifications', kind: 'notifications', title: 'Notifications' },
    { id: 'with-friends', kind: 'feed', title: 'Popular With Friends', feed: POPULAR_WITH_FRIENDS },
  ]
}

export function loadColumns(storage: Pick<Storage, 'getItem'>): ColumnConfig[] {
  try {
    const raw = storage.getItem(KEY)
    if (raw) return parseColumns(raw)
  } catch {
    // Fall through to the defaults.
  }
  return defaultColumns()
}

export function saveColumns(storage: Pick<Storage, 'setItem'>, columns: ColumnConfig[]) {
  storage.setItem(KEY, JSON.stringify(columns))
}

/** Validates an exported settings file (or stored value) and returns its columns. */
export function parseColumns(json: string): ColumnConfig[] {
  const data: unknown = JSON.parse(json)
  const list = Array.isArray(data) ? data : (data as { columns?: unknown })?.columns
  if (!Array.isArray(list)) throw new Error('No columns found in that file.')
  return list.map((c: Record<string, unknown>, i) => {
    const id = typeof c.id === 'string' ? c.id : `col-${i}`
    const title = typeof c.title === 'string' ? c.title : String(c.kind)
    switch (c.kind) {
      case 'home':
      case 'notifications':
        return { id, kind: c.kind, title }
      case 'feed':
        if (typeof c.feed === 'string') return { id, kind: 'feed', title, feed: c.feed }
        break
      case 'search':
        if (typeof c.query === 'string') return { id, kind: 'search', title, query: c.query }
        break
    }
    throw new Error(`Column ${i + 1} is not valid.`)
  })
}

export function exportColumns(columns: ColumnConfig[]): string {
  return JSON.stringify({ app: 'skydeck', version: 1, columns }, null, 2)
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

const API_KEY = 'skydeck.anthropicKey'

/** The Anthropic API key used to write alt text, or '' when none is saved. */
export function loadApiKey(storage: Pick<Storage, 'getItem'>): string {
  try {
    return storage.getItem(API_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveApiKey(storage: Pick<Storage, 'setItem' | 'removeItem'>, key: string) {
  if (key) storage.setItem(API_KEY, key)
  else storage.removeItem(API_KEY)
}
