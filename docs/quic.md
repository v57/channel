# QUIC transport

An optional second transport next to WebSocket. **Experimental**: it runs on Bun's `node:quic`, which Bun itself
marks experimental (Bun 1.4). WebSocket stays the default and the fallback: UDP is blocked on some networks, browsers
can't use it (that would need WebTransport, which Bun can't serve), and most ports don't implement it yet.

What it gives over WebSocket: a 1-RTT handshake including TLS, encryption on every connection, better loss recovery,
and connection migration (a phone moving between Wi-Fi and cellular keeps its connection).
The protocol itself doesn't change: same messages, same batching, same requests, streams and subscriptions.

``` ts
// Server
import { Channel } from 'channel/quic'
const key = await Bun.file('key.pem').text()
const cert = await Bun.file('cert.pem').text()
const server = await new Channel().post('hello', () => 'world').listenQuic(4433, { key, cert })
// listenQuic takes the same state / onConnect / onDisconnect options as listen()
await server.stop()
```

``` ts
// Client: importing 'channel/quic' makes connect() accept quic:// addresses
import { Channel } from 'channel/quic'
const client = new Channel().connect('quic://example.com:4433')
console.log(await client.send('hello'))
```

## Certificates

QUIC has no plaintext mode, so the server always needs a key and certificate (PEM). The client verifies it:
- **Trusted certificate** (for example Let's Encrypt): nothing to configure.
- **Self-signed**: `connect('quic://127.0.0.1:4433', { quic: { ca: cert } })` trusts that certificate. The address must
  be in the certificate's subject alternative names, as a DNS name or an IP address.
- **Pinned**: `{ quic: { fingerprint: 'DD:D2:37:…' } }` accepts only the certificate with that SHA-256 fingerprint and
  skips the other checks. Print it with `openssl x509 -in cert.pem -noout -fingerprint -sha256`.
- `servername` overrides the name sent and checked (it defaults to the address host).

A self-signed certificate for local use:
``` sh
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout key.pem -out cert.pem \
  -days 365 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

## Wire format

For implementations in other languages. Everything not listed here works exactly like the WebSocket transport.

- **QUIC v1** over UDP, ALPN `channel/1`. TLS 1.3 as QUIC requires. 0-RTT is disabled, because a replayed 0-RTT
  request could run twice.
- **One stream per connection.** Right after the handshake, the client opens one bidirectional stream and all messages
  of the connection go over it, in both directions. The server refuses any further stream.
- **Frames.** Each message is its length followed by that many bytes of UTF-8 JSON. The length is a QUIC
  variable-length integer ([RFC 9000 §16](https://www.rfc-editor.org/rfc/rfc9000#section-16)): the top two bits of the
  first byte give the size of the integer (1, 2, 4 or 8 bytes), the rest is the value, big-endian.
  The JSON is exactly what a WebSocket text message would carry: one message object or an array of them.
- **Hello.** The first frame from the client is `{"hello": {...}}`, holding the same headers a WebSocket client sends
  with its upgrade request (string values). The server lowercases the names and builds the connection state from them,
  as it does from the upgrade request. There is no reply. If the state can't be built, the server closes the connection.
- **Limits and errors.** Frames above 16 MiB (Bun's default WebSocket limit), invalid JSON, or a first frame that isn't
  a hello close the connection.
- **Keepalive.** A zero-length frame is a keepalive and is ignored. Both sides set the QUIC idle timeout
  (`max_idle_timeout`) to 30 s; the client sends a keepalive every 15 s.
- **Reconnect.** Same as WebSocket: the client reconnects with the same backoff (see [client.md](client.md)) and
  replays its unanswered requests.

## Measurements

`bun tests/benchmark.ts` and `bun tests/benchmark.ts quic`: one client sending `hello` requests to one server over
localhost, Bun 1.4.2, Apple Silicon. Preliminary (2026-10-11): the machine was under heavy load from other work
(load average 30-60), so only the ratio means much.

| Concurrent requests | WebSocket | QUIC |
| ---: | ---: | ---: |
| 1 | 9.0k-9.2k req/s | 8.5k-8.8k req/s |
| 100 | 85k | 82k |
| 1,000 | 666k-672k | 472k-476k |
| 10,000 | 707k-843k | 585k-605k |

At low concurrency both are limited by the client, not the transport. Under load QUIC reaches about 70-85% of
WebSocket throughput (userspace crypto and congestion control). Not measured yet: topic fan-out with many subscribers,
CPU per request, and a network switch (connection migration).

## Differences from the WebSocket server

- Topic fan-out runs in JavaScript (a loop over the subscribed connections). The WebSocket server uses Bun's native
  pub/sub in C, so servers with many subscribers will spend more CPU over QUIC.
- Bun can't serve WebSocket over HTTP/3 or WebTransport yet, so a browser can't reach a QUIC listener. Run both:
  `listen(8080)` for WebSocket and `listenQuic(4433, …)` on the same `Channel`.

## Status in the other implementations

TypeScript (this repo) is the only implementation so far. Libraries that would fit, from the 2026-10-10 survey:
Rust (quinn), Go (quic-go, frozen port), C (msquic, ngtcp2), Elixir (quicer), Python (aioquic), C# (System.Net.Quic),
Zig (msquic through its C interop), Java/Kotlin (Netty QUIC or Kwik, heavy), Swift (Network.framework on Apple, frozen
port). Dart, Ruby and PHP have no usable QUIC library and stay on WebSocket.
