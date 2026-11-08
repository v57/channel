# Ports

Channel has one reference implementation, the TypeScript library in this repository, and a port per language. The
ports speak the same wire format ([structure.md](structure.md), [v2.md](v2.md), [quic.md](quic.md)) and are tested
against the reference: their clients call the interop fixture (`tests/server.ts`, `127.0.0.1:2049`), and several run
the reference client against their own server. A protocol change starts here and then goes to every port.

Each port is its own repository under `github.com/v57`. In a checkout of the Channel workspace they sit next to this
repository (`../channel-go` and so on), and some ports' tests and benchmarks reach this repository by that relative
path, so keep them side by side.

## Packages

The install line is the one the port's README gives. Several ports aren't published to their language's registry
yet: their line is a version placeholder or a path dependency, and the way to use them today is a checkout or a git
dependency.

| Language | Repository | Package | Install | Runtime |
| --- | --- | --- | --- | --- |
| TypeScript (reference) | [v57/channel](https://github.com/v57/channel) | `channel` | `bun add v57/channel` | Bun (server, client), browsers (client) |
| C | [v57/channel-c](https://github.com/v57/channel-c) | CMake libraries `channel_c`, `channel_c_quic` | build with CMake; needs libwebsockets, yyjson, OpenSSL | C17 |
| C# | [v57/channel-cs](https://github.com/v57/channel-cs) | `ChannelCs` (+ `.Client`, `.Server`, `.Process`) | `dotnet add package ChannelCs` | .NET 10 |
| Dart | [v57/channel-dart](https://github.com/v57/channel-dart) | `channel_dart` | `dart pub add channel_dart` | Dart SDK 3.11+ |
| Elixir | [v57/channel_ex](https://github.com/v57/channel_ex) | `:channel_ex` | `{:channel_ex, path: "../channel_ex"}` in `mix.exs` | Elixir 1.19+, OTP 28+ |
| Go | [v57/channel-go](https://github.com/v57/channel-go) | `github.com/v57/channel-go` (QUIC: `…/channel-go/quic`) | `go get github.com/v57/channel-go` | Go 1.25; macOS and Linux, not Windows |
| Java | [v57/channel-java](https://github.com/v57/channel-java) | `v57.channel:channel-java-core`, `-client`, `-server`, `-process`, `-quic` | Gradle `implementation("v57.channel:channel-java-core:VERSION")` | Java 21 |
| Kotlin | [v57/channel-kotlin](https://github.com/v57/channel-kotlin) | `channel-kotlin`, `channel-kotlin-quic` | Gradle `implementation("verification:channel-kotlin:VERSION")` | JDK 21 (JVM only) |
| PHP | [v57/channel-php](https://github.com/v57/channel-php) | Composer `dimas/channel-php` | `composer install` in the checkout | PHP 8.3+ with `ext-openswoole` |
| Python | [v57/channel-py](https://github.com/v57/channel-py) | `channel-py` (module `channel_py`, extra `quic`) | `uv sync` in the checkout; QUIC: `channel-py[quic]` | Python 3.12+ |
| Ruby | [v57/channel-rb](https://github.com/v57/channel-rb) | `require "channel_rb"` (no gem yet) | `bundle install` in the checkout | Ruby 3 with `oj`, `iodine` |
| Rust | [v57/channel-rs](https://github.com/v57/channel-rs) | crate `channel-rs` (feature `quic`) | `cargo add channel-rs` | Rust 2024 edition, tokio |
| Swift | [v57/ChannelSwift](https://github.com/v57/ChannelSwift) | SwiftPM product `Channel` | `.package(url: "https://github.com/v57/ChannelSwift.git", branch: "main")` | Swift 6.1; Apple platforms, Linux |
| Zig | [v57/channel-zig](https://github.com/v57/channel-zig) | `channel_zig` (module `channel`) | dependency in `build.zig.zon` | Zig 0.15.1+ |

## Status

- **Transports**: WS = WebSocket client and server, process = in-process. QUIC is experimental and optional in every
  port that has it; the libraries and how each port keeps them optional are in [quic.md](quic.md#status-in-the-other-implementations).
- **Reconnect**: whether the client reconnects on its own and sends unanswered requests again.
- **Wire v2 tests**: the port's tests call the v2 routes of the interop fixture ([v2.md §7](v2.md#7-interop-fixture-testsserverts-port-2049)).
- **Reply origin**: the port follows the rule that a response answers a request only on the connection the request
  went to ([structure.md](structure.md#request-ids-and-connections)), as its git history shows.

| Language | Status | Transports | QUIC | Reconnect | Wire v2 tests | Reply origin |
| --- | --- | --- | --- | --- | --- | --- |
| TypeScript | reference | WS, process | Bun `node:quic` | yes, backoff 100 ms to 5 s | yes (defines them) | yes |
| C | complete | WS, process | OpenSSL 3.5 (`-DCHANNEL_QUIC=ON`) | no | yes | not yet |
| C# | complete | WS, process | `System.Net.Quic` (libmsquic) | yes | yes | yes |
| Dart | complete | WS, process | none | yes | no | yes |
| Elixir | complete | WS, process | quicer (optional dependency) | no | yes | not yet |
| Go | complete, frozen | WS, process | quic-go (separate module) | yes, every 100 ms | yes | yes (its server test hasn't run yet) |
| Java | complete | WS, process | kwik (`channel-java-quic`) | no | yes | not yet |
| Kotlin | complete | WS, process | kwik (`channel-kotlin-quic`) | no | yes | not yet |
| PHP | complete | WS, process | none | yes | no | yes |
| Python | complete | WS, process | aioquic (extra `quic`) | yes | yes | yes |
| Ruby | complete | WS, process | none | yes | no | yes |
| Rust | complete | WS, process | quinn (feature `quic`) | no | yes | not yet |
| Swift | complete, frozen | WS client only | Network.framework, client only | yes, backoff 100 ms to 5 s | yes | yes |
| Zig | complete | WS, process | OpenSSL 3.5 (`-Dquic=true`) | no | yes | not yet |

Notes:
- "Frozen" ports get fixes, not new features.
- Ports without reconnect fail pending calls with `disconnected` when the connection drops.
- Swift has no listening server. The Swift server is `ChannelServer`, a separate library in HubServer
  ([v57/HubServer](https://github.com/v57/HubServer)), which also serves QUIC. See
  [ChannelSwift's docs](https://github.com/v57/ChannelSwift/blob/main/docs/ChannelSwift.md).
- Dart, PHP and Ruby have no usable QUIC library and stay on WebSocket.
- Each port's README has its usage, dependencies and notes on where it differs.

## Testing a port

Every port except Swift has `scripts/test`, `scripts/coverage` and `scripts/benchmark`. `scripts/test` runs the unit
tests and the interop tests; the interop tests need the fixture of this repository running:

```bash
cd channel
bun tests/server.ts        # WebSocket and QUIC on 127.0.0.1:2049; CHANNEL_TEST_PORT picks another port
```

Swift runs `swift test` (see [ChannelSwift's docs](https://github.com/v57/ChannelSwift/blob/main/docs/ChannelSwift.md#testing)).

The test cases every port covers for wire v2 are listed in [v2.md §7](v2.md#7-interop-fixture-testsserverts-port-2049).

## Adding a port

1. Implement the message shapes and dispatch in [structure.md](structure.md), including the request id rules.
2. Implement wire v2 ([v2.md](v2.md)): structured errors, subscriptions, request options, reconnect.
3. Run your client against `tests/server.ts` and the reference client against your server.
4. QUIC is optional; if you add it, follow the wire format in [quic.md](quic.md) and test it against
   `listenQuic` in the fixture.
