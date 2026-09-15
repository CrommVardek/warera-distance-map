import type { Topology } from 'topojson-specification'

// Mirrors the tRPC-style envelope observed from the game's (undocumented) map endpoint.
export interface CountriesResponse {
  result: {
    data: {
      map: Topology
      innerCountriesTopo: Topology
      dynamicData: {
        attackLines: {
          to: [number, number]
          from: [number, number]
          toColor: string
          fromColor: string
        }[]
      }
      updatedAt: string
    }
  }
}

// import.meta.env.BASE_URL reflects vite.config.ts's `base`, so this still
// resolves correctly when the app is served from a subpath (e.g. GitHub
// Pages project sites), not just from the domain root.
const COUNTRIES_URL = `${import.meta.env.BASE_URL}data/countries.json`

export async function fetchMapData() {
  const res = await fetch(COUNTRIES_URL)
  if (!res.ok) {
    throw new Error(`Failed to load map data: ${res.status} ${res.statusText}`)
  }
  const body = (await res.json()) as CountriesResponse
  return body.result.data
}
