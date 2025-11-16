# Channel Client

Channel client is a websocket connection that allows to connect to channel server and use it's api

``` ts
import { Channel } from 'channel/client'
const channel = new Channel().connect(8080) // connects to localhost:8080
  // OR .connect('wss://yourserver.com')

// Simple request
let response = await channel.send('hello')
// Request with input values
response = await channel.send('some', 'value')

// Subscribe to events
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

// Cancel stream manually
const values = channel.values('llm/send', 'Hello')
for await (const value of channel.values('llm/send', 'Hello')) {
  console.log(value)
}
```
