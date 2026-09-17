import { buildPath, computeHopDistances, type Adjacency } from './graph'

// The game only ever holds five of your crates on the map at once.
export const MAX_CASES = 5

// While set, a click on the map assigns that role instead of moving the
// heatmap's origin.
export type PickMode = 'home' | 'case' | null

export interface RouteStep {
  caseId: string
  // Travels walked to reach this crate, home hop excluded since it is free.
  travels: number
  // True when going home first and walking out from there beats walking
  // straight from the previous crate.
  viaHome: boolean
  // Regions walked through, starting at wherever the walk began.
  path: string[]
}

export interface Route {
  steps: RouteStep[]
  travels: number
  // Crates on a landmass no route from home reaches, so never collectable.
  unreachable: string[]
}

// Travelling home is free and can be done from anywhere at any time, so the
// only real choice is the order the crates are collected in: the cost of the
// leg into a crate is already fixed at min(walk from where you stand, walk
// from home). That makes this a small asymmetric TSP with a fixed start and a
// free end, which the usual Held-Karp pass over subsets solves exactly --
// 2^5 x 5 states here, so "best" really is best and not a heuristic.
export function planRoute(homeId: string, caseIds: string[], adjacency: Adjacency): Route {
  // One BFS per distinct origin (home + each crate), memoised: at most six
  // passes over 726 nodes, and the predecessors double as the drawn path.
  const searches = new Map<string, ReturnType<typeof computeHopDistances>>()
  const searchFrom = (regionId: string) => {
    let search = searches.get(regionId)
    if (!search) {
      search = computeHopDistances(regionId, adjacency)
      searches.set(regionId, search)
    }
    return search
  }
  const distance = (fromId: string, toId: string) => searchFrom(fromId).distances.get(toId)

  // A crate home cannot reach is on another landmass, so no ordering saves it.
  const homeDistances = searchFrom(homeId).distances
  const crates = [...new Set(caseIds)].filter((id) => homeDistances.has(id))
  const unreachable = [...new Set(caseIds)].filter((id) => !homeDistances.has(id))
  if (crates.length === 0) return { steps: [], travels: 0, unreachable }

  // Reaching a crate never costs more than walking out from home, because the
  // trip home is free from wherever you are standing.
  const legCost = (fromId: string, toId: string) =>
    Math.min(distance(fromId, toId) ?? Infinity, homeDistances.get(toId)!)

  const count = crates.length
  const stateCount = 1 << count
  const best = Array.from({ length: stateCount }, () => new Array<number>(count).fill(Infinity))
  const cameFrom = Array.from({ length: stateCount }, () => new Array<number>(count).fill(-1))

  for (let crate = 0; crate < count; crate++) {
    best[1 << crate][crate] = homeDistances.get(crates[crate])!
  }
  for (let collected = 1; collected < stateCount; collected++) {
    for (let last = 0; last < count; last++) {
      const costSoFar = best[collected][last]
      if (!(collected & (1 << last)) || costSoFar === Infinity) continue
      for (let next = 0; next < count; next++) {
        if (collected & (1 << next)) continue
        const total = costSoFar + legCost(crates[last], crates[next])
        const reached = collected | (1 << next)
        if (total < best[reached][next]) {
          best[reached][next] = total
          cameFrom[reached][next] = last
        }
      }
    }
  }

  // The trip ends wherever the last crate is -- going home afterwards is free.
  const allCollected = stateCount - 1
  let endsAt = 0
  for (let crate = 1; crate < count; crate++) {
    if (best[allCollected][crate] < best[allCollected][endsAt]) endsAt = crate
  }

  const order: number[] = []
  let collected = allCollected
  let current = endsAt
  while (current !== -1) {
    order.push(current)
    const previous = cameFrom[collected][current]
    collected ^= 1 << current
    current = previous
  }
  order.reverse()

  const steps: RouteStep[] = []
  let position = homeId
  for (const crate of order) {
    const caseId = crates[crate]
    const direct = distance(position, caseId) ?? Infinity
    const fromHome = homeDistances.get(caseId)!
    const viaHome = fromHome < direct
    const walkFrom = viaHome ? homeId : position
    steps.push({
      caseId,
      travels: viaHome ? fromHome : direct,
      viaHome,
      path: buildPath(walkFrom, caseId, searchFrom(walkFrom).predecessors),
    })
    position = caseId
  }

  return { steps, travels: best[allCollected][endsAt], unreachable }
}
