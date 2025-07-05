import { Channel, Subscription, type Cancellable } from '../channel'
import '../server'

export const events = {
  hello: new Subscription(),
}

async function sleep(seconds: number = 0.001) {
  await new Promise(resolve => {
    setTimeout(resolve, seconds * 1000)
  })
}

interface State {
  name?: string
}

export let stats = {
  mirrorEvents: 0,
  streamCancel: 0,
}
export const server = new Channel<State>()
  .post('hello', () => 'world')
  .post('mirror', async ({ sender }) => await sender.send('hello'))
  .post('echo', ({ body }) => body)
  .post('empty', () => {})
  .post('disconnect', ({ sender }) => {
    sender.stop()
  })
  .post('auth', ({ body: { name }, state }) => {
    state.name = name
    return name
  })
  .post('auth/name', ({ state }) => {
    if (state.name) {
      return state.name
    } else {
      throw 'unauthorized'
    }
  })
  .post('mirror/events', async ({ sender }) => {
    let sub: Cancellable | undefined
    sub = await sender.subscribe('names', '1', event => {
      stats.mirrorEvents += 1
      sub?.cancel()
    })
  })
  .stream('stream/values', async function* () {
    for (let i = 0; i < 3; i += 1) {
      yield i
      await sleep()
    }
  })
  .stream('stream/sync', async function* () {
    for (let i = 0; i < 3; i += 1) {
      yield i
    }
  })
  .stream('mirror/stream', async function* ({ sender }) {
    for await (const value of sender.values('stream/values')) {
      yield value
    }
  })
  .stream('mirror/stream/cancel', async function* ({ sender }) {
    for await (const value of sender.values('stream/cancel')) {
      yield value
    }
  })
  .stream('stream/cancel', async function* () {
    for (let i = 0; i < 10; i += 1) {
      yield i
      stats.streamCancel += 1
      await sleep()
    }
  })
  .events(events)
  .merge(
    new Channel<State>()
      .api({
        hello: () => 'world',
        *stream() {},
      })
      .events({
        never: new Subscription(),
      }),
    'merged',
  )
  .listen(2049)
