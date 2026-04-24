import { createServer } from 'node:http'
import { describe, it, expect, afterEach } from 'vitest'
import { makeDrainable } from '../src/drain.js'

function makeServer() {
  const server = createServer((_req, res) => {
    res.writeHead(200)
    res.end('ok')
  })
  return server
}

function listenAsync(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as { port: number }).port)
    })
  })
}

describe('makeDrainable', () => {
  afterEach(() => {
    // Tests clean up their own servers
  })

  it('drains an idle server immediately', async () => {
    const server = makeServer()
    const { drain } = makeDrainable(server)
    await listenAsync(server)

    await expect(drain(500)).resolves.toBeUndefined()
  })

  it('resolves after a single request completes', async () => {
    // Server signals when it has received the request so we can start draining
    let signalReceived!: () => void
    const inFlight = new Promise<void>(r => { signalReceived = r })

    const server = createServer((_req, res) => {
      signalReceived()
      setTimeout(() => { res.writeHead(200); res.end('ok') }, 50)
    })
    const { drain } = makeDrainable(server)
    const port = await listenAsync(server)

    const reqPromise = fetch(`http://127.0.0.1:${port}/`)
    // Wait until the server has the request before closing
    await inFlight
    const drainPromise = drain(1000)

    await reqPromise
    await expect(drainPromise).resolves.toBeUndefined()
  })

  it('resolves within timeout even if connections are stuck', async () => {
    const server = createServer((_req, _res) => {
      // Never responds — simulates a hung request
    })
    const { drain } = makeDrainable(server)
    const port = await listenAsync(server)

    // Connect a request that will never finish so drain must use the timeout
    const controller = new AbortController()
    fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal }).catch(() => {})
    // Give the fetch time to establish the TCP connection
    await new Promise(r => setTimeout(r, 50))

    const start = Date.now()
    await drain(200)
    expect(Date.now() - start).toBeGreaterThanOrEqual(150)
    expect(Date.now() - start).toBeLessThan(800)
    controller.abort()
  })

  it('stops accepting new connections after drain starts', async () => {
    const server = makeServer()
    const { drain } = makeDrainable(server)
    const port = await listenAsync(server)

    await drain(500)

    // After draining, the server should be closed
    expect(server.listening).toBe(false)
  })
})
