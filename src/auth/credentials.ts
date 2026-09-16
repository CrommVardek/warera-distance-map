import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'warera.credentials'

export interface Credentials {
  apiKey: string
  /** The id at the end of the player's WarEra profile URL. */
  userId: string
}

// Both halves live in one record under one key so connecting and disconnecting
// are single atomic writes. Two parallel entries would make it possible to clear
// one and leave the other stranded.
//
// localStorage is an external mutable store, so it is read through
// useSyncExternalStore rather than mirrored into component state: reactive with
// no provider, and subscribing to the `storage` event means credentials set in
// one tab reach the others for free.
const listeners = new Set<() => void>()

// useSyncExternalStore compares snapshots by identity and re-renders on any
// change, so parsing the JSON afresh on every read would hand back a new object
// each time and spin forever. Caching against the raw string keeps the identity
// stable for as long as the stored text is unchanged.
let cachedRaw: string | null = null
let cachedCredentials: Credentials | null = null

function parseCredentials(raw: string | null): Credentials | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Credentials>
    if (!parsed?.apiKey || !parsed?.userId) return null
    return { apiKey: parsed.apiKey, userId: parsed.userId }
  } catch {
    return null // corrupt or hand-edited; treat as not connected
  }
}

export function getCredentials(): Credentials | null {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Throws in private-mode and blocked-cookie contexts; the app has to work
    // without credentials anyway, so treat the failure as "not connected".
    raw = null
  }

  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedCredentials = parseCredentials(raw)
  }
  return cachedCredentials
}

export function setCredentials(credentials: Credentials | null) {
  try {
    if (credentials) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing useful to do: the value simply will not survive a reload.
  }
  // Fired regardless of whether the write landed, so the UI reflects the
  // attempt. The `storage` event only fires in *other* tabs, never this one.
  for (const listener of listeners) listener()
}

export function subscribeToCredentials(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

// null while nothing is stored. Safe to call anywhere; there is no provider to
// forget to mount.
export function useCredentials(): Credentials | null {
  return useSyncExternalStore(
    subscribeToCredentials,
    getCredentials,
    () => null, // no localStorage when prerendering
  )
}
