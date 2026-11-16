# Client

Connect to a Channel server, then call it: requests that answer once, streams that keep answering, and subscriptions
to events the server publishes.

The examples call the server from [Server](server.md): `hello`, `add`, `count` and `room`.

## Connect

`connect` takes a port on `127.0.0.1` or a `ws://` or `wss://` address and returns at once; the connection opens in
the background, and calls made before it opens wait for it.

```ts
import { Channel } from 'channel/client'

const client = new Channel().connect(8080) // or connect('wss://example.com')
```

```swift
import Channel

let client = Channel<Void>().connect(8080) // or connect(URL(string: "wss://example.com")!)
```

```go
conn := client.Connect(channelgo.NewChannel(), 8080, client.Options{}) // or "ws://example.com"
```

```py
client = Channel().connect(8080)  # or connect("wss://example.com")
```

```rs
let mut client = Channel::<State>::new().connect(8080_u16, ConnectOptions::default())?; // or "ws://example.com:80"
```

```kotlin
val client = Channel<MutableMap<String, Any?>>().connect(8080) // or connect("ws://example.com")
```

```java
var client = new Channel<Void>().connect(8080); // or connect("ws://example.com")
```

```cs
var client = new Channel<Dictionary<string, object?>>().Connect(8080); // or Connect("wss://example.com")
```

```dart
final client = Channel<Object?>().connect(8080); // or connect('wss://example.com')
```

```php
$client = (new Channel())->connect(8080); // or connect('wss://example.com'), inside a coroutine
```

```rb
client = ChannelRB::Channel.new.connect(8080) # or connect('wss://example.com')
```

```ex
client = ChannelEx.connect(ChannelEx.new(), 8080) # or "ws://example.com:8080"
```

```c
channel_c_client_t *client = channel_c_client_connect(ch, "ws://127.0.0.1:8080", NULL, NULL, &error);
```

```zig
var client = try ch.connect(allocator, 8080, .{}); // or "ws://example.com:8080"
defer client.deinit();
```

The Rust, Kotlin, Java, C and Zig clients are single-threaded: they receive subscription events only while something
polls them, with `poll()` in your loop or any blocking call.

## Calls

A request sends a body to a path and waits for the one answer.

```ts
const sum = await client.send('add', { a: 1, b: 2 }) // 3
```

```swift
struct Add: Encodable, Sendable { var a: Int; var b: Int }

let sum: Int = try await client.send("add", Add(a: 1, b: 2)) // the result type picks the decoding
```

```go
sum, err := conn.Send("add", map[string]any{"a": 1, "b": 2}) // float64(3)
```

```py
total = await client.send("add", {"a": 1, "b": 2})
```

```rs
#[derive(serde::Serialize)]
struct Add { a: i64, b: i64 }

let sum = client.send::<i64, _>("add", Add { a: 1, b: 2 })?; // CallResult::Ok(Some(3))
```

```kotlin
val sum = client.send<Int>("add", mapOf("a" to 1, "b" to 2)) // CallResult<Int>
```

```java
var sum = client.sender().send(Integer.class, "add", Map.of("a", 1, "b", 2)); // CallResult<Integer>
```

```cs
var sum = await client.SendAsync<int>("add", new { a = 1, b = 2 });
```

```dart
final sum = await client.send('add', body: {'a': 1, 'b': 2});
```

```php
$sum = $client->send('add', ['a' => 1, 'b' => 2]);
```

```rb
sum = client.send('add', { 'a' => 1, 'b' => 2 })
```

```ex
{:ok, sum} = ChannelEx.send(client, "add", %{a: 1, b: 2})
```

```c
char *body = NULL, *error = NULL;
channel_c_sender_send(channel_c_client_sender(client), "add", "{\"a\":1,\"b\":2}", NULL, &body, &error); /* "3" */
channel_c_free(body);
```

```zig
const Add = struct { a: i64, b: i64 };

var sum = try client.send(allocator, i64, "add", Add{ .a = 1, .b = 2 });
defer sum.deinit(allocator);
```

## Streams

A stream sends one request and gets many values. Leaving the loop early cancels the stream on the server.

```ts
for await (const value of client.values('count')) {
  if (value === 2) break // cancels the stream on the server
}
```

```swift
for try await value in client.values("count", as: Int.self) {
  if value == 2 { break } // cancels the stream on the server
}
```

```go
values := conn.Values("count", nil)
for {
	item, err := values.Next(context.Background())
	if err != nil || item.Done {
		break
	}
	if item.Value == float64(2) {
		values.Return() // cancels the stream on the server
		break
	}
}
```

```py
values = client.values("count")
async for value in values:
    if value == 2:
        break
await values.aclose()  # cancels the stream on the server now
```

```rs
use channel_rs::StreamNext;

let mut values = client.values::<(), i64, ()>("count", (), ())?;
loop {
    match values.next()? {
        StreamNext::Item(2) | StreamNext::Done => break,
        StreamNext::Item(_) => {}
        StreamNext::RemoteErr(error) => return Err(ChannelError::new(error)),
    }
}
values.close(); // cancels the stream on the server (dropping it does too)
```

```kotlin
client.values<Int>("count").use { values ->
  while (true) {
    val next = values.next() as? StreamNext.Item ?: break
    if (next.value == 2) break // close() cancels the stream on the server
  }
}
```

```java
try (var values = client.sender().values(Integer.class, "count")) {
  for (var next = values.next(); next.isItem(); next = values.next()) {
    if (next.item() == 2) break; // close() cancels the stream on the server
  }
}
```

```cs
await foreach (var value in client.Values<int>("count"))
{
    if (value == 2) break; // cancels the stream on the server
}
```

```dart
await for (final value in client.values('count')) {
  if (value == 2) break; // cancels the stream on the server
}
```

```php
foreach ($client->values('count') as $value) {
    if ($value === 2) {
        break; // cancels the stream on the server
    }
}
```

```rb
client.values('count').each do |value|
  break if value == 2 # cancels the stream on the server
end
```

```ex
client
|> ChannelEx.values("count")
|> Enum.take_while(&(&1 != 2)) # stopping early sends the cancel
|> Enum.each(&IO.inspect/1)
```

```c
channel_c_values_t *values = channel_c_sender_values(channel_c_client_sender(client), "count", NULL, NULL, &error);
char *value = NULL;
int done = 0;
while (channel_c_values_next(values, &value, &done, &error) == 0 && !done) {
  int stop = strcmp(value, "2") == 0;
  channel_c_free(value);
  if (stop) break;
}
channel_c_values_close(values); /* cancels the stream on the server */
```

```zig
var values = try client.values(allocator, void, i64, void, "count", {}, {});
defer values.close(); // cancels the stream on the server
while (true) {
    var next = try values.next(allocator);
    defer next.deinit(allocator);
    switch (next) {
        .item => |value| if (value == 2) break,
        .done => break,
        .remote_err => return error.StreamFailed,
    }
}
```

An Elixir server computes the whole stream before it sends it, so it doesn't stop early; the Elixir client still
sends the cancel, which other servers act on.

## Subscriptions

A subscription asks the server for a topic. The server's first answer (the snapshot) arrives before `subscribe`
returns, then every event the server publishes to that topic. Cancel it to stop.

```ts
const subscription = await client.subscribe('room', { room: 'lobby' }, event => console.log(event))
subscription.cancel()
```

```swift
struct Room: Encodable, Sendable { var room: String }

let subscription = try await client.subscribe("room", Room(room: "lobby")) { event in
  print(try? event.decode(String.self) as Any) // event.isSnapshot is true for the first one
}
subscription.cancel()
```

```go
sub, err := conn.Subscribe("room", map[string]any{"room": "lobby"}, func(event any) {
	fmt.Println(event)
})
if err == nil {
	sub.Cancel()
}
```

```py
subscription = await client.subscribe("room", {"room": "lobby"}, lambda event: print(event))
subscription.cancel()
```

```rs
use channel_rs::SubscribeResult;
use serde_json::{json, Value};

if let SubscribeResult::Ok(mut subscription) =
    client.subscribe::<Value, Value, (), _>("room", json!({"room": "lobby"}), (), |event| println!("{event}"))?
{
    subscription.cancel();
}
```

```kotlin
val result = client.subscribe<Any?>("room", mapOf("room" to "lobby")) { event -> println(event) }
if (result is SubscribeResult.Ok) result.handle.cancel()
```

```java
var subscription = client.sender().subscribe(Object.class, "room", Map.of("room", "lobby"), event -> System.out.println(event));
if (subscription.isOk()) subscription.handle().cancel();
```

```cs
var subscription = await client.SubscribeAsync("room", new { room = "lobby" }, e => Console.WriteLine(e));
subscription.Cancel();
```

```dart
final subscription = await client.subscribe('room', body: {'room': 'lobby'}, onEvent: (event) => print(event));
subscription.cancel();
```

```php
$subscription = $client->subscribe('room', ['room' => 'lobby'], static function (mixed $event): void {
    var_dump($event);
});
$subscription->cancel();
```

```rb
subscription = client.subscribe('room', { 'room' => 'lobby' }) { |event| p event }
subscription.cancel
```

```ex
{:ok, subscription} =
  ChannelEx.ClientSender.subscribe(client, "room", %{room: "lobby"}, fn event -> IO.inspect(event) end)

subscription.cancel.()
```

```c
static void on_room(const char *body_json, void *user_data) {
  (void)user_data;
  printf("%s\n", body_json);
}

channel_c_subscription_handle_t *subscription = NULL;
channel_c_sender_subscribe(channel_c_client_sender(client), "room", "{\"room\":\"lobby\"}", NULL, on_room, NULL,
                           &subscription, &error);
channel_c_subscription_cancel(subscription);
```

```zig
const Room = struct { room: []const u8 };

fn onRoom(_: ?*anyopaque, event: []const u8) void {
    std.debug.print("{s}\n", .{event});
}

var subscription = try client.subscribe(allocator, Room, []const u8, void, "room", .{ .room = "lobby" }, {}, null, onRoom);
defer subscription.deinit(allocator);
switch (subscription) {
    .ok => |*handle| handle.cancel(),
    .remote_err => |message| std.debug.print("error: {s}\n", .{message}),
}
```

## Errors

A failed call throws a `ChannelError` with the message, and the `code` and `info` the server sent. The library's own
codes are `not_found` (no handler for the path), `cancelled`, `rate_limited`, and on the client `timeout` and
`disconnected`.

```ts
import { ChannelError } from 'channel/client'

try {
  await client.send('admin')
} catch (error) {
  if (error instanceof ChannelError && error.code === 401) login()
  String(error) // the message: "authorization required"
}
```

```swift
do {
  let _: String = try await client.send("admin")
} catch let error as ChannelError {
  if error.code == 401 { login() } // error.text is the message, error.info any JSON
}
```

```go
if _, err := conn.Send("admin", nil); err != nil && err.Error() == "authorization required" {
	login()
}
```

```py
from channel_py import ChannelError

try:
    await client.send("admin")
except ChannelError as error:
    if str(error) == "authorization required":
        await login()
```

```rs
match client.send::<String, _>("admin", ())? {
    CallResult::Ok(answer) => println!("{answer:?}"),
    CallResult::RemoteErr(message) if message == "authorization required" => login(),
    CallResult::RemoteErr(message) => eprintln!("{message}"),
}
```

```kotlin
when (val result = client.send<String>("admin")) {
  is CallResult.RemoteErr -> if (result.error == "authorization required") login()
  is CallResult.Ok -> println(result.value)
}
```

```java
var result = client.sender().send(String.class, "admin");
if (!result.isOk() && result.remoteErr().equals("authorization required")) login();
```

```cs
try { await client.SendAsync<string>("admin"); }
catch (ChannelException e) when (e.Message == "authorization required") { Login(); }
```

```dart
try {
  await client.send('admin');
} catch (error) {
  if (error == 'authorization required') login(); // the message itself is thrown
}
```

```php
try {
    $client->send('admin');
} catch (\ChannelPhp\ChannelException $error) {
    if ($error->getMessage() === 'authorization required') {
        login();
    }
}
```

```rb
begin
  client.send('admin')
rescue ChannelRB::ChannelError => e
  login if e.message == 'authorization required'
end
```

```ex
case ChannelEx.send(client, "admin") do
  {:ok, answer} -> answer
  {:error, "authorization required"} -> login()
  {:error, other} -> raise inspect(other)
end
```

```c
if (channel_c_sender_send(channel_c_client_sender(client), "admin", NULL, NULL, &body, &error) != 0) {
  if (error && strcmp(error, "authorization required") == 0) login();
  channel_c_free(error);
}
```

```zig
var answer = try client.send(allocator, []const u8, "admin", {});
defer answer.deinit(allocator);
switch (answer) {
    .ok => |name| std.debug.print("{s}\n", .{name.?}),
    .remote_err => |message| if (std.mem.eql(u8, message, "authorization required")) login(),
}
```

Only the TypeScript and Swift clients read `code` and `info`. The other ports give the message alone, so they compare
it, and their `timeout` and `disconnected` failures are messages too.

## Call options

Per call: a timeout in seconds, after which the call fails with `timeout` and is cancelled on the server, and whether
to send the call again after a reconnect (`replay`, on by default; off, the call fails with `disconnected` instead).

```ts
await client.send('payments/charge', order, { timeout: 30, replay: false })
```

```swift
let receipt: Receipt = try await client.send("payments/charge", order, options: SendOptions(timeout: 30, replay: false))
```

The other ports have no per-call options. C# cancels a call with a `CancellationToken`, Elixir takes a timeout in
milliseconds after the context (`ChannelEx.send(client, path, body, nil, 30_000)`), and the Rust and Kotlin clients
take one timeout for every call of the connection.

## Connect options

Headers go with every connection attempt. Where they come from a function, it runs before each attempt, so a token
can be refreshed; in Rust, Kotlin, Java, Elixir, C and Zig they are fixed when you connect. Browsers send them as
query parameters. TypeScript and Swift also take `requestTimeout`, the default timeout of every call.

```ts
const client = new Channel().connect('wss://example.com', {
  headers: async () => ({ authorization: await token() }),
  requestTimeout: 10,
})
```

```swift
let client = Channel<Void>().connect(URL(string: "wss://example.com")!, options: ClientOptions(
  headers: { ["authorization": await token()] },
  requestTimeout: 10
))
```

```go
conn := client.Connect(channelgo.NewChannel(), "ws://example.com", client.Options{
	Headers: func() map[string]string { return map[string]string{"authorization": token()} },
})
```

```py
async def headers():
    return {"authorization": await token()}

client = Channel().connect("wss://example.com", {"headers": headers})
```

```rs
let mut client = Channel::<State>::new().connect("ws://example.com:80", ConnectOptions {
    headers: Some(format!("authorization: {}\r\n", token())), // raw header lines, fixed at connect
    timeout: Some(Duration::from_secs(10)),
    ..ConnectOptions::default()
})?;
```

```kotlin
val client = Channel<MutableMap<String, Any?>>()
  .requestTimeout(10_000) // milliseconds
  .connect("ws://example.com", ConnectOptions(headers = "authorization: ${token()}\r\n"))
```

```java
var client = new Channel<Void>().connect("ws://example.com",
    new ConnectOptions<Void>(null, Map.of("authorization", token())));
```

```cs
var client = new Channel<Dictionary<string, object?>>().Connect("wss://example.com", new ClientOptions<Dictionary<string, object?>>
{
    Headers = async () => new Dictionary<string, string> { ["authorization"] = await Token() },
});
```

```dart
final client = Channel<Object?>().connect('wss://example.com',
    options: ClientOptions(headers: () async => {'authorization': await token()}));
```

```php
$client = (new Channel())->connect('wss://example.com', [
    'headers' => static fn (): array => ['authorization' => token()],
]);
```

```rb
client = ChannelRB::Channel.new.connect('wss://example.com', headers: -> { { 'authorization' => token } })
```

```ex
client =
  ChannelEx.connect(ChannelEx.new(), "ws://example.com:8080",
    headers: fn -> %{"authorization" => token()} end
  )
```

```c
channel_c_header_t headers[] = { { "authorization", token } }; /* copied at connect */
channel_c_client_options_t options = { .headers = headers, .header_count = 1 };
channel_c_client_t *client = channel_c_client_connect_with_options(ch, "wss://example.com", &options, &error);
```

```zig
var client = try ch.connect(allocator, "ws://example.com:8080", .{
    .headers = "authorization: Bearer token\r\n",
});
```

TypeScript's other options: `onConnect` (called on every connection, before the waiting calls are sent) and
`pingInterval` (seconds between pings, 15 by default, Bun only; without a pong within 10 s the client reconnects).

## Reconnect

The client reconnects by itself, backing off from 100 ms up to 5 s with jitter. Unanswered calls are sent again in
their original order, and active subscriptions subscribe again (their handler gets the new snapshot). Events published
while disconnected are lost. Not every port reconnects: [Languages](README.md#languages) says which.

```ts
// 'disconnected' | 'connecting' | 'connected', called with the current state first
const observer = client.onStateChange(state => console.log(state))
observer.cancel()

// Skip the backoff wait, for example on a network change or when the app comes to the foreground
client.reconnectNow()
```

```swift
let observer = client.onStateChange { state in print(state) } // .disconnected, .connecting, .connected
client.reconnectNow()
```

`stop()` stops reconnecting and fails every waiting call with `disconnected`.

The exact rules are in [wire v2](v2.md).
