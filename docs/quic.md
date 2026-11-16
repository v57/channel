# QUIC transport

An optional second transport next to WebSocket. **Experimental**: it runs on Bun's `node:quic`, which Bun itself
marks experimental (Bun 1.4). WebSocket stays the default and the fallback: UDP is blocked on some networks, browsers
can't use it (that would need WebTransport, which Bun can't serve), and some networks only pass TCP.

What it gives over WebSocket: a 1-RTT handshake including TLS, encryption on every connection, better loss recovery,
and connection migration (a phone moving between Wi-Fi and cellular keeps its connection).
The protocol itself doesn't change: same messages, same batching, same requests, streams and subscriptions.

The server needs a key and certificate in PEM (Swift's takes a PKCS#12 file); the client below trusts that
self-signed certificate with `ca`, as [Certificates](#certificates) explains.

A server:

```ts
import { Channel } from 'channel/quic'

const key = await Bun.file('key.pem').text()
const cert = await Bun.file('cert.pem').text()
const server = await new Channel().post('hello', () => 'world').listenQuic(4433, { key, cert })
// listenQuic takes the same state / onConnect / onDisconnect options as listen()
await server.stop()
```

```swift
// ChannelServer, Apple platforms; openssl pkcs12 -export -inkey key.pem -in cert.pem -out server.p12
import ChannelServer
import Foundation

let router = ChannelRouter().post("hello") { _ in "world" }
let quic = try QUICServer(ListenAddress(port: 4433),
                          pkcs12: Data(contentsOf: URL(fileURLWithPath: "server.p12")), password: "secret")
router.listen(quic, queue: queue) { result in print("quic:", result) }
```

```go
import "github.com/v57/channel-go/quic" // a module of its own

srv, err := quic.Listen(channelgo.NewChannel().Post("hello", func(channelgo.Body) (any, error) {
	return "world", nil
}), 4433, quic.ListenOptions{Key: key, Cert: cert}) // PEM []byte
```

```py
# uv sync --extra quic
key, cert = open("key.pem").read(), open("cert.pem").read()
server = Channel().post("hello", lambda _: "world").listen_quic(4433, {"key": key, "cert": cert})
await server.wait_started()
```

```rs
// channel-rs with features = ["quic"]
use channel_rs::QuicListenOptions;

let cert = std::fs::read("cert.pem")?;
let key = std::fs::read("key.pem")?;
let mut channel = Channel::<State>::new();
channel.post_value("hello", |_request: PostRequest<'_, State, (), ()>| Ok("world"))?;
let mut server = channel.listen_quic("127.0.0.1:4433", QuicListenOptions::new(cert, key))?;
// poll it like a WebSocket server
```

```kotlin
// module channel-kotlin-quic
import channel.quic.QuicListenOptions
import channel.quic.listenQuic

val server = Channel<MutableMap<String, Any?>>()
  .post<Unit, String, Unit>("hello") { "world" }
  .listenQuic(4433, QuicListenOptions(key = key, cert = cert))
while (true) server.poll()
```

```java
// module channel-java-quic
var server = new Channel<Void>()
    .post("hello", String.class, r -> "world")
    .listenQuic(4433, new ListenOptions<Void>().withCertificate(cert, key)); // certificate first
while (true) {
  if (!server.poll()) Thread.onSpinWait();
}
```

```cs
// System.Net.Quic: needs libmsquic on Linux and macOS
var server = new Channel<Dictionary<string, string?>>()
    .Post("hello", _ => "world")
    .ListenQuic(4433, new QuicListenOptions<Dictionary<string, string?>> { Key = key, Cert = cert });
```

```dart
import 'package:channel_dart/quic.dart'; // OpenSSL 3.5+ through dart:ffi

await Channel<Object?>().post('hello', (_) => 'world')
    .listenQuic(4433, options: QuicListenOptions(key: key, cert: cert));
```

```php
// ext-ffi and OpenSSL 3.5+; unlike listen(), it runs inside a coroutine
Coroutine::run(static function () use ($key, $cert): void {
    $server = (new Channel())->post('hello', static fn (): string => 'world')
        ->listenQuic(4433, ['key' => $key, 'cert' => $cert]);
    // ...
});
```

```rb
require 'channel_rb/quic' # OpenSSL 3.5+ through fiddle

server = ChannelRB::Channel.new.post('hello') { 'world' }.listen_quic(4433, key: key, cert: cert)
```

```ex
# mix.exs also needs {:quicer, "~> 0.4.12"}
listener =
  ChannelEx.new()
  |> ChannelEx.post("hello", fn _ -> "world" end)
  |> ChannelEx.listen_quic(4433, key: File.read!("key.pem"), cert: File.read!("cert.pem"))
```

```c
#include "channel-c/channel_c_quic.h" /* -DCHANNEL_QUIC=ON, link channel_c_quic */

channel_c_quic_server_options_t quic = { .cert_pem = cert_pem, .key_pem = key_pem };
channel_c_quic_server_t *server =
  channel_c_quic_server_listen(ch, "127.0.0.1", 4433, (channel_c_state_factory_t){0}, &quic, &error);
for (;;) channel_c_quic_server_poll(server);
```

```zig
// build.zig: b.dependency("channel_zig", .{ ..., .quic = true })
var server = try ch.listenQuic(allocator, 4433, .{ .cert = cert_pem, .key = key_pem });
defer server.deinit();
while (true) _ = try server.poll();
```

A client:

```ts
// Importing 'channel/quic' makes connect() accept quic:// addresses
import { Channel } from 'channel/quic'

const client = new Channel().connect('quic://127.0.0.1:4433', { quic: { ca: cert } })
console.log(await client.send('hello'))
```

```swift
let client = Channel<Void>().connect(URL(string: "quic://127.0.0.1:4433")!, options: ClientOptions(
  quic: QUICOptions(ca: try Data(contentsOf: URL(fileURLWithPath: "cert.pem")))
))
let answer: String = try await client.send("hello")
```

```go
conn, err := quic.Connect(channelgo.NewChannel(), "quic://127.0.0.1:4433", quic.Options{CA: cert})
answer, err := conn.Send("hello", nil)
```

```py
client = Channel().connect("quic://127.0.0.1:4433", {"quic": {"ca": cert}})
print(await client.send("hello"))
```

```rs
use channel_rs::QuicOptions;

let mut client = Channel::<State>::new().connect("quic://127.0.0.1:4433", ConnectOptions {
    quic: QuicOptions { ca: Some(cert), ..QuicOptions::default() },
    ..ConnectOptions::default()
})?;
let answer = client.send::<String, _>("hello", ())?;
```

```kotlin
import channel.quic.QuicConnectOptions
import channel.quic.connectQuic

val client = Channel<MutableMap<String, Any?>>().connectQuic("quic://127.0.0.1:4433", QuicConnectOptions(ca = cert))
val answer = client.send<String>("hello")
```

```java
var client = new Channel<Void>().connect("quic://127.0.0.1:4433",
    new ConnectOptions<Void>().withQuic(new QuicOptions().withCa(cert)));
var answer = client.sender().send(String.class, "hello").requireValue();
```

```cs
var client = new Channel<Dictionary<string, object?>>().Connect("quic://127.0.0.1:4433", new()
{
    Quic = new QuicClientOptions { Ca = cert },
});
Console.WriteLine(await client.SendAsync<string>("hello"));
```

```dart
final client = Channel<Object?>().connectQuic('quic://127.0.0.1:4433', quic: QuicOptions(ca: cert));
print(await client.send<String>('hello'));
```

```php
Coroutine::run(static function () use ($cert): void {
    $client = (new Channel())->connect('quic://127.0.0.1:4433', ['quic' => ['ca' => $cert]]);
    echo $client->send('hello'), "\n";
});
```

```rb
require 'channel_rb/quic'

client = ChannelRB::Channel.new.connect('quic://127.0.0.1:4433', quic: { ca: cert })
puts client.send('hello')
```

```ex
client = ChannelEx.connect(ChannelEx.new(), "quic://127.0.0.1:4433", quic: [ca: File.read!("cert.pem")])
{:ok, "world"} = ChannelEx.send(client, "hello")
```

```c
channel_c_quic_tls_options_t tls = { .ca_pem = cert_pem };
channel_c_quic_client_t *client = channel_c_quic_client_connect(client_ch, "quic://127.0.0.1:4433", NULL, &tls, &error);
channel_c_sender_send(channel_c_quic_client_sender(client), "hello", NULL, NULL, &body, &error);
```

```zig
var client = try client_ch.connect(allocator, "quic://127.0.0.1:4433", .{ .quic = .{ .ca = cert_pem } });
defer client.deinit();
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
  -days 365 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -addext "extendedKeyUsage=serverAuth"
```
Apple's TLS (the Swift client) trusts a self-signed `ca` only when it is valid for at most 825 days and has the
`serverAuth` extended key usage; a pinned fingerprint skips that. macOS's own `/usr/bin/openssl` (LibreSSL) makes an
EC certificate Apple rejects with this command: use `-newkey rsa:2048` there, or OpenSSL 3.

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
- **One UDP socket per client connection.** A client dials every connection, reconnects included, from its own
  socket instead of sharing one endpoint: Network.framework's QUIC servers (Swift's HubServer) take only one
  connection per client address and port.
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

QUIC client and server, each tested against this reference in both directions (its client against `listenQuic` in
`tests/server.ts`, this client against its server). The QUIC library is optional wherever the language's SDK doesn't
already have QUIC, so a WebSocket-only install gets none of it.

| Language | QUIC library | How it's optional | Reconnect + replay |
| --- | --- | --- | --- |
| TypeScript | Bun's `node:quic` | import `channel/quic` | yes |
| Go | quic-go | nested module `github.com/v57/channel-go/quic` | yes |
| Swift | Network.framework (Apple platforms) | built in; client in ChannelSwift, server in HubServer's ChannelServer (`QUICServer`) | yes |
| C# | `System.Net.Quic` (needs libmsquic on Linux and macOS) | built in | yes |
| Rust | quinn, rustls (ring) | Cargo feature `quic` | no: the port's client doesn't reconnect |
| Python | aioquic | extra `channel-py[quic]`, imported lazily | yes (requests made while disconnected) |
| Elixir | quicer (msquic) | optional Hex dependency | no: the port's client doesn't reconnect |
| Java | kwik (pure Java, LGPL-3.0) | module `channel-java-quic` | no: the port's client doesn't reconnect |
| Kotlin (JVM) | kwik (pure Java, LGPL-3.0) | module `channel-kotlin-quic`, `connectQuic` / `listenQuic` | no: the port's client doesn't reconnect |
| C | OpenSSL 3.5+ native QUIC | CMake option `CHANNEL_QUIC`, library `channel_c_quic` | no: the port's client doesn't reconnect |
| Zig | OpenSSL 3.5+ native QUIC (no pure-Zig library runs on Zig 0.15) | build option `-Dquic=true`; the default build stays pure Zig | no: the port's client doesn't reconnect |
| Dart | OpenSSL 3.5+ native QUIC through `dart:ffi` (no Dart QUIC library) | import `package:channel_dart/quic.dart`; no package added | yes |
| PHP | OpenSSL 3.5+ native QUIC through `ext-ffi` (no PHP QUIC library) | used only for `quic://` and `listenQuic`; `ext-ffi` is a suggested extension | yes (requests made while disconnected) |
| Ruby | OpenSSL 3.5+ native QUIC through `fiddle` (no Ruby QUIC library) | `require 'channel_rb/quic'`; no gem added | yes (requests made while disconnected) |

Notes from the ports:
- A self-signed certificate with `CA:TRUE` (like `tests/quic/cert.pem`) isn't accepted as a server certificate by
  rustls; the Rust client trusts a server certificate identical to one in `ca` directly, after checking its names.
- Bun's client offers QUIC v2 through compatible version negotiation (RFC 9368). kwik's server (Java, Kotlin) switches
  to it even when only v1 is configured, so both accept v1 and v2. The stream format is the same in both versions.
- kwik can't turn 0-RTT off: channel-java's server replaces its session ticket store, channel-kotlin's refuses a
  connection that sent early data.
- OpenSSL 3.5 can't lower the stream limits, so the C server resets any stream after the first.
