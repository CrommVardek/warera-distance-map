import { useMemo } from 'react'

// The breakdown is per-step up to MAX_STEP, then one open-ended bucket: past
// this point the trip is paid in barils anyway, so the exact step stops
// mattering and the tail would just be a long thin drift of counts.
const MAX_STEP = 10

const CRATE_ICON_URL = 'https://media.warera.io/images/itemsv2/woodenCase.png?v=1'

// A wooden crate spawns on exactly one region, uniformly at random, so the
// chance of finding it at a given step is that step's share of every region it
// could have spawned on -- the whole map. The "current" row covers the region
// you are standing on; with those and the steps below it the odds add up to
// 100%, give or take any region no land route reaches.
function formatChance(count: number, totalRegions: number) {
  return `${((count / totalRegions) * 100).toFixed(2)}%`
}

interface DistanceHistogramProps {
  regionName: string
  distances: globalThis.Map<string, number>
  totalRegions: number
}

// Table + bars rather than a plain chart: the counts stay readable as a column
// and double as the accessible view, since the panel itself is click-through.
function DistanceHistogram({ regionName, distances, totalRegions }: DistanceHistogramProps) {
  const counts = useMemo(() => {
    // One bucket per step, plus a final one collecting everything beyond.
    const buckets = new Array<number>(MAX_STEP + 1).fill(0)
    for (const distance of distances.values()) {
      if (distance < 1) continue
      buckets[Math.min(distance, MAX_STEP + 1) - 1] += 1
    }
    return buckets
  }, [distances])

  // Regions reachable within that many travels, i.e. counts summed up to here.
  // Starts at 1 for the region you are on, so the odds column can reach 100%.
  const cumulative = useMemo(() => {
    const totals: number[] = []
    let running = 1
    for (const count of counts) {
      running += count
      totals.push(running)
    }
    return totals
  }, [counts])

  const maxCount = Math.max(1, ...counts)

  return (
    <figure className="distance-histogram">
      <figcaption className="distance-histogram__caption">Regions around {regionName}</figcaption>
      <table className="distance-histogram__table">
        <thead>
          <tr>
            <th scope="col" className="distance-histogram__head">
              Stamina needed
            </th>
            <td />
            <th scope="col" colSpan={2} className="distance-histogram__head">
              Regions
            </th>
            <th scope="col" colSpan={2} className="distance-histogram__head">
              <span className="distance-histogram__head-label">
                <img className="distance-histogram__crate-icon" src={CRATE_ICON_URL} alt="" />
                Wooden crate odds
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {/* where you already stand: no distance, no bar, just its share of the odds */}
          <tr>
            <th scope="row" className="distance-histogram__step">
              Current (0)
            </th>
            <td className="distance-histogram__track" />
            <td className="distance-histogram__count" />
            <td className="distance-histogram__cumulative" />
            <td className="distance-histogram__count">{formatChance(1, totalRegions)}</td>
            <td className="distance-histogram__cumulative">
              ({formatChance(1, totalRegions)})
            </td>
          </tr>
          {counts.map((count, index) => (
            <tr key={index}>
              <th scope="row" className="distance-histogram__step">
                {(index === MAX_STEP ? `${(MAX_STEP + 1)*10}+` : (index + 1)*10)}
              </th>
              <td className="distance-histogram__track">
                <div
                  className={
                    index === MAX_STEP
                      ? 'distance-histogram__bar distance-histogram__bar--overflow'
                      : 'distance-histogram__bar'
                  }
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </td>
              <td className="distance-histogram__count">{count}</td>
              <td className="distance-histogram__cumulative">({cumulative[index]})</td>
              <td className="distance-histogram__count">{formatChance(count, totalRegions)}</td>
              <td className="distance-histogram__cumulative">
                ({formatChance(cumulative[index], totalRegions)})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="distance-histogram__warning">
        ℹ️ A wooden crate has a 25% chance of spawning each hour, plus your luck. The odds above assume
        one did spawn: they give how likely it is to be within reach at each distance.
      </p>
    </figure>
  )
}

export default DistanceHistogram
