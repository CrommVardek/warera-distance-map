import { useMemo, useState } from 'react'
import TravelCostReadout from './TravelCost'
import { BARILS_PER_EXTRA_TRAVEL, MAX_STAMINA_TRAVELS } from './travel'
import { MAX_CASES, type PickMode, type Route } from './route'

const CRATE_ICON_URL = 'https://media.warera.io/images/itemsv2/woodenCase.png?v=1'

function regionCount(travels: number) {
  return `${travels} region${travels === 1 ? '' : 's'}`
}

interface RoutePlannerProps {
  homeId: string | null
  caseIds: string[]
  regionName: (regionId: string) => string
  picking: PickMode
  onPick: (mode: PickMode) => void
  onClearHome: () => void
  onRemoveCase: (regionId: string) => void
  onClearCases: () => void
  onPlan: () => void
  route: Route | null
}

// Unlike the other panels this one is interactive, so it keeps its pointer
// events and arms the map instead of reading it: while `picking` is set the
// next click on a region lands here rather than moving the heatmap's origin.
function RoutePlanner({
  homeId,
  caseIds,
  regionName,
  picking,
  onPick,
  onClearHome,
  onRemoveCase,
  onClearCases,
  onPlan,
  route,
}: RoutePlannerProps) {
  const [open, setOpen] = useState(false)

  // Once a route exists each crate carries the position it is collected at.
  const orderByCase = useMemo(() => {
    const order = new Map<string, number>()
    route?.steps.forEach((step, index) => order.set(step.caseId, index + 1))
    return order
  }, [route])

  const canPlan = homeId !== null && caseIds.length > 0
  const extraTravels = route ? Math.max(0, route.travels - MAX_STAMINA_TRAVELS) : 0

  return (
    <>
      {/* Same collapse pattern as the histogram: the button and the collapsed
          state only exist under the phone breakpoint, CSS decides which. */}
      <button
        type="button"
        className="route-planner-toggle"
        aria-expanded={open}
        aria-controls="route-planner"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {open ? 'Hide crates' : 'Crates'}
      </button>

      <section id="route-planner" className="route-planner" data-open={open}>
        <h2 className="route-planner__title">
          <img className="route-planner__crate-icon" src={CRATE_ICON_URL} alt="" />
          Wooden case route
        </h2>

        <div className="route-planner__field">
          <span className="route-planner__field-label">Home</span>
          <span className="route-planner__field-value">
            {homeId ? regionName(homeId) : <em className="route-planner__empty">not set</em>}
          </span>
          <button
            type="button"
            className="route-planner__button"
            aria-pressed={picking === 'home'}
            onClick={() => onPick(picking === 'home' ? null : 'home')}
          >
            {picking === 'home' ? 'Picking…' : homeId ? 'Change' : 'Set'}
          </button>
          <button
            type="button"
            className="route-planner__button"
            disabled={!homeId}
            onClick={onClearHome}
            title="Clear home region"
          >
            Reset
          </button>
        </div>

        <div className="route-planner__field">
          <span className="route-planner__field-label">
            Cases {caseIds.length}/{MAX_CASES}
          </span>
          <span className="route-planner__field-value" />
          <button
            type="button"
            className="route-planner__button"
            aria-pressed={picking === 'case'}
            disabled={caseIds.length >= MAX_CASES && picking !== 'case'}
            onClick={() => onPick(picking === 'case' ? null : 'case')}
          >
            {picking === 'case' ? 'Picking…' : 'Add'}
          </button>
          <button
            type="button"
            className="route-planner__button"
            disabled={caseIds.length === 0}
            onClick={onClearCases}
            title="Clear every case region"
          >
            Reset
          </button>
        </div>

        {caseIds.length > 0 && (
          <ul className="route-planner__cases">
            {caseIds.map((caseId) => (
              <li key={caseId} className="route-planner__case">
                <span className="route-planner__case-order">{orderByCase.get(caseId) ?? '·'}</span>
                <span className="route-planner__case-name">{regionName(caseId)}</span>
                <button
                  type="button"
                  className="route-planner__remove"
                  onClick={() => onRemoveCase(caseId)}
                  aria-label={`Remove ${regionName(caseId)}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {picking && (
          <p className="route-planner__hint">
            Click {picking === 'home' ? 'your home region' : 'a region holding a case'} on the map
            {picking === 'case' && ' — click a picked one again to drop it'}. Esc cancels.
          </p>
        )}

        <button type="button" className="route-planner__plan" disabled={!canPlan} onClick={onPlan}>
          Best route
        </button>
        {!canPlan && (
          <p className="route-planner__hint">Set a home region and at least one case first.</p>
        )}

        {route && (
          <div className="route-planner__result">
            <ol className="route-planner__legs">
              <li className="route-planner__leg route-planner__leg--start">
                <span className="route-planner__leg-order">⌂</span>
                <span className="route-planner__leg-name">{regionName(homeId!)}</span>
                <span className="route-planner__leg-cost">start</span>
              </li>
              {route.steps.map((step, index) => (
                <li key={step.caseId} className="route-planner__leg">
                  {step.viaHome && (
                    <span className="route-planner__leg-home">↩ back home · free</span>
                  )}
                  <span className="route-planner__leg-order">{index + 1}</span>
                  <span className="route-planner__leg-name">{regionName(step.caseId)}</span>
                  <span className="route-planner__leg-cost">{regionCount(step.travels)}</span>
                </li>
              ))}
            </ol>

            <div className="route-planner__total">Total {regionCount(route.travels)} travelled</div>
            <TravelCostReadout travels={route.travels} />

            {extraTravels > 0 && (
              <p className="route-planner__warning">
                ⚠️ This route outruns a full stamina bar by {regionCount(extraTravels)}, billed at{' '}
                {BARILS_PER_EXTRA_TRAVEL} barils each.
              </p>
            )}
            {route.unreachable.length > 0 && (
              <p className="route-planner__warning">
                ⚠️ No land route from home reaches{' '}
                {route.unreachable.map(regionName).join(', ')} — left out of the trip.
              </p>
            )}
            <p className="route-planner__note">
              Travelling home is free, so the route hops home whenever setting out again from
              there is shorter than walking on.
            </p>
          </div>
        )}
      </section>
    </>
  )
}

export default RoutePlanner
