// The game's tRPC API. Verified to send `access-control-allow-origin: *` and to
// allow the `x-api-key` request header on preflight, so the browser can call it
// directly and this app needs no proxy of its own -- which matters, because it
// deploys to GitHub Pages and has no server in the path.
export const API_BASE_URL = 'https://api2.warera.io/trpc'

// Header the game expects a player's personal API token in.
export const API_KEY_HEADER = 'X-API-Key'

// tRPC procedure paths, kept together so the rest of the code never spells one
// out inline. Both are confirmed to exist -- an unknown path answers "No
// procedure found on path", which is how the capitalised `GetMine` was caught.
//
// They differ in one way that matters: `userMapLoot.getMine` is authenticated
// (UNAUTHORIZED without a token), whereas `user.getUserLite` is public and will
// happily answer with no key at all. Response shapes are still unverified.
export const PROCEDURES = {
  playerState: 'user.getUserLite',
  playerLoot: 'userMapLoot.getMine',
} as const
