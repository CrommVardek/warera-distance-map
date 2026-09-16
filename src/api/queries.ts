import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { setCredentials, useCredentials, type Credentials } from '../auth/credentials'
import { trpcQuery } from './client'
import { PROCEDURES } from './config'

// The fields this app cares about. Every one is optional because the payload
// has not been seen yet -- see the TODO on selectNickname. Once a real response
// is in hand this should be tightened to match it, and callers will stop
// needing to guard.
export interface PlayerState {
  id?: string
  username?: string
  /** Region the player is currently standing in. */
  regionId?: string
  stamina?: number
  barils?: number
}

export const playerStateKey = (credentials: Credentials | null) =>
  ['playerState', credentials?.userId ?? null, credentials?.apiKey ?? null] as const

// user.getUserLite is a fetch-by-id: it rejects a missing input with a zod
// "expected object, received undefined", and accepts { userId }.
const playerStateInput = (credentials: Credentials) => ({ userId: credentials.userId })

/**
 * The signed-in player's live state.
 *
 * Both credentials are part of the query key rather than merely closed over:
 * that is what makes swapping accounts refetch instead of serving the previous
 * player's cached answer, and it is why the store has to be reactive at all.
 */
export function usePlayerState() {
  const credentials = useCredentials()

  return useQuery({
    queryKey: playerStateKey(credentials),
    queryFn: ({ signal }) =>
      trpcQuery<PlayerState>(PROCEDURES.playerState, playerStateInput(credentials!), {
        token: credentials!.apiKey,
        signal,
      }),
    enabled: Boolean(credentials),
  })
}

export const playerLootKey = (credentials: Credentials | null) =>
  ['playerLoot', credentials?.userId ?? null, credentials?.apiKey ?? null] as const

/**
 * The player's map loot, fetched alongside the player state.
 *
 * Typed `unknown` on purpose: the payload has not been seen, and guessing at an
 * interface here would invent a shape the code then pretends to trust. Narrow it
 * once a real response is in hand.
 *
 * `getMine` derives the player from the token, so it is called with no input.
 * Auth runs before input validation on this server, so if it does turn out to
 * want one, the error will say so in a zod message.
 */
export function usePlayerLoot() {
  const credentials = useCredentials()

  return useQuery({
    queryKey: playerLootKey(credentials),
    queryFn: ({ signal }) =>
      trpcQuery<unknown>(PROCEDURES.playerLoot, undefined, {
        token: credentials!.apiKey,
        signal,
      }),
    enabled: Boolean(credentials),
  })
}

// The single place that decides which field is the player's display name.
// TODO: confirm against a real user.getUserLite payload -- `username` is a
// guess, and this is the one line that has to change once the shape is known.
export function selectNickname(player: PlayerState): string {
  return player.username ?? 'Connected'
}

/**
 * Checks candidate credentials by calling the player-state procedure with them,
 * and stores them only once the API has answered.
 *
 * Checking before persisting is the point: storing first and letting
 * usePlayerState() discover the failure would briefly render a connected panel
 * on its way to an error. trpcQuery takes the token explicitly, so the
 * candidates never have to touch the store to be tried.
 *
 * Mutations do not retry by default, so a bad id fails on the first attempt
 * rather than inheriting the query retry policy from main.tsx.
 */
export function useConnect() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (candidate: Credentials) =>
      trpcQuery<PlayerState>(PROCEDURES.playerState, playerStateInput(candidate), {
        token: candidate.apiKey,
      }),
    onSuccess: (player, candidate) => {
      setCredentials(candidate)
      // Seed the cache with the payload already in hand so the panel shows the
      // nickname immediately instead of firing a second identical request.
      queryClient.setQueryData(playerStateKey(candidate), player)
    },
  })
}
