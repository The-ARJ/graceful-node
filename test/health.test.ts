import { createServer } from 'node:http'
import { describe, it, expect } from 'vitest'
import { createHealth } from '../src/health.js'

function mockRes() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string | number>,
    body: '',
    writeHead(code: number, headers?: Record<string, string | number>) {
      res.statusCode = code
      Object.assign(res.headers, headers)
    },
    end(body: string) {
      res.body = body
    },
  }
  return res as unknown as import('node:http').ServerResponse & typeof res
}

function mockReq(url: string) {
  return { url } as import('node:http').IncomingMessage
}

describe('createHealth', () => {
  it('returns 200 on /health/live by default', () => {
    const health = createHealth()
    const res = mockRes()
    health.middleware(mockReq('/health/live'), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' })
  })

  it('returns 200 on /health/ready by default', () => {
    const health = createHealth()
    const res = mockRes()
    health.middleware(mockReq('/health/ready'), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ status: 'ok' })
  })

  it('returns 503 on /health/ready after setReady(false)', () => {
    const health = createHealth()
    health.setReady(false)
    const res = mockRes()
    health.middleware(mockReq('/health/ready'), res)
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body)).toEqual({ status: 'not ready' })
  })

  it('returns true (handled) for health paths', () => {
    const health = createHealth()
    expect(health.middleware(mockReq('/health/live'), mockRes())).toBe(true)
    expect(health.middleware(mockReq('/health/ready'), mockRes())).toBe(true)
  })

  it('returns false (not handled) for other paths and calls next()', () => {
    const health = createHealth()
    let nextCalled = false
    const handled = health.middleware(mockReq('/api/users'), mockRes(), () => {
      nextCalled = true
    })
    expect(handled).toBe(false)
    expect(nextCalled).toBe(true)
  })

  it('respects custom live and ready paths', () => {
    const health = createHealth({ livePath: '/live', readyPath: '/ready' })
    const liveRes = mockRes()
    const readyRes = mockRes()
    health.middleware(mockReq('/live'), liveRes)
    health.middleware(mockReq('/ready'), readyRes)
    expect(liveRes.statusCode).toBe(200)
    expect(readyRes.statusCode).toBe(200)
  })

  it('strips query strings from the path', () => {
    const health = createHealth()
    const res = mockRes()
    health.middleware(mockReq('/health/live?foo=bar'), res)
    expect(res.statusCode).toBe(200)
  })

  it('isReady() reflects setReady()', () => {
    const health = createHealth()
    expect(health.isReady()).toBe(true)
    health.setReady(false)
    expect(health.isReady()).toBe(false)
    health.setReady(true)
    expect(health.isReady()).toBe(true)
  })

  it('isLive() returns true by default', () => {
    const health = createHealth()
    expect(health.isLive()).toBe(true)
  })

  it('sets no-store cache-control header', () => {
    const health = createHealth()
    const res = mockRes()
    health.middleware(mockReq('/health/live'), res)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})
