import { createServer } from 'node:http'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { graceful, createHealth } from '../src/index.js'

describe('graceful', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a shutdown function', () => {
    const handle = graceful({ signals: [] })
    expect(typeof handle.shutdown).toBe('function')
  })

  it('returns health handle when health option is provided', () => {
    const handle = graceful({ signals: [], health: {} })
    expect(handle.health).toBeDefined()
    expect(typeof handle.health!.isReady).toBe('function')
  })

  it('does not return health when option is omitted', () => {
    const handle = graceful({ signals: [] })
    expect(handle.health).toBeUndefined()
  })

  it('calls onShutdownStart when shutdown begins', async () => {
    const onShutdownStart = vi.fn()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    const handle = graceful({ signals: [], onShutdownStart, log: () => {} })

    await handle.shutdown().catch(() => {})
    expect(onShutdownStart).toHaveBeenCalledOnce()
    exitSpy.mockRestore()
  })

  it('runs onShutdown callbacks', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    const handle = graceful({
      signals: [],
      onShutdown: [cleanup],
      log: () => {},
    })

    await handle.shutdown().catch(() => {})
    expect(cleanup).toHaveBeenCalledOnce()
    exitSpy.mockRestore()
  })

  it('is idempotent — multiple shutdown() calls resolve the same promise', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    const handle = graceful({
      signals: [],
      onShutdown: [cleanup],
      log: () => {},
    })

    await Promise.all([
      handle.shutdown().catch(() => {}),
      handle.shutdown().catch(() => {}),
      handle.shutdown().catch(() => {}),
    ])

    expect(cleanup).toHaveBeenCalledOnce()
    exitSpy.mockRestore()
  })

  it('drains provided HTTP server on shutdown', async () => {
    const server = createServer((_req, res) => res.end('ok'))
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    const handle = graceful({ signals: [], servers: server, log: () => {} })
    await handle.shutdown().catch(() => {})

    expect(server.listening).toBe(false)
    exitSpy.mockRestore()
  })

  it('marks health as not-ready when shutdown starts', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    const handle = graceful({ signals: [], health: {}, log: () => {} })
    expect(handle.health!.isReady()).toBe(true)

    await handle.shutdown().catch(() => {})
    expect(handle.health!.isReady()).toBe(false)
    exitSpy.mockRestore()
  })

  it('logs shutdown callback errors but still exits', async () => {
    const logs: string[] = []
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })

    const handle = graceful({
      signals: [],
      onShutdown: [() => Promise.reject(new Error('cleanup failed'))],
      log: msg => logs.push(msg),
    })

    await handle.shutdown().catch(() => {})
    expect(logs.some(l => l.includes('cleanup failed'))).toBe(true)
    exitSpy.mockRestore()
  })
})

describe('createHealth (standalone)', () => {
  it('can be used without graceful()', () => {
    const health = createHealth({ livePath: '/ping' })
    expect(health.isLive()).toBe(true)
  })
})
