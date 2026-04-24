import type { IncomingMessage, ServerResponse } from 'node:http'

export interface HealthOptions {
  /** Path for liveness probe. Default: `'/health/live'` */
  livePath?: string
  /** Path for readiness probe. Default: `'/health/ready'` */
  readyPath?: string
}

export interface HealthHandle {
  /** Returns true while the process is alive and not shutting down. */
  isLive(): boolean
  /** Returns true when the app is ready to serve traffic. */
  isReady(): boolean
  /**
   * Mark the app as not ready (e.g. when shutdown starts).
   * Kubernetes will stop routing traffic once the readiness probe returns 503.
   */
  setReady(ready: boolean): void
  /**
   * Framework-agnostic middleware. Works with plain Node.js http, Express,
   * Fastify (as a preHandler), Koa (as middleware), etc.
   *
   * Returns `true` if the request was handled (caller should not call next).
   */
  middleware(
    req: IncomingMessage,
    res: ServerResponse,
    next?: () => void,
  ): boolean
}

/**
 * Create a health check handler for liveness and readiness probes.
 *
 * @example
 * const health = createHealth()
 * // Express
 * app.use(health.middleware.bind(health))
 * // Plain http
 * http.createServer((req, res) => {
 *   if (!health.middleware(req, res)) yourHandler(req, res)
 * })
 */
export function createHealth(options: HealthOptions = {}): HealthHandle {
  const livePath = options.livePath ?? '/health/live'
  const readyPath = options.readyPath ?? '/health/ready'

  let ready = true
  let live = true

  function respond(res: ServerResponse, ok: boolean, body: object): void {
    const payload = JSON.stringify(body)
    res.writeHead(ok ? 200 : 503, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      'cache-control': 'no-store',
    })
    res.end(payload)
  }

  return {
    isLive: () => live,
    isReady: () => ready,
    setReady(r) {
      ready = r
    },

    middleware(req, res, next) {
      const url = req.url?.split('?')[0] ?? ''

      if (url === livePath) {
        respond(res, live, { status: live ? 'ok' : 'error' })
        return true
      }
      if (url === readyPath) {
        respond(res, ready, { status: ready ? 'ok' : 'not ready' })
        return true
      }

      next?.()
      return false
    },
  }
}
