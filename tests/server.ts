import { Channel, Subscription, type Cancellable } from '../channel'
import '../server'

export const events = {
  hello: new Subscription(),
}

interface State {
  name?: string
}

export let stats = {
  mirrorEvents: 0,
  streamCancel: 0,
}
export const server = new Channel<State>()
  // Simple api that will return 'world' string
  .post('hello', () => 'world')
  // Returns whatever client have on it's 'hello' api
  .post('mirror', async ({ sender }) => await sender.send('hello'))
  // Returns body that client sends
  .post('echo', ({ body }) => body)
  // Returns undefined
  .post('empty', () => {})
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
  // Sets the events
  .events(events)
  // Adds api from another Channel (State type should be the same)
  .merge(
    new Channel<State>().api({ hello: () => 'world', *stream() {} }).events({ never: new Subscription() }),
    'merged',
  )
  // Listens to 127.0.0.1:2049
  // can be replaced with 'ip:port' string
  .listen(2049)

async function sleep(seconds: number = 0.001) {
  await new Promise(resolve => {
    setTimeout(resolve, seconds * 1000)
  })
}
