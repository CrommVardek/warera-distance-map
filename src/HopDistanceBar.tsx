// Travel cost as the game shows it. A trip within stamina range burns 10
// stamina per travel and no barils; one beyond it flips over entirely -- the
// whole journey is re-priced at 2 barils per travel and costs no stamina.
const STAMINA_PER_TRAVEL = 10
const MAX_STAMINA = 100
const MAX_STAMINA_TRAVELS = MAX_STAMINA / STAMINA_PER_TRAVEL
const BARILS_PER_TRAVEL = 2
const BARIL_ICON_URL = 'https://media.warera.io/images/itemsv2/oil.png?v=1'

function travelCost(travels: number) {
  if (travels > MAX_STAMINA_TRAVELS) {
    return { stamina: 0, barils: travels * BARILS_PER_TRAVEL }
  }
  return { stamina: travels * STAMINA_PER_TRAVEL, barils: 0 }
}

function StaminaIcon() {
  return (
    <svg className="stamina-bar__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.5,5.5A2,2 0 0,0 18.5,3.5A2,2 0 0,0 16.5,1.5A2,2 0 0,0 14.5,3.5A2,2 0 0,0 16.5,5.5M12.9,19.4L13.9,15L16,17V23H18V15.5L15.9,13.5L16.5,10.5C17.89,12.09 19.89,13 22,13V11C20.24,11.03 18.6,10.11 17.7,8.6L16.7,7C16.34,6.4 15.7,6 15,6C14.7,6 14.5,6.1 14.2,6.1L9,8.3V13H11V9.6L12.8,8.9L11.2,17L6.3,16L5.9,18L12.9,19.4M4,9A1,1 0 0,1 3,8A1,1 0 0,1 4,7H7V9H4M5,5A1,1 0 0,1 4,4A1,1 0 0,1 5,3H10V5H5M3,13A1,1 0 0,1 2,12A1,1 0 0,1 3,11H7V13H3Z"
      />
    </svg>
  )
}

interface HopDistanceBarProps {
  fromName: string
  toName: string
  travels: number | undefined // undefined when the target is unreachable
}

function HopDistanceBar({ fromName, toName, travels }: HopDistanceBarProps) {
  if (travels === undefined) {
    return (
      <div className="hop-distance-bar">
        <div className="hop-distance-bar__label">
          {fromName} → {toName}
        </div>
        unreachable
      </div>
    )
  }

  const { stamina, barils } = travelCost(travels)

  return (
    <div className="hop-distance-bar">
      <div className="hop-distance-bar__label">
        {fromName} → {toName} · {travels} region{travels === 1 ? '' : 's'} away
      </div>
      <div className="hop-distance-bar__costs">
        <div className="stamina-bar" role="img" aria-label={`${stamina} of ${MAX_STAMINA} stamina`}>
          <div className="stamina-bar__fill" style={{ width: `${(stamina / MAX_STAMINA) * 100}%` }} />
          <div className="stamina-bar__content">
            <StaminaIcon />
            {stamina}/{MAX_STAMINA}
          </div>
        </div>
        {barils > 0 && (
          <span className="hop-distance-bar__barils">
            <img className="hop-distance-bar__baril-icon" src={BARIL_ICON_URL} alt="" />
            {barils} baril{barils === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </div>
  )
}

export default HopDistanceBar
