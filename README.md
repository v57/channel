<h1>
  <img alt="Containerization logo" src="./icon.png" width="70" valign="middle">
  &nbsp;channel
</h1>

Powerful and lightweight communication built for modern language. Run websocket server, client and even use it inside your process to communicate with different parts of your apps. It supports async and AsyncIterator out of the box.

- **Zero dependencies.** The server runs on Bun, the client on Bun or in a browser.
- **Small.** About 1,500 lines: a ~900-line core (`channel.ts`), the WebSocket client (~350) and server (~170), and
  in-process messaging (~50). Optional: middleware (~60), `more.ts` (~210) and the experimental QUIC transport (~300).
- **Wire v2** ([docs/v2.md](docs/v2.md)): structured errors (`code`, `info`), subscriptions with dynamic topics and
  `publish`, middleware with rate limiting and logging, request timeouts and replay control, connection state.

# Installation
`bun add v57/channel`

# Libraries

One package, imported by entry point. Each one re-exports `Channel` and adds its transport or helpers to it.

| Library | Purpose | Platforms | Import |
| --- | --- | --- | --- |
| [`channel/server`](docs/server.md) | `listen()`: the WebSocket server, `publish()` to topics | Bun | `import { Channel } from 'channel/server'` |
| [`channel/client`](docs/client.md) | `connect()`: the WebSocket client with reconnect, timeouts and connection state | Bun, browsers | `import { Channel, ChannelError } from 'channel/client'` |
| [`channel/quic`](docs/quic.md) | `listenQuic()` and `quic://` addresses in `connect()` (experimental) | Bun (`node:quic`) | `import { Channel } from 'channel/quic'` |
| `channel/process` | `process()`: a `Sender` that calls the channel's own handlers in the same process | Bun, browsers | `import { Channel } from 'channel/process'` |
| [`channel/middleware`](docs/v2.md#3-middleware) | `logger()` and `rateLimit()` for `use()` | Bun, browsers | `import { logger, rateLimit } from 'channel/middleware'` |
| `channel/more` | `LazyState`, `LazyStates`: a value computed on demand for stream handlers; `setNeedsUpdate()` recomputes it for every reader of `makeIterator()`, at most every `delay()` seconds, optionally deduplicated | Bun | `import { LazyState, LazyStates } from 'channel/more'` |

`channel/channel` is the core the others build on (`Channel`, `Sender`, `ChannelError`, the handler and middleware
types); apps import it only for types. Implementations in other languages are listed in [docs/ports.md](docs/ports.md).

# Usage

``` ts
// Server
import { Channel } from 'channel/server'
new Channel().post('hello', () => 'world').listen(8080)
```

``` ts
// Client
import { Channel } from 'channel/client'
const client = new Channel().connect(8080)
const response = await client.send('hello')
console.log(response)
```

``` ts
// Subscriptions, middleware and structured errors
import { Channel } from 'channel/server'
import { logger } from 'channel/middleware'
const channel = new Channel<{ user?: string }>()
  .use(logger())
  .sub('room', ({ body, state }) => {
    if (!state.user) throw { message: 'unauthorized', code: 401 }
    return { topic: `room/${body.room}`, body: 'joined' } // topic to join, and the first event
  })
channel.listen(8080, { state: headers => ({ user: headers.user }) })
channel.publish('room/lobby', { text: 'hi' })
```

``` ts
// QUIC (experimental, see docs/quic.md)
import { Channel } from 'channel/quic'
await new Channel().post('hello', () => 'world').listenQuic(4433, { key, cert })
const client = new Channel().connect('quic://localhost:4433', { quic: { ca: cert } })
```

# Docs
- [Overview](docs/README.md): what Channel is, the wire format pages, every page
- [Client](docs/client.md): requests, streams, subscriptions, errors, timeouts, reconnect
- [Server](docs/server.md): handlers, subscriptions, publish, middleware, listen options
- [Wire v2](docs/v2.md): errors, dynamic topics, middleware, request options, connection, interop fixture
- [Message structure](docs/structure.md): message shapes, dispatch, and request ids (a response answers a request only on
  the connection the request went to)
- [Ports](docs/ports.md): the implementations in other languages, their packages and status
- [QUIC transport](docs/quic.md): also in Go, Swift, C#, Rust, Python, Elixir, Java, Kotlin, C and Zig; Dart, Ruby and PHP stay on WebSocket
- [Performance](docs/performance.md)
