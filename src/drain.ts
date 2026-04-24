import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http'
import type { Server as HttpsServer } from 'node:https'
import type { Socket } from 'node:net'

export type DrainableServer = HttpServer | HttpsServer

/**
 * Wraps an HTTP(S) server so it can be stopped gracefully.
 *
 * How it works:
 * - Tracks every socket that connects.
 * - Tracks how many active requests are running on each socket.
 * - On `drain()`: calls server.close() (no new connections) and immediately
 *   destroys idle sockets (keep-alive connections with 0 active requests).
 * - As in-flight requests finish their response, the socket is destroyed.
 * - A hard timeout destroys any remaining sockets that never finished.
 */
export function makeDrainable(server: DrainableServer): {
  drain(timeoutMs: number): Promise<void>
} {
  const sockets = new Set<Socket>()
  const activeRequests = new Map<Socket, number>()
  let draining = false

  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    activeRequests.set(socket, 0)
    socket.once('close', () => {
      sockets.delete(socket)
      activeRequests.delete(socket)
    })
  })

  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const socket = req.socket as Socket
    activeRequests.set(socket, (activeRequests.get(socket) ?? 0) + 1)

    res.once('finish', () => {
      const remaining = (activeRequests.get(socket) ?? 1) - 1
      activeRequests.set(socket, remaining)
      // Destroy idle keep-alive sockets once we're draining
      if (draining && remaining === 0) {
        socket.destroy()
      }
    })
  })

  return {
    drain(timeoutMs: number): Promise<void> {
      return new Promise<void>(resolve => {
        draining = true

        // Stop accepting new connections
        server.close(() => resolve())

        // Immediately destroy sockets with no active requests (keep-alive idle)
        for (const [socket, count] of activeRequests) {
          if (count === 0) socket.destroy()
        }

        // Hard timeout — destroy everything still open
        const timer = setTimeout(() => {
          for (const socket of sockets) socket.destroy()
          resolve()
        }, timeoutMs)

        // Don't block process exit if everything closed cleanly before timeout
        if (timer.unref) timer.unref()
      })
    },
  }
}
