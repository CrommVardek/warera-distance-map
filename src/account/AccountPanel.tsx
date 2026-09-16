import { useEffect, useState } from 'react'
import { isUnauthorizedError } from '../api/errors'
import { selectNickname, usePlayerLoot, usePlayerState } from '../api/queries'
import { setCredentials, useCredentials } from '../auth/credentials'
import ConnectDialog from './ConnectDialog'

function AccountPanel() {
  const credentials = useCredentials()
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: player, error } = usePlayerState()
  // Fired alongside the player state, but deliberately not folded into the
  // panel's connected/error logic: a loot failure should not log anyone out.
  usePlayerLoot()

  // Credentials that worked yesterday can be revoked. Treat a rejection as
  // logged out and drop them, rather than leaving the panel stuck showing a
  // player it can never load. This writes to the credentials store -- an
  // external store -- not to React state, so it is synchronisation rather than
  // the cascading-render pattern the lint rules (rightly) reject.
  const rejected = isUnauthorizedError(error)
  useEffect(() => {
    if (rejected) setCredentials(null)
  }, [rejected])

  // A network blip is not a bad credential, so they are kept; the panel just
  // falls back to offering a reconnect.
  const connected = Boolean(credentials) && !error

  return (
    <div className="account-panel">
      {connected ? (
        <div className="account-panel__player">
          <span className="account-panel__nickname">
            {player ? selectNickname(player) : '…'}
          </span>
          <button
            type="button"
            className="account-panel__disconnect"
            onClick={() => setCredentials(null)}
            aria-label="Disconnect"
            title="Disconnect"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="account-panel__connect"
          onClick={() => setDialogOpen(true)}
        >
          Connect
        </button>
      )}

      {dialogOpen && <ConnectDialog onClose={() => setDialogOpen(false)} />}
    </div>
  )
}

export default AccountPanel
