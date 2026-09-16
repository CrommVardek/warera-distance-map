import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, isUnauthorizedError } from '../api/errors'
import { useConnect } from '../api/queries'

interface ConnectDialogProps {
  onClose: () => void
}

/**
 * Modal asking for the player's API key and user id.
 *
 * Mounted only while open, so the fields and the mutation state are fresh every
 * time -- no stale error left over from a previous attempt to clear by hand.
 */
function ConnectDialog({ onClose }: ConnectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [apiKey, setApiKey] = useState('')
  const [userId, setUserId] = useState('')
  const connect = useConnect()

  // showModal() is what puts the dialog in the browser's top layer and brings
  // focus trapping and Esc-to-close with it; rendering it with the `open`
  // attribute gives neither. The top layer also sits above the map and its
  // panels unconditionally, so none of their z-indexes matter here.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  const trimmedKey = apiKey.trim()
  const trimmedUserId = userId.trim()

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!trimmedKey || !trimmedUserId) return
    // On failure the dialog deliberately stays mounted: the fields keep their
    // values and Continue re-enables, so retrying is one click.
    connect.mutate({ apiKey: trimmedKey, userId: trimmedUserId }, { onSuccess: onClose })
  }

  return (
    // onCancel, not onClose: `cancel` fires only when the user dismisses with
    // Esc, whereas `close` fires on every close -- including the cleanup call
    // above. Wiring that to onClose fed StrictMode's extra mount/cleanup/mount
    // cycle straight back into the parent, unmounting the dialog before it was
    // ever painted.
    <dialog ref={dialogRef} className="connect-dialog" aria-labelledby="connect-dialog-title" onCancel={onClose}>
      <form className="connect-dialog__form" onSubmit={handleSubmit}>
        <h2 className="connect-dialog__title" id="connect-dialog-title">
          Connect to WarEra
        </h2>
        <p className="connect-dialog__hint">
          Both values are kept in this browser only, and sent to WarEra with each request.
        </p>

        <label className="connect-dialog__label" htmlFor="connect-dialog-key">
          API token
        </label>
        <input
          id="connect-dialog-key"
          className="connect-dialog__input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          disabled={connect.isPending}
        />

        <label className="connect-dialog__label" htmlFor="connect-dialog-user-id">
          User ID
        </label>
        <input
          id="connect-dialog-user-id"
          className="connect-dialog__input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="connect-dialog-user-id-hint"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          disabled={connect.isPending}
        />
        <p className="connect-dialog__field-hint" id="connect-dialog-user-id-hint">
          The id at the end of your WarEra profile URL.
        </p>

        {connect.isError && (
          <p className="connect-dialog__error" role="alert">
            {/* Each failure needs something different from the reader, so each
                gets its own words rather than one vague "something failed". */}
            {isUnauthorizedError(connect.error)
              ? 'That token was rejected. Check it and try again.'
              : connect.error instanceof ApiError && connect.error.code === 'NOT_FOUND'
                ? 'No player found for that user ID. Check it and try again.'
                : connect.error instanceof ApiError && connect.error.code === 'BAD_REQUEST'
                  ? "That user ID isn't in the expected format. Check it and try again."
                  : 'Could not reach WarEra. Check your connection and try again.'}
          </p>
        )}

        <div className="connect-dialog__actions">
          <button
            type="button"
            className="connect-dialog__button"
            onClick={onClose}
            disabled={connect.isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="connect-dialog__button connect-dialog__button--primary"
            disabled={connect.isPending || !trimmedKey || !trimmedUserId}
          >
            {connect.isPending ? 'Checking…' : 'Continue'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export default ConnectDialog
