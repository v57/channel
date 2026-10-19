import { Channel, Subscription, type Cancellable } from '../channel'
import '../server'
import { rateLimit } from '../middleware'

export const events = {
  hello: new Subscription(),
}

interface State {
  name?: string
  /** Connection number */
  id: number
  /** The headers the connection was opened with */
  headers: Record<string, string | undefined>
}
let connections = 0

/** 2049, or `CHANNEL_TEST_PORT` when another fixture already runs there */
export const port = Number(process.env.CHANNEL_TEST_PORT ?? 2049)

export let stats = {
  mirrorEvents: 0,
  streamCancel: 0,
  /** Calls of the v2 subscription handlers, to check what reconnects resubscribe */
  rooms: 0,
  once: 0,
}
export const channel = new Channel<State>()
  // 2 calls per second per connection
  .use(rateLimit({ key: ctx => `${ctx.state.id}`, limit: 2, window: 1, paths: path => path === 'v2/rate' }))
  // Simple api that will return 'world' string
  .post('hello', () => 'world')
  // Returns whatever client have on it's 'hello' api
  .post('mirror', async ({ sender }) => await sender.send('hello'))
  // Returns body that client sends
  .post('echo', ({ body }) => body)
  // Returns undefined
  .post('empty', () => {})
  // Answers after a delay, for reconnect tests
  .post('slow', async () => {
    await sleep(0.05)
    return 'slow'
  })
  // Disconnects the client
  .post('disconnect', ({ sender }) => {
    sender.stop()
  })
  // Sets client name to provided one
  .post('auth', ({ body: { name }, state }) => {
    state.name = name
    return name
  })
  // Returns client name that he stored using 'auth' call
  // Throws when sender doesn't set a name
  // Each connection has its own state
  .post('auth/name', ({ state }) => {
    if (state.name) {
      return state.name
    } else {
      throw 'unauthorized'
    }
  })
  // Sends 3 events with 0, 1, 2 numbers after some delay
  // When client uses `break` in the loop, it will send the cancel request and this async function* will automatically close itself (yield will work like return)
  // Good for llm progressive response
  .stream('stream/values', async function* () {
    for (let i = 0; i < 3; i += 1) {
      yield i
      await sleep()
    }
  })
  // Sends whatever client have on it's 'names' subscription
  .post('mirror/events', async ({ sender }) => {
    let sub: Cancellable | undefined
    sub = await sender.subscribe('names', '1', event => {
      stats.mirrorEvents += 1
      sub?.cancel()
    })
  })
  // Sends whatever client have on it's 'names' stream api
  .stream('mirror/stream', async function* ({ sender }) {
    for await (const value of sender.values('stream/values')) {
      yield value
    }
  })
  // For stream cancellation tests
  .stream('stream/cancel', async function* () {
    for (let i = 0; i < 10; i += 1) {
      yield i
      stats.streamCancel += 1
      await sleep()
    }
  })
  // Api for mirror cancellation tests
  .stream('mirror/stream/cancel', async function* ({ sender }) {
    for await (const value of sender.values('stream/cancel')) yield value
  })
  // Wire v2 (docs/v2.md), the routes every port's interop tests use
  // Structured errors: message, code and info
  .post('v2/error', () => {
    throw { message: 'banned', code: 403, info: { remaining: 5 } }
  })
  .post('v2/error/code', () => {
    throw { message: 'slow down', code: 'rate_limited', info: { retryAfter: 1 } }
  })
  .post('v2/rate', () => 'ok')
  // Subscriptions with dynamic topics: { room } joins 'room/<room>', with 'joined' as the snapshot
  .sub('v2/room', ({ body }) => {
    stats.rooms += 1
    return { topic: 'room/' + body.room, body: 'joined' }
  })
  // { room, body } sends body to everyone in the room
  .post('v2/publish', ({ body }) => {
    channel.publish('room/' + body.room, body.body)
    return null
  })
  // One-shot: a snapshot without a topic
  .sub('v2/once', () => {
    stats.once += 1
    return { body: 'once' }
  })
  // Refused until 'auth' sets a name
  .sub('v2/private', ({ state }) => {
    if (!state.name) throw { message: 'unauthorized', code: 401 }
    return { topic: 'private/' + state.name, body: state.name }
  })
  // Sets the events
  .events(events)
  // Adds api from another Channel (State type should be the same)
  .merge(
    new Channel<State>().api({ hello: () => 'world', *stream() {} }).events({ never: new Subscription() }),
    'merged',
  )

// Listens to 127.0.0.1:2049
// can be replaced with 'ip:port' string
export const server = channel.listen(port, { state: headers => ({ id: ++connections, headers }) })

async function sleep(seconds: number = 0.001) {
  await new Promise(resolve => {
    setTimeout(resolve, seconds * 1000)
  })
}
