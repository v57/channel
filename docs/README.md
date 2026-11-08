# Channel documentation

Channel is a small message protocol for requests, streams and subscriptions between two peers. It runs over
WebSocket, over QUIC (experimental), or inside one process. The protocol is symmetric: once two peers are connected,
either side can call the other, so a server can call its clients back over the same connection.

This repository is the TypeScript library and the **source of truth** for the protocol. The other languages port it
and are checked against it (see [ports.md](ports.md)). The Hub uses Channel for every connection between hubs,
services and apps; the Hub protocol itself (auth, certificates, Hub APIs) is described in the Hub protocol
(`Docs/Devices/protocol.md` in the Hub workspace), not here.

## Wire format

Messages are JSON. A frame carries one message object or an array of them (a batch). The fields are `id`, `path`,
`body`, `context`, `error`, `code`, `info`, `cancel`, `sub`, `unsub`, `topic`, `stream` and `done`.

- [structure.md](structure.md): every message shape (requests, responses, streams, subscriptions, events), how a
  receiver dispatches them, and how request ids belong to connections.
- [v2.md](v2.md): wire v2, which every v1 peer still understands: structured errors (`code`, `info`), one-shot and
  dynamic-topic subscriptions, middleware, listen and request options, reconnect rules, and the interop fixture
  (`tests/server.ts`) every port tests against.
- [quic.md](quic.md): the QUIC transport: ALPN `channel/1`, one stream per connection, varint-length frames, the hello
  frame, certificates, and which ports implement it.

## Using the TypeScript library

`bun add v57/channel`. The server runs on Bun; the client runs on Bun or in a browser. There are no dependencies.

- [client.md](client.md): connecting, requests, streams, subscriptions, errors, timeouts, reconnect.
- [server.md](server.md): handlers, subscriptions, `publish`, middleware, listen options.
- [performance.md](performance.md): why it is fast, with measurements.

The entry points (`channel/server`, `channel/client`, `channel/quic`, `channel/middleware`, `channel/process`,
`channel/more`) are listed in the [README](../README.md#libraries).

## Other languages

[ports.md](ports.md) lists every port: its repository, package and install line, transports (WebSocket, in-process,
QUIC), reconnect support and how far its tests cover the reference.

## Pages

| Page | What |
| --- | --- |
| [client.md](client.md) | TypeScript client API |
| [server.md](server.md) | TypeScript server API |
| [structure.md](structure.md) | Message shapes, dispatch, request ids |
| [v2.md](v2.md) | Wire v2: errors, subscriptions, middleware, options, interop fixture |
| [quic.md](quic.md) | QUIC transport and its wire format |
| [ports.md](ports.md) | Implementations in other languages |
| [performance.md](performance.md) | Speed |
