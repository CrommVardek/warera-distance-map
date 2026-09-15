import { useCallback, useEffect, useMemo, useState } from 'react'
import Map, { Layer, Source } from 'react-map-gl/maplibre'
import type { MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl'
import * as topojson from 'topojson-client'
import type { FeatureCollection, Geometry } from 'geojson'
import { fetchMapData } from './data/mapData'


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

function BaseMap() {
  const [layers, setLayers] = useState<MapLayers | null>(null)
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null)

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
        setSelectedRegionId(null)
        return
      }
      console.log(regionNameById.get(regionId) ?? '(unknown region)', regionId)
      setSelectedRegionId(regionId)
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
          zoom: 1.2,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={BASE_STYLE}
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
              <Layer
                id="regions-selected-outline"
                type="line"
                minzoom={3}
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
                minzoom={3}
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

      {selectedRegionId && hoveredRegionId && hoveredRegionId !== selectedRegionId && (
        <div className="hop-distance-bar">
          {regionNameById.get(selectedRegionId) ?? '?'} → {regionNameById.get(hoveredRegionId) ?? '?'}:{' '}
          {heatmap.distances.get(hoveredRegionId) ?? '?'} travel
          {heatmap.distances.get(hoveredRegionId) === 1 ? '' : 's'}
        </div>
      )}
    </>
  )
}

export default BaseMap
