# Server

A server registers handlers by path and listens for connections. The protocol is symmetric, so a server can also
call its clients back over the same connection, and the same handlers can run inside one process without a network.

## Handlers

A post handler answers once. It gets the request's `body`, the connection's `state`, and the `sender` to call the
client back; it may be async. A stream handler yields values until it returns.

```ts
import { Channel } from 'channel/server'

const channel = new Channel()
  .post('hello', () => 'world')
  .post('add', ({ body: { a, b } }) => a + b)
  .stream('count', async function* () {
    for (let i = 0; i < 3; i += 1) yield i
  })
```

```swift
import ChannelServer

let router = ChannelRouter()
  .post("hello") { _ in "world" }
  .post("add") { call in .int((call.body?["a"]?.int ?? 0) + (call.body?["b"]?.int ?? 0)) }
  .stream("count") { stream in
    for i in 0..<3 { stream.send(.int(i)) }
    stream.finish()
  }
```

```go
ch := channelgo.NewChannel().
	Post("add", func(b channelgo.Body) (any, error) {
		m := b.Body.(map[string]any)
		return m["a"].(float64) + m["b"].(float64), nil
	}).
	Stream("count", func(_ channelgo.Body, emit channelgo.StreamEmitter) error {
		for i := 0; i < 3; i++ {
			if err := emit.Emit(i); err != nil {
				return err
			}
		}
		return nil
	})
```

```py
async def count(request):
    for i in range(3):
        yield i

channel = Channel().post("add", lambda request: request.body["a"] + request.body["b"]).stream("count", count)
```

```rs
use channel_rs::{Channel, PostRequest, StreamRequest};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Add { a: i64, b: i64 }

channel.post_value("add", |request: PostRequest<'_, State, Add, ()>| Ok(request.body.a + request.body.b))?;
channel.stream("count", |mut request: StreamRequest<'_, State, (), (), i64>| {
    for i in 0..3 {
        request.emitter.emit(i)?;
    }
    Ok(())
})?;
```

```kotlin
val channel = Channel<MutableMap<String, Any?>>()
  .post<Map<String, Any?>, Long, Unit>("add") { r -> (r.body["a"] as Number).toLong() + (r.body["b"] as Number).toLong() }
  .stream<Unit, Int, Unit>("count") { r -> for (i in 0 until 3) r.emitter.emit(i) }
```

```java
var channel = new Channel<Void>()
    .post("add", Map.class, Integer.class,
        r -> ((Number) r.body().get("a")).intValue() + ((Number) r.body().get("b")).intValue())
    .stream("count", Integer.class, r -> ChannelStreams.fromIterable(List.of(0, 1, 2)));
```

```cs
record Add(int A, int B);

static async IAsyncEnumerable<object?> Count()
{
    for (var i = 0; i < 3; i++) yield return i;
}

var channel = new Channel<Dictionary<string, object?>>()
    .Post("add", r => { var b = r.Body<Add>()!; return b.A + b.B; })
    .Stream("count", _ => Count());
```

```dart
final channel = Channel<Object?>()
  .post('add', (request) {
    final body = request.body as Map;
    return (body['a'] as num) + (body['b'] as num);
  })
  .stream('count', (_) async* {
    for (var i = 0; i < 3; i++) yield i;
  });
```

```php
$channel = (new Channel())
    ->post('add', static fn (array $request): int|float => $request['body']['a'] + $request['body']['b'])
    ->stream('count', static function (): \Generator {
        for ($i = 0; $i < 3; $i++) {
            yield $i;
        }
    });
```

```rb
channel = ChannelRB::Channel.new
  .post('add') { |request| request[:body]['a'] + request[:body]['b'] }
  .stream('count') { Enumerator.new { |y| 3.times { |i| y << i } } }
```

```ex
channel =
  ChannelEx.new()
  |> ChannelEx.post("add", fn %{body: %{"a" => a, "b" => b}} -> a + b end)
  |> ChannelEx.stream("count", fn _ -> 0..2 end)
```

```c
static int add(const channel_c_post_request_t *request, char **out_body_json, char **out_error) {
  yyjson_doc *doc = yyjson_read(request->body_json, strlen(request->body_json), 0);
  yyjson_val *root = yyjson_doc_get_root(doc);
  long long sum = yyjson_get_sint(yyjson_obj_get(root, "a")) + yyjson_get_sint(yyjson_obj_get(root, "b"));
  yyjson_doc_free(doc);
  char text[32];
  snprintf(text, sizeof text, "%lld", sum);
  *out_body_json = channel_c_strdup(text);
  (void)out_error;
  return 0;
}

static void count(const channel_c_stream_request_t *request) {
  char value[16];
  for (int i = 0; i < 3; i++) {
    if (channel_c_stream_is_cancelled(request->emitter)) return;
    snprintf(value, sizeof value, "%d", i);
    channel_c_stream_emit_json(request->emitter, value);
  }
}

channel_c_channel_post(ch, "add", add, NULL, 0);
channel_c_channel_stream(ch, "count", count, NULL);
```

```zig
const Add = struct { a: i64, b: i64 };

fn add(request: channel.PostRequest(State, Add, void)) !?i64 {
    return request.body.a + request.body.b;
}

fn count(request: channel.StreamRequest(State, void, void, i64)) !void {
    var i: i64 = 0;
    while (i < 3) : (i += 1) {
        if (request.emitter.isCancelled()) return;
        try request.emitter.emit(std.heap.page_allocator, i);
    }
}

_ = try ch.post("add", add);
_ = try ch.stream(void, i64, void, "count", count);
```

Ports differ in how a handler runs. Swift's `ChannelServer` handlers are synchronous and get untyped JSON on the
router's `DispatchQueue`. Elixir collects a stream's values before it sends them, so a stream can't be endless there.
Zig doesn't free what a handler returns: return static memory.

## Subscriptions and publish

A subscription handler picks the topic a client joins and returns the snapshot it gets first. Without a topic it is
one-shot: the client gets the snapshot and nothing more. `publish` sends an event to every connection subscribed to a
topic.

```ts
const channel = new Channel<{ user?: string }>()
  .sub('room', ({ body }) => ({ topic: `room/${body.room}`, body: 'joined' })) // topic to join, and the snapshot

channel.publish('room/lobby', { text: 'hi' })
```

```swift
router.sub("room") { call in
  guard let room = call.body?["room"]?.string else { throw ChannelFailure("room required") }
  return ("room/" + room, "joined") // (topic, snapshot); a nil topic is one-shot
}
router.publish("room/lobby", ["text": "hi"]) // on the router's queue
```

```go
room := channelgo.NewSubscription()
room.Topic(func(body any) string { return fmt.Sprint(body.(map[string]any)["room"]) })
room.BodyFn(func(any) (any, error) { return "joined", nil })
ch.Events(map[string]*channelgo.Subscription{"room": room})

room.Publish("lobby", map[string]any{"text": "hi"}) // topic "room/lobby"
```

```py
from channel_py import Channel, Subscription

room = Subscription()
room.topic(lambda body: body["room"])
room.body(lambda body: "joined")
channel = Channel().events({"room": room})

room.publish("lobby", {"text": "hi"})  # topic "room/lobby"
```

```rs
use channel_rs::Subscription;
use serde_json::{json, Value};

#[derive(Serialize, Deserialize)]
struct Room { room: String }

let room = Subscription::<Room, Value>::new();
room.topic(|body: &Room| body.room.clone());
room.body(|_| Some(json!("joined")));
channel.events([(String::from("room"), room.clone())], "")?;

room.publish("lobby", json!({"text": "hi"}))?; // topic "room/lobby"
```

```kotlin
val room = Subscription<Map<String, Any?>, Map<String, Any?>>().topic { body -> body["room"].toString() }
val server = Channel<MutableMap<String, Any?>>().events(mapOf("room" to room)).listen(8080)

room.send(mapOf("room" to "lobby"), mapOf("text" to "hi")) // topic "room/lobby"
```

```java
var room = new Subscription<Map, Object>(TypeRef.of(Map.class), TypeRef.of(Object.class),
    body -> String.valueOf(body.get("room")), body -> "joined");
var server = new Channel<Void>().events(Map.of("room", room)).listen(8080);

room.send("lobby", Map.of("text", "hi")); // topic "room/lobby"
```

```cs
var room = new Subscription()
    .Topic(body => ((JsonElement)body!).GetProperty("room").GetString()!)
    .Body(_ => "joined");
var server = new Channel<Dictionary<string, object?>>()
    .Events(new Dictionary<string, Subscription> { ["room"] = room })
    .Listen(8080);

room.Publish("lobby", new { text = "hi" }); // topic "room/lobby"
```

```dart
final room = Subscription()
  ..topic((body) => (body as Map)['room'] as String)
  ..body((_) => 'joined');
final channel = Channel<Object?>()..events({'room': room});

room.publish('lobby', {'text': 'hi'}); // topic "room/lobby"
```

```php
$room = new Subscription();
$room->topic(static fn (mixed $body): string => $body['room']);
$room->body(static fn (mixed $_): string => 'joined');
$channel = (new Channel())
    ->post('say', static function (array $request) use ($room): string {
        $room->publish('lobby', ['text' => 'hi']); // topic "room/lobby", from the server process
        return 'ok';
    })
    ->events(['room' => $room]);
```

```rb
room = ChannelRB::Subscription.new.topic { |body| body['room'] }.body { 'joined' }
channel = ChannelRB::Channel.new.events('room' => room)

room.publish('lobby', { 'text' => 'hi' }) # topic "room/lobby"
```

```ex
room =
  ChannelEx.Subscription.new()
  |> ChannelEx.Subscription.topic(fn %{"room" => room} -> room end)
  |> ChannelEx.Subscription.body(fn _ -> "joined" end)

channel = ChannelEx.new() |> ChannelEx.events(%{room: room})

ChannelEx.Subscription.publish(room, "lobby", %{text: "hi"}) # topic "room/lobby"
```

```c
static int room(const channel_c_subscription_request_t *request, char **out_topic, char **out_body_json,
                char **out_error) {
  yyjson_doc *doc = yyjson_read(request->request_body_json, strlen(request->request_body_json), 0);
  *out_topic = channel_c_strdup(yyjson_get_str(yyjson_obj_get(yyjson_doc_get_root(doc), "room")));
  yyjson_doc_free(doc);
  *out_body_json = channel_c_strdup("\"joined\"");
  (void)out_error;
  return 0;
}

channel_c_channel_subscription(ch, "room", room, NULL); /* topic "room/" + out_topic */
/* publishes to the topic this subscribe body resolves to: "room/lobby" */
channel_c_channel_event_send(ch, "room", "{\"room\":\"lobby\"}", "{\"text\":\"hi\"}", &error);
```

```zig
const Room = struct { room: []const u8 };
const Msg = struct { text: []const u8 };

fn roomTopic(_: std.mem.Allocator, request: Room) ![]const u8 {
    return request.room;
}
fn roomBody(_: std.mem.Allocator, _: Room) !?Msg {
    return .{ .text = "joined" };
}

var events = .{ .room = channel.Subscription(Room, Msg).init() };
defer events.room.deinit();
_ = events.room.topic(roomTopic).body(roomBody);
_ = try ch.events(&events, ""); // topic "room/" + roomTopic(...)

// publishes to the topic this subscribe body resolves to: "room/lobby"
try events.room.send(allocator, .{ .room = "lobby" }, .{ .text = "hi" });
```

TypeScript and Swift take a handler per subscription path that returns the topic and the snapshot. The other ports
declare a subscription object instead, registered with `events` under a name: its topic function returns the part
after the name (`lobby` for `room/lobby`), its body function the snapshot, and it publishes itself. Register it before
`listen`. A PHP server runs in a child process, so it publishes from a handler; C, Zig, Kotlin and Java publish with a
subscribe body, which picks the topic, rather than a topic string.

## Errors

Throw from a handler to fail the call. A string becomes the message; an object or error with `message` also passes
its `code` (a string or an integer) and `info` (any JSON) to the client.

```ts
.post('admin', ({ state }) => {
  if (!state.userId) throw { message: 'authorization required', code: 401 }
  return 'welcome'
})
```

```swift
router.post("admin") { call in
  throw ChannelFailure("authorization required", code: 401)
}
```

```go
ch.Post("admin", func(b channelgo.Body) (any, error) {
	return nil, errors.New("authorization required")
})
```

```py
from channel_py import ChannelError

def admin(request):
    raise ChannelError("authorization required")

channel.post("admin", admin)
```

```rs
channel.post::<(), String, (), _>("admin", |_request: PostRequest<'_, State, (), ()>| {
    Err(ChannelError::new("authorization required"))
})?;
```

```kotlin
channel.post<Unit, String, Unit>("admin") { throw ChannelError("authorization required") }
```

```java
channel.post("admin", String.class, r -> { throw new ChannelException("authorization required"); });
```

```cs
channel.Post("admin", r => r.State.ContainsKey("userId") ? "welcome" : throw new ChannelException("authorization required"));
```

```dart
channel.post('admin', (_) => throw 'authorization required'); // an Exception would add "Exception: "
```

```php
$channel->post('admin', static function (array $request): never {
    throw new \RuntimeException('authorization required');
});
```

```rb
channel.post('admin') { raise ChannelRB::ChannelError, 'authorization required' }
```

```ex
ChannelEx.post(channel, "admin", fn _ -> raise "authorization required" end)
```

```c
static int admin(const channel_c_post_request_t *request, char **out_body_json, char **out_error) {
  (void)request;
  (void)out_body_json;
  *out_error = channel_c_strdup("authorization required");
  return -1;
}
```

```zig
fn admin(_: channel.PostRequest(State, void, void)) !?[]const u8 {
    return error.AuthorizationRequired; // the client gets "AuthorizationRequired"
}
```

Only the TypeScript and Swift servers send a `code` and `info`; the others send the message. Zig sends the error's
name, so its messages are Zig error names.

A stream that fails after it started ends with that error. The error codes the library itself sends are listed in
[Client](client.md#errors).

## Middleware

Middleware runs in order before every incoming post, stream start and subscription. `logger` logs calls (and the slow
ones), and `rateLimit` allows `limit` calls per `window` seconds per key, failing the rest with `rate_limited` and
`info.retryAfter`.

```ts
import { logger, rateLimit } from 'channel/middleware'

const channel = new Channel<{ userId?: string }>()
  .use(logger({ slow: 100 })) // logs calls, and the ones slower than 100 ms
  .use(rateLimit({ key: ctx => ctx.state.userId, limit: 10, window: 1 }))
```

Middleware is in the TypeScript library only. Swift's `ChannelServer` has one hook, `router.check`, that runs before
every call and refuses it by throwing.

## Listen

`listen` takes the port and options. `state` builds the connection's state from the upgrade headers and query
parameters; throwing refuses the connection with 401. `path` limits the server to one URL path (others get 404).

```ts
channel.listen(8080, {
  state: async headers => ({ userId: await verify(headers.authorization) }),
  path: '/ws',
})
```

```swift
final class Session { let userId: String; init(userId: String) { self.userId = userId } }

router.listen(WebSocketServer(ListenAddress(port: 8080)), queue: queue, state: { request in
  guard request.path == "/ws", let token = request.channelHeaders["authorization"] else {
    throw ChannelFailure("unauthorized") // refuses the connection
  }
  return Session(userId: try verify(token))
}) { result in print("listening:", result) }
```

```go
srv, err := server.Listen(ch, 8080, server.Options{
	State: func(headers map[string]string) any {
		return map[string]any{"userId": verify(headers["authorization"])}
	},
})
```

```py
async def state(headers):
    return {"user_id": await verify(headers.get("authorization"))}

server = channel.listen(8080, {"state": state})
```

```rs
use std::rc::Rc;

let mut server = channel.listen(8080_u16, ListenOptions {
    state: Some(Rc::new(|headers| Ok(State { user_id: verify(headers.get("authorization"))? }))),
    ..ListenOptions::default()
})?;
```

```kotlin
val server = Channel<MutableMap<String, Any?>>().listen(
  8080,
  ListenOptions(state = { headers -> mutableMapOf<String, Any?>("userId" to verify(headers["authorization"])) }),
)
```

```java
var server = new Channel<Map<String, Object>>().listen(8080,
    new ListenOptions<Map<String, Object>>(headers -> Map.of("userId", verify(headers.get("authorization"))), null, null));
```

```cs
var server = new Channel<Dictionary<string, object?>>().Listen(8080, new ListenOptions<Dictionary<string, object?>>
{
    StateFactory = async headers => new Dictionary<string, object?>
    {
        ["userId"] = await Verify(headers.GetValueOrDefault("authorization")),
    },
});
```

```dart
await Channel<Map<String, Object?>>().listen(8080,
    options: ListenOptions(state: (headers) async => {'userId': await verify(headers['authorization'])}));
```

```php
$server = $channel->listen(8080, [
    'state' => static fn (array $headers): array => ['userId' => verify($headers['authorization'] ?? '')],
]);
```

```rb
channel.listen(8080, state: proc { |headers| { user_id: verify(headers['authorization']) } })
```

```ex
ChannelEx.listen(channel, 8080,
  state: fn headers -> %{user_id: verify(headers["authorization"])} end
)
```

```c
static void *make_state(const channel_c_headers_t *headers, void *user_data) {
  (void)user_data;
  return new_user_state(channel_c_headers_get(headers, "authorization")); /* yours */
}

channel_c_state_factory_t factory = { .create_with_headers = make_state, .destroy = free_user_state };
channel_c_server_t *server = channel_c_server_listen(ch, "127.0.0.1", 8080, factory, &error);
```

```zig
const State = struct { authorized: bool = false };

fn makeState(headers: *const std.StringHashMapUnmanaged([]const u8)) !State {
    return .{ .authorized = headers.get("authorization") != null };
}

var server = try ch.listen(allocator, 8080, .{ .state = makeState });
```

Header names arrive lowercased, with the query parameters merged in. `path` is TypeScript's only: the other servers
accept any path (Swift can check `request.path` itself).

TypeScript's other options: `maxPayload` (16 MiB by default), `idleTimeout` and `perMessageDeflate`.

## Calling the client back

The `sender` a handler gets calls the client that sent the request, with the same `send`, `values` and `subscribe` a
client has. The client answers with handlers of its own.

```ts
// server
channel.post('whoami', async ({ sender }) => await sender.send('app/version'))

// client: its own handlers answer the server
const client = new Channel().post('app/version', () => '1.0').connect(8080)
```

```swift
// server (ChannelServer: a callback, not async)
router.post("whoami", answering: { call in
  call.peer?.request("app/version") { result in call.finish(result.mapError { $0 as Error }) }
})

// client (ChannelSwift)
let client = Channel<Void>()
  .post("app/version") { "1.0" }
  .connect(8080)
```

```go
ch.Post("whoami", func(b channelgo.Body) (any, error) {
	return b.Sender.Send("app/version", nil)
})
```

```py
async def whoami(request):
    return await request.sender.send("app/version")

channel.post("whoami", whoami)
```

```rs
channel.post_value("whoami", |request: PostRequest<'_, State, (), ()>| {
    match request.sender.send::<String, _>("app/version", ())? {
        CallResult::Ok(version) => Ok(version),
        CallResult::RemoteErr(error) => Err(ChannelError::new(error)),
    }
})?;
```

```kotlin
channel.post<Unit, String, Unit>("whoami") { r ->
  (r.sender.send<String>("app/version") as CallResult.Ok).value
}
```

```java
channel.post("whoami", String.class, r -> r.sender().send(String.class, "app/version").requireValue());
```

```cs
ChannelPostHandler<Dictionary<string, object?>> whoami = async r => await r.Sender.SendAsync<string>("app/version");
channel.Post("whoami", whoami);
```

```dart
channel.post('whoami', (request) => request.sender.send<String>('app/version'));
```

```php
$channel->post('whoami', static fn (array $request): mixed => $request['sender']->send('app/version'));
```

```rb
channel.post('whoami') { |request| request[:sender].send('app/version') }
```

```ex
# A handler runs in the connection's process, so call the client from another process
ChannelEx.listen(channel, 8080,
  on_connect: fn %{sender: sender} ->
    spawn(fn -> IO.inspect(ChannelEx.send(sender, "app/version")) end)
  end
)
```

```zig
var version_buf: [64]u8 = undefined;

fn whoami(request: channel.PostRequest(State, void, void)) !?[]const u8 {
    var result = try request.sender.send(std.heap.page_allocator, []const u8, "app/version", {});
    defer result.deinit(std.heap.page_allocator);
    const text = switch (result) {
        .ok => |value| value orelse return null,
        .remote_err => return error.CallbackFailed,
    };
    const len = @min(text.len, version_buf.len);
    @memcpy(version_buf[0..len], text[0..len]);
    return version_buf[0..len]; // must outlive the call
}
```

## In-process

`process()` returns a sender that calls the channel's own handlers in the same process, without a connection: a way to
use one API from several parts of an app, and to test handlers.

```ts
import { Channel } from 'channel/process'

const sender = new Channel().post('hello', () => 'world').process()
await sender.send('hello') // "world"
```

```go
sender := process.Connect(channelgo.NewChannel().Post("hello", func(channelgo.Body) (any, error) {
	return "world", nil
}))
defer sender.Stop()
answer, _ := sender.Send("hello", nil)
```

```py
sender = Channel().post("hello", lambda _: "world").process()
print(await sender.send("hello"))
```

```rs
let mut channel = Channel::<State>::new();
channel.post_value("hello", |_request: PostRequest<'_, State, (), ()>| Ok("world"))?;
let mut sender = channel.process(State)?;
let answer = sender.send::<String, _>("hello", ())?; // CallResult::Ok(Some("world"))
```

```kotlin
val sender = Channel<MutableMap<String, Any?>>().post<Unit, String, Unit>("hello") { "world" }.process()
sender.send<String>("hello") // CallResult.Ok("world")
```

```java
// needs channel-java-process on the classpath
var sender = new Channel<Void>().post("hello", String.class, r -> "world").process(null).sender();
sender.send(String.class, "hello").requireValue(); // "world"
```

```cs
using ChannelCs.Process;

var sender = new Channel<Dictionary<string, object?>>().Post("hello", _ => "world").Process();
await sender.SendAsync<string>("hello"); // "world"
```

```dart
import 'package:channel_dart/process.dart';

final sender = Channel<Object?>().post('hello', (_) => 'world').process();
await sender.send('hello'); // "world"
```

```php
$sender = (new Channel())->post('hello', static fn (): string => 'world')->process();
$sender->send('hello'); // "world"
```

```rb
sender = ChannelRB::Channel.new.post('hello') { 'world' }.process
sender.send('hello') # "world"
```

```ex
sender =
  ChannelEx.new()
  |> ChannelEx.post("hello", fn _ -> "world" end)
  |> ChannelEx.process()

{:ok, "world"} = ChannelEx.send(sender, "hello")
```

```c
channel_c_channel_t *ch = channel_c_channel_new();
channel_c_channel_post(ch, "hello", hello, NULL, 0);
channel_c_process_t *process = channel_c_process_new(ch, NULL, NULL);
channel_c_sender_send(channel_c_process_sender(process), "hello", NULL, NULL, &body, &error); /* "\"world\"" */
channel_c_process_free(process);
```

```zig
var ch = channel.Channel(State).init(allocator);
defer ch.deinit();
_ = try ch.post("hello", hello);
var process = try ch.process(allocator, .{});
defer process.deinit();
var answer = try process.send(allocator, []const u8, "hello", {});
defer answer.deinit(allocator);
```

Swift has no in-process transport.
