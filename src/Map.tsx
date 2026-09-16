import { useCallback, useEffect, useMemo, useState } from 'react'
import Map, { Layer, Source } from 'react-map-gl/maplibre'
import type {
  DataDrivenPropertyValueSpecification,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapLibreEvent,
  ResolvedImageSpecification,
  StyleSpecification,
} from 'maplibre-gl'
import * as topojson from 'topojson-client'
import type { FeatureCollection, Geometry } from 'geojson'
import { fetchMapData } from './data/mapData'
import DistanceHistogram from './DistanceHistogram'
import HopDistanceBar from './HopDistanceBar'


// No raster/vector tile basemap: the game ships its own world landmass and
// country polygons, so the map is built entirely from that vector data.
const BASE_STYLE: StyleSpecification = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0b1c33' } },
  ],
}

// Regions further than this many travels also get a dot stipple painted on top
// of the heatmap gradient, getting denser the further away the region is.
// MapLibre can't vary a fill-pattern's geometry per feature, so one tile is
// pre-rendered per density bucket and a `step` expression picks between them.
// Each bucket shrinks the tile (denser dots) and grows the radius (bigger
// dots), so distance reads as steadily heavier stipple. Both are css px.
const DOTS_MIN_DISTANCE = 10
const DOTS_COLOR = '#3a3a3a'
const DOTS_PIXEL_RATIO = 2
const DOTS_LEVELS = [
  { minDistance: DOTS_MIN_DISTANCE + 1, tile: 9.25, radius: 0.4 },
  { minDistance: DOTS_MIN_DISTANCE + 2, tile: 9, radius: 0.6 },
  { minDistance: DOTS_MIN_DISTANCE + 3, tile: 8, radius: 0.75 },
  { minDistance: DOTS_MIN_DISTANCE + 4, tile: 7.5, radius: 1 },
  { minDistance: DOTS_MIN_DISTANCE + 5, tile: 7, radius: 1.25 },
  { minDistance: DOTS_MIN_DISTANCE + 6, tile: 6.5, radius: 1.5 },
  { minDistance: DOTS_MIN_DISTANCE + 7, tile: 6.25, radius: 1.75 },
  { minDistance: DOTS_MIN_DISTANCE + 8, tile: 6, radius: 2 },
]

const dotsImageId = (index: number) => `dots-${index}`

// Two dots per tile on opposite quarter-points, which lays them out as a
// diagonal lattice rather than a square grid. Each dot is stamped at every
// wrapped position too, so one straddling a tile edge still tiles seamlessly.
function createDotsImage(tile: number, radius: number): ImageData {
  const size = Math.round(tile * DOTS_PIXEL_RATIO)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = DOTS_COLOR
  for (const center of [0.25, 0.75]) {
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        ctx.beginPath()
        ctx.arc(center * size + dx, center * size + dy, radius * DOTS_PIXEL_RATIO, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  return ctx.getImageData(0, 0, size, size)
}

function registerDotsImages(map: MapLibreMap) {
  DOTS_LEVELS.forEach((level, index) => {
    const id = dotsImageId(index)
    if (map.hasImage(id)) return
    map.addImage(id, createDotsImage(level.tile, level.radius), { pixelRatio: DOTS_PIXEL_RATIO })
  })
}

// ['step', hopDistance, 'dots-0', 13, 'dots-1', 15, 'dots-2', ...]
const DOTS_PATTERN: DataDrivenPropertyValueSpecification<ResolvedImageSpecification> = [
  'step',
  ['get', 'hopDistance'],
  dotsImageId(0),
  ...DOTS_LEVELS.slice(1).flatMap((level, index) => [level.minDistance, dotsImageId(index + 1)]),
] as unknown as DataDrivenPropertyValueSpecification<ResolvedImageSpecification>


interface MapLayers {
  lands: FeatureCollection
  countries: FeatureCollection
  countryLabels: FeatureCollection<Geometry, { countryName: string; textSize: number; textColor: string; strokeColor: string }>
  regions: FeatureCollection<
    Geometry,
    { regionId: string; lineColor: string; position: [number, number]; neighbors: string[] }
  >
  regionLabels: FeatureCollection<Geometry, { regionId: string; name: string; textColor: string; strokeColor: string }>
}

// Unweighted, undirected adjacency graph -> plain BFS gives the shortest
// hop count ("travels") from sourceId to every reachable region, plus a
// predecessor map so the actual shortest path can be reconstructed later.
function computeHopDistances(sourceId: string, adjacency: globalThis.Map<string, string[]>) {
  const distances = new globalThis.Map<string, number>([[sourceId, 0]])
  const predecessors = new globalThis.Map<string, string>()
  const queue = [sourceId]
  let head = 0
  while (head < queue.length) {
    const current = queue[head++]
    const currentDistance = distances.get(current)!
    for (const neighborId of adjacency.get(current) ?? []) {
      if (!distances.has(neighborId)) {
        distances.set(neighborId, currentDistance + 1)
        predecessors.set(neighborId, current)
        queue.push(neighborId)
      }
    }
  }
  return { distances, predecessors }
}

function buildPath(
  sourceId: string,
  targetId: string,
  predecessors: globalThis.Map<string, string>,
): string[] {
  const path = [targetId]
  let current = targetId
  while (current !== sourceId) {
    const previous = predecessors.get(current)
    if (!previous) return [] // unreachable
    path.push(previous)
    current = previous
  }
  return path.reverse()
}

// countryLabels/regionLabels store already-real lon/lat in `coordinates`
// (verified against each country's own polygon centroid), unlike every other
// object in this topology, whose coordinates are quantized and need the
// topology's transform applied. Running these two through topojson.feature()
// re-applies that transform on top of already-real coordinates, collapsing
// every label toward the transform's translate origin. So they're read
// directly instead of going through topojson-client.
type RawPointGeometryCollection = {
  geometries: { coordinates: [number, number]; properties: Record<string, unknown> }[]
}

function pointsToFeatureCollection(geometryCollection: RawPointGeometryCollection): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geometryCollection.geometries.map((geometry) => ({
      type: 'Feature' as const,
      properties: geometry.properties,
      geometry: { type: 'Point' as const, coordinates: geometry.coordinates },
    })),
  }
}

// The selected region is the whole app state, so it lives in the query string:
// ?region=<regionId> makes a heatmap shareable and survives a reload. There is
// no router here, so this pokes at history directly.
const REGION_PARAM = 'region'

function readRegionFromUrl() {
  return new URLSearchParams(window.location.search).get(REGION_PARAM)
}

function writeRegionToUrl(regionId: string | null, { replace = false } = {}) {
  const url = new URL(window.location.href)
  if (regionId) url.searchParams.set(REGION_PARAM, regionId)
  else url.searchParams.delete(REGION_PARAM)
  if (replace) window.history.replaceState(null, '', url)
  else window.history.pushState(null, '', url)
}

function BaseMap() {
  const [layers, setLayers] = useState<MapLayers | null>(null)
  const [requestedRegionId, setRequestedRegionId] = useState<string | null>(readRegionFromUrl)
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null)
  const [dotsReady, setDotsReady] = useState(false)

  const handleLoad = useCallback((event: MapLibreEvent) => {
    registerDotsImages(event.target)
    setDotsReady(true)
  }, [])

  useEffect(() => {
    let cancelled = false

    fetchMapData()
      .then((data) => {
        if (cancelled) return
        const { objects } = data.map
        setLayers({
          lands: topojson.feature(data.map, objects.lands) as FeatureCollection,
          countries: topojson.feature(data.map, objects.countries) as FeatureCollection,
          countryLabels: pointsToFeatureCollection(
            objects.countryLabels as unknown as RawPointGeometryCollection,
          ) as MapLayers['countryLabels'],
          regions: topojson.feature(data.map, objects.regions) as MapLayers['regions'],
          regionLabels: pointsToFeatureCollection(
            objects.regionLabels as unknown as RawPointGeometryCollection,
          ) as MapLayers['regionLabels'],
        })
      })
      .catch((err) => {
        console.error('Failed to load map data', err)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Back/forward move through previously selected regions.
  useEffect(() => {
    const syncFromUrl = () => setRequestedRegionId(readRegionFromUrl())
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [])

  const regionNameById = useMemo(() => {
    const map = new globalThis.Map<string, string>()
    for (const feature of layers?.regionLabels.features ?? []) {
      map.set(feature.properties.regionId, feature.properties.name)
    }
    return map
  }, [layers])

  const adjacency = useMemo(() => {
    const map = new globalThis.Map<string, string[]>()
    for (const feature of layers?.regions.features ?? []) {
      map.set(feature.properties.regionId, feature.properties.neighbors)
    }
    return map
  }, [layers])

  // A ?region= pointing at something this map doesn't have would otherwise BFS
  // from a phantom node and paint every region as unreachable, so it is dropped
  // rather than selected -- both here and (once the data is in) from the url.
  const selectedRegionId =
    requestedRegionId && layers && !adjacency.has(requestedRegionId) ? null : requestedRegionId

  useEffect(() => {
    if (!layers || !requestedRegionId || adjacency.has(requestedRegionId)) return
    console.warn('Unknown region in url, ignoring:', requestedRegionId)
    writeRegionToUrl(null, { replace: true })
  }, [layers, requestedRegionId, adjacency])

  const positionById = useMemo(() => {
    const map = new globalThis.Map<string, [number, number]>()
    for (const feature of layers?.regions.features ?? []) {
      map.set(feature.properties.regionId, feature.properties.position)
    }
    return map
  }, [layers])

  const handleClick = useCallback(
    (event: MapLayerMouseEvent) => {
      const regionId = event.features?.[0]?.properties?.regionId as string | undefined
      if (!regionId) {
        setRequestedRegionId(null)
        writeRegionToUrl(null)
        return
      }
      console.log(regionNameById.get(regionId) ?? '(unknown region)', regionId)
      setRequestedRegionId(regionId)
      writeRegionToUrl(regionId)
    },
    [regionNameById],
  )

  const handleHover = useCallback((event: MapLayerMouseEvent) => {
    setHoveredRegionId((event.features?.[0]?.properties?.regionId as string | undefined) ?? null)
  }, [])

  const handleMouseLeave = useCallback(() => setHoveredRegionId(null), [])

  // Annotates every region with its BFS hop-distance ("travels") from the
  // selected region, so a single data-driven paint expression can render the
  // whole world as a green (near) -> red (far) heatmap. hopDistance is -1
  // when nothing is selected, which the fill-opacity expression treats as
  // "hidden" (the layer then only serves as an invisible click target).
  const heatmap = useMemo(() => {
    const empty = {
      data: { type: 'FeatureCollection' as const, features: [] },
      maxHop: 1,
      distances: new globalThis.Map<string, number>(),
      predecessors: new globalThis.Map<string, string>(),
    }
    if (!layers) return empty

    const bfs = selectedRegionId ? computeHopDistances(selectedRegionId, adjacency) : null
    const distances = bfs?.distances ?? empty.distances
    const predecessors = bfs?.predecessors ?? empty.predecessors
    const maxHop = bfs ? Math.max(1, ...distances.values()) : 1

    const features = layers.regions.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        hopDistance: bfs ? (distances.get(feature.properties.regionId) ?? maxHop) : -1,
      },
    }))

    return { data: { type: 'FeatureCollection' as const, features }, maxHop, distances, predecessors }
  }, [layers, selectedRegionId, adjacency])

  // The shortest path (sequence of regionIds) from the selected region to
  // whichever region is currently hovered, reconstructed from the same BFS
  // pass used to paint the heatmap.
  const hoverPath = useMemo(() => {
    if (!selectedRegionId || !hoveredRegionId || hoveredRegionId === selectedRegionId) return []
    return buildPath(selectedRegionId, hoveredRegionId, heatmap.predecessors)
  }, [selectedRegionId, hoveredRegionId, heatmap.predecessors])

  const hoverPathLinks = useMemo<FeatureCollection>(() => {
    const features = []
    for (let i = 0; i < hoverPath.length - 1; i++) {
      const from = positionById.get(hoverPath[i])
      const to = positionById.get(hoverPath[i + 1])
      if (!from || !to) continue
      features.push({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: [from, to] },
      })
    }
    return { type: 'FeatureCollection', features }
  }, [hoverPath, positionById])

  return (
    <>
      <Map
        initialViewState={{
          longitude: 10,
          latitude: 20,
          zoom: 3,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={BASE_STYLE}
        onLoad={handleLoad}
        interactiveLayerIds={layers ? ['regions-fill'] : []}
        onClick={handleClick}
        onMouseMove={handleHover}
        onMouseOut={handleMouseLeave}
      >
        {layers && (
          <>
            <Source id="lands" type="geojson" data={layers.lands}>
              <Layer id="lands-fill" type="fill" paint={{ 'fill-color': '#1c2e4a' }} />
            </Source>

            <Source id="countries" type="geojson" data={layers.countries}>
              <Layer
                id="countries-fill"
                type="fill"
                paint={{
                  'fill-color': ['get', 'fillColor'],
                  'fill-opacity': selectedRegionId ? 1 : 0,
                }}
              />
              <Layer
                id="countries-outline"
                type="line"
                paint={{
                  'line-color': selectedRegionId ? ['get', 'outlineColor'] : '#5a5a5a',
                  'line-width': 1,
                }}
              />
            </Source>

            <Source id="regions" type="geojson" data={heatmap.data}>
              {/* also doubles as the heatmap fill once a region is selected: no
                  minzoom, so the heatmap stays visible even fully zoomed out */}
              <Layer
                id="regions-fill"
                type="fill"
                paint={{
                  'fill-color': [
                    'interpolate',
                    ['linear'],
                    ['get', 'hopDistance'],
                    0, '#2ecc71',
                    heatmap.maxHop / 2, '#f1c40f',
                    heatmap.maxHop, '#e74c3c',
                  ],
                  'fill-opacity': ['case', ['==', ['get', 'hopDistance'], -1], 0, 0.9],
                }}
              />
              {/* dot stipple over the far-away regions; denser the further out */}
              {dotsReady && (
                <Layer
                  id="regions-dots"
                  type="fill"
                  filter={['>', ['get', 'hopDistance'], DOTS_MIN_DISTANCE]}
                  paint={{
                    'fill-pattern': DOTS_PATTERN,
                    'fill-opacity': 0.85,
                  }}
                />
              )}
              <Layer
                id="regions-outline"
                type="line"
                minzoom={3}
                paint={{
                  'line-color': selectedRegionId ? '#000000' : '#cccccc',
                  'line-width': 0.6,
                  'line-opacity': selectedRegionId ? 0.8 : 0.6,
                }}
              />
              {/* no minzoom, unlike regions-outline: the selection has to stay
                  visible however far out you zoom */}
              <Layer
                id="regions-selected-outline"
                type="line"
                filter={['==', ['get', 'regionId'], selectedRegionId ?? '']}
                paint={{ 'line-color': '#ffffff', 'line-width': 2.5 }}
              />
            </Source>

            <Source id="hover-path" type="geojson" data={hoverPathLinks}>
              <Layer
                id="hover-path-glow"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': '#ffffff', 'line-width': 8, 'line-blur': 4, 'line-opacity': 0.35 }}
              />
              <Layer
                id="hover-path-core"
                type="line"
                layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                paint={{ 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.95 }}
              />
            </Source>

            <Source id="region-labels" type="geojson" data={layers.regionLabels}>
              <Layer
                id="region-labels-symbol"
                type="symbol"
                minzoom={4}
                layout={{
                  'text-field': ['get', 'name'],
                  'text-size': 11,
                  'text-font': ['Noto Sans Regular'],
                }}
                paint={{
                  'text-color': '#ffffff',
                  'text-halo-color': '#000000',
                  'text-halo-width': 1,
                }}
              />
            </Source>
          </>
        )}
      </Map>

      {layers && selectedRegionId && (
        <DistanceHistogram
          regionName={regionNameById.get(selectedRegionId) ?? '?'}
          distances={heatmap.distances}
          totalRegions={layers.regions.features.length}
        />
      )}

      {selectedRegionId && hoveredRegionId && hoveredRegionId !== selectedRegionId && (
        <HopDistanceBar
          fromName={regionNameById.get(selectedRegionId) ?? '?'}
          toName={regionNameById.get(hoveredRegionId) ?? '?'}
          travels={heatmap.distances.get(hoveredRegionId)}
        />
      )}
    </>
  )
}

export default BaseMap
