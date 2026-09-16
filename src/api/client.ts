import { API_BASE_URL, API_KEY_HEADER } from './config'
import { ApiError } from './errors'

// What a tRPC HTTP response looks like either way round.
interface TrpcEnvelope<T> {
  result?: { data: T }
  error?: {
    message?: string
    data?: { code?: string; httpStatus?: number; path?: string }
  }
}

// tRPC reads a query's input from the `input` search param as JSON. If the
// server turns out to run a transformer (superjson wraps everything as
// `{ json: ... }`), this is the single place that has to change.
function serializeInput(input: unknown): string {
  return JSON.stringify(input)
}

interface TrpcQueryOptions {
  token?: string | null
  signal?: AbortSignal
}

/**
 * Calls one tRPC query procedure and hands back its unwrapped payload.
 *
 * Note there is no `credentials` option: the API answers with
 * `Access-Control-Allow-Origin: *`, which the browser refuses to combine with
 * credentialed requests. The token rides in a header instead of a cookie, so
 * the default `credentials: 'omit'` is exactly right.
 */
export async function trpcQuery<T>(
  procedure: string,
  input?: unknown,
  { token, signal }: TrpcQueryOptions = {},
): Promise<T> {
  const url = new URL(`${API_BASE_URL}/${procedure}`)
  if (input !== undefined) url.searchParams.set('input', serializeInput(input))

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) headers[API_KEY_HEADER] = token

  let response: Response
  try {
    response = await fetch(url, { headers, signal })
  } catch (cause) {
    // Network failure, DNS, or a CORS rejection -- fetch gives no detail on the
    // last one by design, so say what is knowable rather than guessing.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(`Could not reach the WarEra API (${procedure})`, { path: procedure })
  }

  // A tRPC error arrives as a JSON body with a non-2xx status, so parse first
  // and let the envelope describe the failure; fall back to the status line
  // when the body is not JSON at all (a gateway error page, say).
  let body: TrpcEnvelope<T> | undefined
  try {
    body = (await response.json()) as TrpcEnvelope<T>
  } catch {
    body = undefined
  }

  if (body?.error) {
    throw new ApiError(body.error.message ?? `${procedure} failed`, {
      httpStatus: body.error.data?.httpStatus ?? response.status,
      code: body.error.data?.code,
      path: body.error.data?.path ?? procedure,
    })
  }

  if (!response.ok) {
    throw new ApiError(`${procedure} failed: ${response.status} ${response.statusText}`, {
      httpStatus: response.status,
      path: procedure,
    })
  }

  if (!body?.result) {
    throw new ApiError(`${procedure} returned no data`, {
      httpStatus: response.status,
      path: procedure,
    })
  }

  return body.result.data
}
