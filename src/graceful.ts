import type { DrainableServer } from './drain.js'
import { makeDrainable } from './drain.js'
import { createHealth, type HealthHandle, type HealthOptions } from './health.js'

export interface GracefulOptions {
  /** HTTP/HTTPS servers to drain before running cleanup. */
  servers?: DrainableServer | DrainableServer[]
  /**
   * Async cleanup callbacks — called after all servers have drained.
   * Run in parallel. Errors are logged but do not prevent exit.
   */
  onShutdown?: Array<() => Promise<void> | void>
  /**
   * Total ms to wait for servers + cleanup before force-exiting.
   * Default: `10_000`
   */
  timeout?: number
  /**
   * OS signals that trigger graceful shutdown.
   * Default: `['SIGTERM', 'SIGINT']`
   */
  signals?: NodeJS.Signals[]
  /** Called synchronously when the first shutdown signal is received. */
  onShutdownStart?: () => void
  /** Called just before `process.exit(0)`. */
  onShutdownComplete?: () => void
  /**
   * Health check options. When provided, `graceful()` returns a `health`
   * handle and automatically marks the app as not-ready when shutdown begins.
   */
  health?: HealthOptions
  /** Log function. Defaults to `console.error`. Pass `() => {}` to silence. */
  log?: (message: string) => void
}

export interface GracefulHandle {
  /**
   * Programmatically trigger the shutdown sequence — useful in tests or when
   * you handle signals yourself.
   */
  shutdown(): Promise<void>
  /**
   * Health check handle. Only present when `health` option was supplied.
   */
  health: HealthHandle | undefined
}

/**
 * Register graceful shutdown for one or more HTTP servers.
 *
 * @example
 * const server = http.createServer(app)
 * server.listen(3000)
 *
 * graceful({
 *   servers: server,
 *   onShutdown: [() => db.close()],
 *   timeout: 15_000,
 * })
 */
export function graceful(options: GracefulOptions = {}): GracefulHandle {
  const {
    timeout = 10_000,
    signals = ['SIGTERM', 'SIGINT'],
    onShutdown = [],
    onShutdownStart,
    onShutdownComplete,
    log = console.error.bind(console),
  } = options

  const rawServers = options.servers
    ? Array.isArray(options.servers)
      ? options.servers
      : [options.servers]
    : []

  const drainables = rawServers.map(s => ({ server: s, ...makeDrainable(s) }))

  const health = options.health ? createHealth(options.health) : undefined

  let shutdownPromise: Promise<void> | null = null

  async function shutdown(): Promise<void> {
    if (shutdownPromise) return shutdownPromise

    shutdownPromise = (async () => {
      onShutdownStart?.()
      log('[graceful-node] Shutdown signal received — draining…')

      // Stop readiness probe first so Kubernetes stops sending traffic
      health?.setReady(false)

      // Give the load balancer a moment to notice the probe flip before
      // we stop accepting connections. Only applies when health is in use.
      if (health && rawServers.length > 0) {
        await new Promise<void>(r => setTimeout(r, 200))
      }

      // Drain all HTTP servers concurrently
      const drainTimeout = Math.floor(timeout * 0.8)
      await Promise.allSettled(drainables.map(d => d.drain(drainTimeout)))

      // Run user cleanup callbacks concurrently
      const results = await Promise.allSettled(onShutdown.map(fn => fn()))
      for (const result of results) {
        if (result.status === 'rejected') {
          log(`[graceful-node] onShutdown callback error: ${result.reason}`)
        }
      }

      log('[graceful-node] Shutdown complete.')
      onShutdownComplete?.()
      process.exit(0)
    })()

    return shutdownPromise
  }

  // Hard timeout — if the graceful sequence takes too long, force exit
  let forceTimer: ReturnType<typeof setTimeout> | null = null

  function onSignal(signal: string): void {
    log(`[graceful-node] Received ${signal}`)

    if (!forceTimer) {
      forceTimer = setTimeout(() => {
        log('[graceful-node] Shutdown timed out — forcing exit.')
        process.exit(1)
      }, timeout)
      if (forceTimer.unref) forceTimer.unref()
    }

    void shutdown()
  }

  for (const signal of signals) {
    process.once(signal, () => onSignal(signal))
  }

  return { shutdown, health }
}
