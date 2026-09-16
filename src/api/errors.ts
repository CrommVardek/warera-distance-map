// A failed call, whether the transport broke or the API answered with a tRPC
// error envelope: { error: { message, code, data: { code, httpStatus, path } } }
export class ApiError extends Error {
  readonly httpStatus: number | undefined
  readonly code: string | undefined
  readonly path: string | undefined

  constructor(
    message: string,
    details: { httpStatus?: number; code?: string; path?: string } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.httpStatus = details.httpStatus
    this.code = details.code
    this.path = details.path
  }
}

// A bad or expired token, as opposed to a request that might succeed if retried.
// Centralised so the retry policy and any future "your key is invalid" UI can
// never disagree about what a rejected token looks like.
export function isUnauthorizedError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return (
    error.httpStatus === 401 ||
    error.httpStatus === 403 ||
    error.code === 'UNAUTHORIZED' ||
    error.code === 'FORBIDDEN'
  )
}
