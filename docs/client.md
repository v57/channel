# Channel Client

Channel client is a websocket connection that allows to connect to channel server and use it's api

``` ts
import { Channel, ChannelError } from 'channel/client'
const channel = new Channel().connect(8080) // connects to localhost:8080
  // OR .connect('wss://yourserver.com', options)

// Simple request
let response = await channel.send('hello')
// Request with input values
response = await channel.send('some', 'value')

// Errors reject with ChannelError: message, and the optional code and info the server sent
try {
  await channel.send('admin')
} catch (error) {
  if (error instanceof ChannelError && error.code === 401) login()
  String(error) // the message, like the plain string errors of v1
}

// Per-request options
await channel.send('payments/charge', order, {
  timeout: 30, // seconds, then fails with code 'timeout' (and cancels it on the server)
  replay: false, // fails with code 'disconnected' instead of being sent again after a reconnect
})

// Subscribe to events. The server's snapshot arrives first, before subscribe() resolves.
const userId = 12
const subscription = await channel.subscribe('user/name', userId, (event) => {
  console.log(event)
  // Process your event
})
// Cancelling subscription
subscription.cancel()

// Read stream
for await (const value of channel.values('llm/send', 'Hello')) {
  console.log(value)
  // You can also cancel stream at any time when you've got what you need
  if (value === 'End') break // This will cancel operation on server
}

// Stops reconnecting and fails every pending call with code 'disconnected'
channel.stop()
```

## Connect options

``` ts
const channel = new Channel().connect('wss://example.com', {
  // Evaluated before every connection attempt, can be async. Bun sends them as headers, browsers as query parameters.
  headers: async () => ({ authorization: await token() }),
  // Called on every connection, before the pending requests are sent
  onConnect: async sender => {},
  // Default timeout for every post and subscription response, in seconds. None by default.
  requestTimeout: 10,
  // Seconds between pings (Bun only), 0 disables them. Without a pong within 10 s the client reconnects.
  pingInterval: 15,
})
```

## Reconnect

The client reconnects by itself, backing off from 100 ms up to 5 s with jitter. Unanswered requests are sent again
in their original order, and active subscriptions subscribe again (their handler gets the new snapshot). Events
published while disconnected are lost.

``` ts
// Connection state: 'disconnected' | 'connecting' | 'connected'
const observer = channel.onStateChange(state => console.log(state)) // called with the current state first
observer.cancel()
channel.state

// Skip the backoff wait, for example on network changes or when the app comes to the foreground
channel.reconnectNow()
```

See [v2.md](v2.md) for the exact rules.
