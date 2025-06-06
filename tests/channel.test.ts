import { expect, test } from 'bun:test'
import { Channel, Subscription } from '../channel'
import '../client'
import { stats, server, events } from './server'

const clientEvents = {
  names: new Subscription(),
}

async function sleep(seconds: number = 0.001) {
  await new Promise(resolve => {
    setTimeout(resolve, seconds * 1000)
  })
}

let valuesSent = 0

const client = new Channel()
  .api({
    hello: () => 'client world',
    stream: {
      async *values() {
        for (let i = 0; i < 3; i += 1) {
          yield i
          await sleep()
        }
      },
      async *cancel() {
        for (let i = 0; i < 10; i += 1) {
          yield i
          valuesSent += 1
          await sleep()
        }
      },
    },
  })
  .events(clientEvents)
  .connect(2049)

test('post/hello', async () => {
  const response = await client.send('hello')
  expect(response).toBe('world')
})
test('post/echo', async () => {
  const random = Math.random()
  const response = await client.send('echo', random)
  expect(response).toBe(random)
})
test('post/noreturn', async () => {
  const response = await client.send('empty')
  expect(response).toBeUndefined()
})
test('post/notfound', async () => {
  const response = client.send('notfound')
  expect(response).rejects.toBe('api not found')
})
test('events', async () => {
  events.hello.send('test', 'event 0')
  let count = 0
  const subscription = await client.subscribe('hello', 'test', event => {
    count += 1
    expect(event).toContain('event ')
  })
  events.hello.send('test', 'event 1')
  events.hello.send('test', 'event 2')
  await sleep()
  expect(count).toBe(2)
  subscription.cancel()
})
test('events/cancel', async () => {
  events.hello.send('test', 'event 0')
  let count = 0
  const subscription = await client.subscribe('hello', 'test', event => {
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
test('events/notfound', async () => {
  try {
    await client.subscribe('notfound', 'test', event => {
      throw 'Should not be there'
    })
    await sleep()
  } catch (error) {
    expect(error).toBe('subscription not found')
  }
})
test('stream', async () => {
  let a = 0
  for await (const value of client.values('stream/values')) {
    expect(value).toBe(a)
    a += 1
  }
})
test('stream/cancel', async () => {
  let a = 0
  for await (const value of client.values('stream/cancel')) {
    expect(value).toBe(a)
    a += 1
    if (value === 2) break
  }
  expect(stats.streamCancel).toBe(3)
})
test('stream/notfound', async () => {
  const client = new Channel().connect(2049)
  const response = client.send('notfound')
  expect(response).rejects.toBe('api not found')
})
test('server/post', async () => {
  const response = await client.send('mirror')
  expect(response).toBe('client world')
})
test('server/subscribe', async () => {
  await client.send('mirror/events')
  await sleep()
  clientEvents.names.send('2', 'po')
  clientEvents.names.send('1', 'h')
  // server unsubscribes here, so next shouldn't be received
  await sleep()
  clientEvents.names.send('1', 'we')
  await sleep()
  expect(stats.mirrorEvents).toBe(1)
})
test('server/stream', async () => {
  let a = 0
  for await (const value of client.values('mirror/stream')) {
    expect(value).toBe(a)
    a += 1
  }
})
test('server/stream/cancel', async () => {
  let a = 0
  for await (const value of client.values('mirror/stream/cancel')) {
    expect(value).toBe(a)
    a += 1
    if (value === 2) break
  }
  expect(valuesSent).toBe(3)
})
test('state/auth', async () => {
  const client = new Channel().connect(2049)
  await client.send('auth', { name: 'tester' })
  const name = await client.send('auth/name')
  expect(name).toBe('tester')
  client.stop()
})
test('state/unauthorized', async () => {
  const client = new Channel().connect(2049)
  const response = client.send('auth/name')
  expect(response).rejects.toBe('unauthorized')
})
test('stopping', async () => {
  client.ws.throttle()
  client.send('disconnect')
  await sleep()
  server.stop()
})
