# graceful-node

> Production-grade graceful shutdown and Kubernetes health checks for Node.js.  


```ts
import http from 'node:http'
import { graceful } from '@the-arj/graceful-node'

const server = http.createServer(app)
server.listen(3000)

graceful({
  servers: server,
  onShutdown: [() => db.close(), () => redis.quit()],
  timeout: 15_000,
  health: {},   // adds /health/live + /health/ready
})
```

On `SIGTERM` (e.g. `kubectl rollout restart`):
1. Readiness probe flips to `503` — Kubernetes stops routing traffic
2. In-flight requests are allowed to finish
3. Keep-alive idle connections are destroyed immediately
4. `onShutdown` callbacks run (`db.close()`, etc.)
5. `process.exit(0)`

---

## Why graceful-node?

| | `@godaddy/terminus` | `stoppable` | **graceful-node** |
|---|:---:|:---:|:---:|
| Maintained | ✗ (inactive 2023) | ✗ (abandoned 2018) | ✅ |
| ESM support | ✗ | ✗ | ✅ |
| Built-in TypeScript | ✗ | ✗ | ✅ |
| HTTP drain | ✅ | ✅ | ✅ |
| Health checks | ✅ | ✗ | ✅ |
| Idempotent shutdown | ✗ | ✗ | ✅ |
| Standalone health util | ✗ | ✗ | ✅ |

---

## Install

```sh
npm install @the-arj/graceful-node
```

Requires **Node.js ≥ 16**.

---

## API

### `graceful(options)`

Registers signal handlers and returns a `GracefulHandle`.

```ts
import { graceful } from '@the-arj/graceful-node'

const { shutdown, health } = graceful({
  servers:          server,           // or [server1, server2]
  onShutdown:       [() => db.end()], // run after servers drain
  timeout:          10_000,           // ms before force exit (default)
  signals:          ['SIGTERM', 'SIGINT'],
  onShutdownStart:  () => logger.info('shutting down'),
  onShutdownComplete: () => logger.info('bye'),
  health:           {},               // enable /health/live + /health/ready
  log:              msg => logger.warn(msg),
})
```

#### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `servers` | `Server \| Server[]` | — | HTTP/HTTPS servers to drain |
| `onShutdown` | `Array<() => void \| Promise<void>>` | `[]` | Cleanup callbacks (run in parallel after drain) |
| `timeout` | `number` | `10_000` | Total ms before `process.exit(1)` |
| `signals` | `NodeJS.Signals[]` | `['SIGTERM','SIGINT']` | Signals to intercept |
| `onShutdownStart` | `() => void` | — | Called synchronously on first signal |
| `onShutdownComplete` | `() => void` | — | Called just before `process.exit(0)` |
| `health` | `HealthOptions` | — | Enable health check middleware |
| `log` | `(msg: string) => void` | `console.error` | Log function — pass `() => {}` to silence |

#### Return value

```ts
interface GracefulHandle {
  shutdown(): Promise<void>  // programmatic shutdown (idempotent)
  health?: HealthHandle      // present when health option is provided
}
```

---

### Health checks

When you pass `health: {}`, `graceful()` automatically:
- Adds `/health/live` and `/health/ready` endpoints
- Flips `/health/ready` to `503` when shutdown begins, giving your load balancer time to drain before connections close

**With Express:**
```ts
const { health } = graceful({ servers: server, health: {} })
app.use((req, res, next) => health!.middleware(req, res, next))
```

**With plain `http`:**
```ts
const { health } = graceful({ health: {} })
http.createServer((req, res) => {
  if (!health!.middleware(req, res)) myApp(req, res)
})
```

**Standalone** (without `graceful()`):
```ts
import { createHealth } from '@the-arj/graceful-node'

const health = createHealth({ livePath: '/ping', readyPath: '/ready' })
app.use(health.middleware.bind(health))

// On startup completion:
health.setReady(true)
```

#### Health response format

```
GET /health/live   → 200  { "status": "ok" }
GET /health/ready  → 200  { "status": "ok" }
                   → 503  { "status": "not ready" }   (during shutdown)
```

---

### `makeDrainable(server)` — low-level drain

If you only need the HTTP drain primitive without signal handling:

```ts
import { makeDrainable } from '@the-arj/graceful-node'

const { drain } = makeDrainable(server)
await drain(5000)  // drain with 5s hard timeout
```

---

## Shutdown sequence

```
Signal received (SIGTERM)
  │
  ├─ onShutdownStart()
  ├─ health.setReady(false)        → load balancer stops routing
  ├─ [200ms pause]                 → gives LB time to notice probe
  ├─ server.close()                → no new connections accepted
  ├─ idle keep-alive sockets destroyed immediately
  ├─ in-flight requests finish naturally
  ├─ onShutdown callbacks run in parallel
  ├─ onShutdownComplete()
  └─ process.exit(0)

If timeout exceeded at any point → process.exit(1)
```

---

## Examples

### Express + Prisma + Redis

```ts
import http from 'node:http'
import express from 'express'
import { graceful } from '@the-arj/graceful-node'
import { PrismaClient } from '@prisma/client'
import { createClient } from 'redis'

const app = express()
const db = new PrismaClient()
const redis = createClient()
const server = http.createServer(app)

const { health } = graceful({
  servers: server,
  onShutdown: [
    () => db.$disconnect(),
    () => redis.quit(),
  ],
  health: {},
  timeout: 15_000,
})

app.use((req, res, next) => health!.middleware(req, res, next))
server.listen(3000)
```

### Multiple servers (HTTP + HTTPS)

```ts
graceful({
  servers: [httpServer, httpsServer],
  onShutdown: [() => db.end()],
})
```

### Programmatic shutdown (e.g. in tests)

```ts
const { shutdown } = graceful({ signals: [], servers: server })
await shutdown()  // idempotent — safe to call multiple times
```

---

## License

MIT © [The-ARJ](https://github.com/The-ARJ)
