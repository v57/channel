import { errorResponse, type Middleware, type MiddlewareContext } from './channel'
export type { Middleware, MiddlewareContext } from './channel'

export interface RateLimitOptions<State = any> {
  /** Who the limit applies to, for example a user or connection id. `undefined` isn't limited. */
  key: (ctx: MiddlewareContext<State>) => string | undefined
  /** Calls allowed per window */
  limit: number
  /** Window in seconds */
  window: number
  /** Paths that count, every path by default */
  paths?: (path: string) => boolean
}

/**
 * Allows `limit` calls per `window` seconds for each key, in memory, per process. Refused calls fail with
 * `{ message: 'rate limited', code: 'rate_limited', info: { retryAfter } }`, `retryAfter` in whole seconds.
 */
export function rateLimit<State = any>(options: RateLimitOptions<State>): Middleware<State> {
  const { key, limit, paths } = options
  const window = options.window * 1000
  // Start times of the calls in the current window, oldest first
  const calls = new Map<string, number[]>()
  let swept = Date.now()
  return (ctx, next) => {
    if (paths && !paths(ctx.path)) return next()
    const id = key(ctx)
    if (id === undefined) return next()
    const now = Date.now()
    if (now - swept > window) {
      swept = now
      calls.forEach((times, id) => {
        if (times[times.length - 1] <= now - window) calls.delete(id)
      })
    }
    let times = calls.get(id)
    if (times) {
      while (times.length && times[0] <= now - window) times.shift()
    } else {
      times = []
      calls.set(id, times)
    }
    if (times.length >= limit) {
      const retryAfter = Math.max(1, Math.ceil((times[0] + window - now) / 1000))
      throw { message: 'rate limited', code: 'rate_limited', info: { retryAfter } }
    }
    times.push(now)
    return next()
  }
}

export interface LoggerOptions {
  /** Defaults to `console.log` */
  log?: (line: string) => void
  /** Only logs calls slower than this, in milliseconds */
  slow?: number
}

/** Logs one line per call: kind, path, milliseconds, and `ok` or the error code and message. Streams log their start. */
export function logger<State = any>(options: LoggerOptions = {}): Middleware<State> {
  const log = options.log ?? console.log
  const slow = options.slow
  return async (ctx, next) => {
    const started = performance.now()
    try {
      const result = await next()
      const ms = performance.now() - started
      if (slow === undefined || ms > slow) log(`${ctx.kind} ${ctx.path} ${ms.toFixed(1)}ms ok`)
      return result
    } catch (e) {
      const ms = performance.now() - started
      if (slow === undefined || ms > slow) {
        const { error, code } = errorResponse(0, e)
        log(`${ctx.kind} ${ctx.path} ${ms.toFixed(1)}ms ${code === undefined ? '' : code + ' '}${error}`)
      }
      throw e
    }
  }
}
