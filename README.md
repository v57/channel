<h1>
  <img alt="Containerization logo" src="./icon.png" width="70" valign="middle">
  &nbsp;channel
</h1>

Powerful and lightweight communication built for modern language. Run websocket server, client and even use it inside your process to communicate with different parts of your apps. It supports async and AsyncIterator out of the box.

- **Zero dependencies.** The server runs on Bun, the client on Bun or in a browser.
- **Small.** About 1,100 lines: a ~690-line core (`channel.ts`), the WebSocket client (~245) and server (~145), and
  in-process messaging (~50). Optional: `more.ts` (~210) and the experimental QUIC transport (~300).

# Installation
`bun add v57/channel`

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
// QUIC (experimental, see docs/quic.md)
import { Channel } from 'channel/quic'
await new Channel().post('hello', () => 'world').listenQuic(4433, { key, cert })
const client = new Channel().connect('quic://localhost:4433', { quic: { ca: cert } })
```

# Docs
- [Client](docs/client.md): requests, streams, subscriptions, reconnect
- [Server](docs/server.md)
- [Message structure](docs/structure.md)
- [QUIC transport](docs/quic.md)
- [Performance](docs/performance.md)
