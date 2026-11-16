# Channel

A small message protocol for requests, streams and subscriptions between two peers, in fourteen languages.

Channel runs over WebSocket, over QUIC (experimental), or inside one process. The protocol is symmetric: once two
peers are connected, either side can call the other, so a server can call its clients back over the same connection.
The Hub uses Channel for every connection between hubs, services and apps; the Hub protocol itself (auth,
certificates, Hub APIs) is described in the Hub protocol (`Docs/Devices/protocol.md` in the Hub workspace), not here.

This repository is the TypeScript library and the **source of truth** for the protocol. The other languages port it
and are checked against it: their clients call the interop fixture (`tests/server.ts`), and several run the reference
client against their own server. Pick your language in the menu of any code block; where a port lacks a call, the block
shows TypeScript and says so.

## Install

Most ports aren't on their language's registry yet. Use them from a checkout of the Channel workspace
(`github.com/v57/channel-<language>`), as the lines below show.

```ts
// bun add v57/channel
import { Channel } from 'channel/server' // or channel/client, channel/process, channel/quic
```

```swift
// Package.swift: the client
.package(url: "https://github.com/v57/ChannelSwift.git", branch: "main"),
.product(name: "Channel", package: "ChannelSwift"),
// the server is ChannelServer, a library of HubServer
.package(url: "https://github.com/v57/HubServer.git", branch: "main"),
.product(name: "ChannelServer", package: "HubServer"),
```

```go
// go get github.com/v57/channel-go
import (
	"github.com/v57/channel-go/channelgo"
	"github.com/v57/channel-go/client"
	"github.com/v57/channel-go/server"
)
```

```py
# In a checkout of github.com/v57/channel-py: uv sync (QUIC: uv sync --extra quic)
from channel_py import Channel
```

```rs
// Cargo.toml: channel-rs = { git = "https://github.com/v57/channel-rs.git" } (QUIC: features = ["quic"])
use channel_rs::{CallResult, Channel, ChannelError, ConnectOptions, ListenOptions, PostRequest};
```

```kotlin
// settings.gradle.kts, with github.com/v57/channel-kotlin checked out next to your project
includeBuild("../channel-kotlin")
// build.gradle.kts
dependencies { implementation(":channel-kotlin:unspecified") }
```

```java
// settings.gradle.kts, with github.com/v57/channel-java checked out next to your project
includeBuild("../channel-java")
// build.gradle.kts: core plus the transports you use (-client, -server, -process, -quic)
dependencies {
  implementation("v57.channel:channel-java-core")
  implementation("v57.channel:channel-java-client")
}
```

```cs
// Reference the projects of a checkout of github.com/v57/channel-cs:
// src/ChannelCs, src/ChannelCs.Client, src/ChannelCs.Server, src/ChannelCs.Process
using ChannelCs;
using ChannelCs.Client;
```

```dart
// pubspec.yaml
// dependencies:
//   channel_dart:
//     git: https://github.com/v57/channel-dart.git
import 'package:channel_dart/client.dart'; // or server.dart, process.dart, quic.dart
```

```php
// In a checkout of github.com/v57/channel-php: composer install (needs ext-openswoole)
require 'vendor/autoload.php';
use ChannelPhp\Channel;
```

```rb
# In a checkout of github.com/v57/channel-rb: bundle install, then ruby -I channel-rb/lib app.rb
require 'channel_rb'
```

```ex
# mix.exs, with github.com/v57/channel_ex checked out next to your project
{:channel_ex, path: "../channel_ex"}
```

```c
/* Build a checkout of github.com/v57/channel-c with CMake (needs libwebsockets, yyjson, OpenSSL),
   link channel_c (QUIC: -DCHANNEL_QUIC=ON, channel_c_quic) */
#include "channel-c/channel_c.h"
```

```zig
// build.zig.zon: .dependencies = .{ .channel_zig = .{ .path = "../channel-zig" } },
// build.zig
const channel_dep = b.dependency("channel_zig", .{ .target = target, .optimize = optimize });
exe.root_module.addImport("channel", channel_dep.module("channel"));
```

## Hello world

A server with one path, `hello`:

```ts
import { Channel } from 'channel/server'

new Channel().post('hello', () => 'world').listen(8080)
```

```swift
import ChannelServer
import Foundation

let queue = DispatchQueue(label: "server")
let router = ChannelRouter()
router.post("hello") { _ in "world" }
router.listen(WebSocketServer(ListenAddress(port: 8080)), queue: queue)
dispatchMain()
```

```go
ch := channelgo.NewChannel().Post("hello", func(channelgo.Body) (any, error) { return "world", nil })
srv, err := server.Listen(ch, 8080, server.Options{})
if err != nil {
	log.Fatal(err)
}
defer srv.Stop()
select {}
```

```py
import asyncio
from channel_py import Channel

async def main():
    server = Channel().post("hello", lambda _: "world").listen(8080)
    await server.wait_started()
    await asyncio.Event().wait()

asyncio.run(main())
```

```rs
use channel_rs::{Channel, ChannelError, ListenOptions, PostRequest};
use std::{thread, time::Duration};

#[derive(Default)]
struct State;

fn main() -> Result<(), ChannelError> {
    let mut channel = Channel::<State>::new();
    channel.post_value("hello", |_request: PostRequest<'_, State, (), ()>| Ok("world"))?;
    let mut server = channel.listen(8080_u16, ListenOptions::default())?;
    loop {
        if !server.poll()? {
            thread::sleep(Duration::from_micros(100));
        }
    }
}
```

```kotlin
import channel.Channel

val server = Channel<MutableMap<String, Any?>>()
  .post<Unit, String, Unit>("hello") { "world" }
  .listen(8080)
while (true) server.poll()
```

```java
import v57.channel.Channel;

var server = new Channel<Void>()
    .post("hello", String.class, request -> "world")
    .listen(8080);
while (true) {
  if (!server.poll()) Thread.onSpinWait();
}
```

```cs
using ChannelCs;
using ChannelCs.Server;

var server = new Channel<Dictionary<string, object?>>()
    .Post("hello", _ => "world")
    .Listen(8080);
await Task.Delay(Timeout.Infinite);
```

```dart
import 'package:channel_dart/server.dart';

Future<void> main() async {
  await Channel<Object?>().post('hello', (_) => 'world').listen(8080);
}
```

```php
<?php
// Outside a coroutine: listen() runs the server in a child process
require 'vendor/autoload.php';
use ChannelPhp\Channel;

$server = (new Channel())->post('hello', static fn (): string => 'world')->listen(8080);
pcntl_waitpid($server->pid(), $status); // keep the parent, and so the server, alive
```

```rb
require 'channel_rb'

ChannelRB::Channel.new.post('hello') { 'world' }.listen(8080)
sleep # the server runs in a background thread
```

```ex
ChannelEx.new()
|> ChannelEx.post("hello", fn _ -> "world" end)
|> ChannelEx.listen(8080)

Process.sleep(:infinity)
```

```c
#include <unistd.h>
#include "channel-c/channel_c.h"

static int hello(const channel_c_post_request_t *request, char **out_body_json, char **out_error) {
  (void)request;
  (void)out_error;
  *out_body_json = channel_c_strdup("\"world\""); /* JSON text */
  return 0;
}

int main(void) {
  channel_c_channel_t *ch = channel_c_channel_new();
  channel_c_channel_post(ch, "hello", hello, NULL, 0);
  char *error = NULL;
  channel_c_server_t *server = channel_c_server_listen(ch, "127.0.0.1", 8080, (channel_c_state_factory_t){0}, &error);
  for (;;) {
    if (!channel_c_server_poll(server)) usleep(1000);
  }
}
```

```zig
const std = @import("std");
const channel = @import("channel");
const State = struct {};

fn hello(_: channel.PostRequest(State, void, void)) !?[]const u8 {
    return "world";
}

pub fn main() !void {
    const allocator = std.heap.page_allocator;
    var ch = channel.Channel(State).init(allocator);
    defer ch.deinit();
    _ = try ch.post("hello", hello);
    var server = try ch.listen(allocator, 8080, .{});
    defer server.deinit();
    while (true) {
        if (!(try server.poll())) std.Thread.sleep(1_000_000);
    }
}
```

A port number listens on `127.0.0.1`; most ports also take `'0.0.0.0:8080'` for every interface. The Rust, Kotlin,
Java, C and Zig servers run while something polls them, so they loop on `poll()`.

A client that calls it:

```ts
import { Channel } from 'channel/client'

const client = new Channel().connect(8080)
console.log(await client.send('hello'))
```

```swift
import Channel

@MainActor
func hello() async throws {
  let client = Channel<Void>().connect(8080) // ws://127.0.0.1:8080
  let answer: String = try await client.send("hello")
  print(answer)
}
```

```go
conn := client.Connect(channelgo.NewChannel(), 8080, client.Options{})
defer conn.Stop()
answer, err := conn.Send("hello", nil)
fmt.Println(answer, err)
```

```py
import asyncio
from channel_py import Channel

async def main():
    client = Channel().connect(8080)
    print(await client.send("hello"))

asyncio.run(main())
```

```rs
use channel_rs::{CallResult, Channel, ChannelError, ConnectOptions};

#[derive(Default)]
struct State;

fn main() -> Result<(), ChannelError> {
    let mut client = Channel::<State>::new().connect(8080_u16, ConnectOptions::default())?;
    if let CallResult::Ok(Some(answer)) = client.send::<String, _>("hello", ())? {
        println!("{answer}");
    }
    Ok(())
}
```

```kotlin
import channel.CallResult
import channel.Channel

val client = Channel<MutableMap<String, Any?>>().connect(8080)
when (val result = client.send<String>("hello")) {
  is CallResult.Ok -> println(result.value)
  is CallResult.RemoteErr -> error(result.error)
}
```

```java
import v57.channel.Channel;

try (var client = new Channel<Void>().connect(8080)) {
  System.out.println(client.sender().send(String.class, "hello").requireValue());
}
```

```cs
using ChannelCs;
using ChannelCs.Client;

var client = new Channel<Dictionary<string, object?>>().Connect(8080);
Console.WriteLine(await client.SendAsync<string>("hello"));
```

```dart
import 'package:channel_dart/client.dart';

Future<void> main() async {
  final client = Channel<Object?>().connect(8080);
  print(await client.send<String>('hello'));
}
```

```php
<?php
require 'vendor/autoload.php';
use ChannelPhp\Channel;
use OpenSwoole\Coroutine;

Coroutine::run(static function (): void {
    $client = (new Channel())->connect(8080);
    echo $client->send('hello'), "\n";
    $client->stop();
});
```

```rb
require 'channel_rb'

client = ChannelRB::Channel.new.connect(8080)
puts client.send('hello')
```

```ex
client = ChannelEx.connect(ChannelEx.new(), 8080)
{:ok, answer} = ChannelEx.send(client, "hello")
IO.inspect(answer)
```

```c
channel_c_channel_t *ch = channel_c_channel_new();
char *body = NULL, *error = NULL;
channel_c_client_t *client = channel_c_client_connect(ch, "ws://127.0.0.1:8080", NULL, NULL, &error);
if (channel_c_sender_send(channel_c_client_sender(client), "hello", NULL, NULL, &body, &error) == 0)
  printf("%s\n", body); /* "world", as JSON text */
channel_c_free(body);
channel_c_free(error);
channel_c_client_free(client);
channel_c_channel_free(ch);
```

```zig
var ch = channel.Channel(State).init(allocator);
defer ch.deinit();
var client = try ch.connect(allocator, 8080, .{});
defer client.deinit();
var result = try client.send(allocator, []const u8, "hello", {});
defer result.deinit(allocator);
std.debug.print("{s}\n", .{result.ok.?});
```

## Pages

| Page | What |
| --- | --- |
| [Client](client.md) | Connecting, calls, streams, subscriptions, errors, timeouts, reconnect |
| [Server](server.md) | Handlers, subscriptions and `publish`, errors, middleware, listen options, in-process |
| [QUIC transport](quic.md) | The optional QUIC transport, its certificates and wire format |
| [Performance](performance.md) | How fast the TypeScript library is, and why |

## Languages

Every port speaks the same wire format. WS is the WebSocket client and server, process the in-process transport.
Reconnect says whether the client reconnects on its own and sends unanswered calls again; ports without it fail
waiting calls with `disconnected` when the connection drops. `wss://` says whether the WebSocket client speaks TLS.

| Language | Package | Transports | QUIC | Reconnect | `wss://` |
| --- | --- | --- | --- | --- | --- |
| TypeScript (reference) | [channel](https://github.com/v57/channel) | WS, process | Bun's `node:quic` | yes | yes |
| C | [channel-c](https://github.com/v57/channel-c) | WS, process | OpenSSL 3.5 | no | yes |
| C# | [channel-cs](https://github.com/v57/channel-cs) | WS, process | `System.Net.Quic` | yes | yes |
| Dart | [channel-dart](https://github.com/v57/channel-dart) | WS, process | OpenSSL 3.5 | yes | yes |
| Elixir | [channel_ex](https://github.com/v57/channel_ex) | WS, process | quicer | no | no |
| Go | [channel-go](https://github.com/v57/channel-go) | WS, process | quic-go | yes | no |
| Java | [channel-java](https://github.com/v57/channel-java) | WS, process | kwik | no | no |
| Kotlin | [channel-kotlin](https://github.com/v57/channel-kotlin) | WS, process | kwik | no | no |
| PHP | [channel-php](https://github.com/v57/channel-php) | WS, process | OpenSSL 3.5 | yes | when OpenSwoole is built with OpenSSL |
| Python | [channel-py](https://github.com/v57/channel-py) | WS, process | aioquic | yes | yes |
| Ruby | [channel-rb](https://github.com/v57/channel-rb) | WS, process | OpenSSL 3.5 | yes | when iodine is built with TLS |
| Rust | [channel-rs](https://github.com/v57/channel-rs) | WS, process | quinn | no | no |
| Swift | [ChannelSwift](https://github.com/v57/ChannelSwift) (client), `ChannelServer` in [HubServer](https://github.com/v57/HubServer) (server) | WS | Network.framework, Apple platforms | yes | yes |
| Zig | [channel-zig](https://github.com/v57/channel-zig) | WS, process | OpenSSL 3.5 | no | no |

Go and Swift are frozen: they get fixes, not new features. Each port's README has its full API and where it differs.

## Wire format

Messages are JSON. A frame carries one message object or an array of them (a batch). The fields are `id`, `path`,
`body`, `context`, `error`, `code`, `info`, `cancel`, `sub`, `unsub`, `topic`, `stream` and `done`. For people
writing a port:

- [Message structure](structure.md): every message shape (requests, responses, streams, subscriptions, events), how a
  receiver dispatches them, and how request ids belong to connections.
- [Wire v2](v2.md): structured errors (`code`, `info`), one-shot and dynamic-topic subscriptions, middleware, listen
  and request options, reconnect rules, and the interop fixture (`tests/server.ts`) every port tests against.
- [Ports](ports.md): each port's repository, install line and test status, and how to add one.
- [QUIC transport](quic.md#wire-format): ALPN `channel/1`, one stream per connection, varint-length frames.
