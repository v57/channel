import { expect, test } from "bun:test"
import { Channel } from "./channel"
import { Subscription } from "./events"
import './client'
import './server'

const events = {
  hello: new Subscription()
}

async function sleep(seconds: number = 0.001) {
  await new Promise((resolve) => { setTimeout(resolve, seconds * 1000) })
}

interface State {
  name?: string
}

let valuesSent = 0
new Channel<State>()
  .post('hello', () => 'world')
  .post('mirror', async ({ sender }) => await sender.send('hello'))
  .post('echo', ({ body }) => body)
  .post('empty', () => { })
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
  .stream('stream/values', async function* () {
    for (let i = 0; i < 3; i += 1) {
      yield i
      await sleep()
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
      valuesSent += 1
      await sleep()
    }
  })
  .events(events)
  .listen(2049)

const client = new Channel()
  .post('hello', () => 'client world')
  .stream('stream/values', async function* () {
    for (let i = 0; i < 3; i += 1) {
      yield i
      await sleep()
    }
  })
  .stream('stream/cancel', async function* () {
    for (let i = 0; i < 10; i += 1) {
      yield i
      valuesSent += 1
      await sleep()
    }
  })
  .connect(2049)

test("post/hello", async () => {
  const response = await client.send('hello')
  expect(response).toBe('world')
})
test("post/echo", async () => {
  const random = Math.random()
  const response = await client.send('echo', random)
  expect(response).toBe(random)
})
test("post/noreturn", async () => {
  const response = await client.send('empty')
  expect(response).toBeUndefined()
})
test("events", async () => {
  events.hello.send('test', 'event 0')
  let count = 0
  await client.subscribe('hello', 'test', (event) => {
    count += 1
    expect(event).toContain('event ')
  })
  events.hello.send('test', 'event 1')
  events.hello.send('test', 'event 2')
  await sleep()
  expect(count).toBe(2)
})
test("events/cancel", async () => {
  events.hello.send('test', 'event 0')
  let count = 0
  const subscription = await client.subscribe('hello', 'test', (event) => {
    count += 1
    expect(event).toContain('event ')
  })
  events.hello.send('test', 'event 1')
  await sleep()
  subscription.cancel()
  await sleep()
  events.hello.send('test', 'event 2')
  await sleep()
  expect(count).toBe(1)
})
test("stream", async () => {
  let a = 0
  for await (const value of client.values('stream/values')) {
    expect(value).toBe(a)
    a += 1
  }
})
test("stream/cancel", async () => {
  let a = 0
  valuesSent = 0
  for await (const value of client.values('stream/cancel')) {
    expect(value).toBe(a)
    a += 1
    if (value === 2) break
  }
  expect(valuesSent).toBe(3)
})
test("server/post", async () => {
  const response = await client.send('mirror')
  expect(response).toBe('client world')
})
test("server/stream", async () => {
  let a = 0
  for await (const value of client.values('mirror/stream')) {
    expect(value).toBe(a)
    a += 1
  }
})
test("server/stream/cancel", async () => {
  let a = 0
  valuesSent = 0
  for await (const value of client.values('mirror/stream/cancel')) {
    expect(value).toBe(a)
    a += 1
    if (value === 2) break
  }
  expect(valuesSent).toBe(3)
})
test('state/auth', async () => {
  const client = new Channel()
    .connect(2049)
  await client.send('auth', { name: 'tester' })
  const name = await client.send('auth/name')
  expect(name).toBe('tester')
  client.stop()
})
test('state/unauthorized', async () => {
  const client = new Channel()
    .connect(2049)
  const response = client.send('auth/name')
  expect(response).rejects.toBe('unauthorized')
})
