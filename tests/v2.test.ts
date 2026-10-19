// Wire v2 interop cases (docs/v2.md), against the fixture in tests/server.ts
import { expect, test } from 'bun:test'
import { Channel, ChannelError, Subscription, errorResponse } from '../channel'
import '../client'
import '../process'
import { port, stats } from './server'

const address = `ws://127.0.0.1:${port}`

async function sleep(seconds: number = 0.001) {
  await new Promise(resolve => setTimeout(resolve, seconds * 1000))
}
async function failure(promise: Promise<any>): Promise<ChannelError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ChannelError)
    return error as ChannelError
  }
  throw new Error('expected a rejection')
}

test('errors are converted from thrown values', () => {
  expect(errorResponse(1, 'plain')).toEqual({ id: 1, error: 'plain' })
  expect(errorResponse(1, new Error('boom'))).toEqual({ id: 1, error: 'boom' })
  expect(errorResponse(1, { message: 'banned', code: 403, info: { a: 1 } })).toEqual({
    id: 1,
    error: 'banned',
    code: 403,
    info: { a: 1 },
  })
  expect(errorResponse(1, new ChannelError('x', 'y', false))).toEqual({ id: 1, error: 'x', code: 'y', info: false })
  expect(errorResponse(1, 42)).toEqual({ id: 1, error: '42' })
  expect(errorResponse(1, '')).toEqual({ id: 1, error: 'error' })
  expect(errorResponse(1, new Error())).toEqual({ id: 1, error: 'error' })
  // Codes are strings or integers, anything else is dropped
  expect(errorResponse(1, { message: 'm', code: 1.5 })).toEqual({ id: 1, error: 'm' })
})

test('1. structured errors carry message, code and info', async () => {
  const client = new Channel().connect(address)
  const banned = await failure(client.send('v2/error'))
  expect(banned.message).toBe('banned')
  expect(banned.code).toBe(403)
  expect(banned.info).toEqual({ remaining: 5 })
  expect(String(banned)).toBe('banned')
  expect(`${banned}`).toBe('banned')

  const slow = await failure(client.send('v2/error/code'))
  expect(slow.message).toBe('slow down')
  expect(slow.code).toBe('rate_limited')
  expect(slow.info).toEqual({ retryAfter: 1 })
  client.stop()
})

test('2. v1 string errors and library codes', async () => {
  const client = new Channel().connect(address)
  const unauthorized = await failure(client.send('auth/name'))
  expect(String(unauthorized)).toBe('unauthorized')
  expect(unauthorized.code).toBeUndefined()
  expect(unauthorized.info).toBeUndefined()

  const notFound = await failure(client.send('v2/missing'))
  expect(notFound.message).toBe('api not found')
  expect(notFound.code).toBe('not_found')

  const subNotFound = await failure(client.subscribe('v2/missing', undefined, () => {}))
  expect(subNotFound.message).toBe('subscription not found')
  expect(subNotFound.code).toBe('not_found')

  const streamNotFound = await failure(client.values('v2/missing').next())
  expect(streamNotFound.code).toBe('not_found')
  client.stop()
})

/** Closes the socket and waits until the client is connected again */
async function reconnect(client: ReturnType<Channel<any>['connect']>) {
  client.ws.ws?.close()
  await client.send('hello')
}

test('3. one-shot subscriptions are delivered once and not replayed', async () => {
  const client = new Channel().connect(address)
  const received: any[] = []
  const before = stats.once
  const subscription = await client.subscribe('v2/once', undefined, body => received.push(body))
  expect(received).toEqual(['once'])
  expect(stats.once).toBe(before + 1)
  await reconnect(client)
  await sleep(0.01)
  expect(received).toEqual(['once'])
  expect(stats.once).toBe(before + 1)
  subscription.cancel() // a no-op
  client.stop()
})

test('4. room snapshot, published events including falsy ones, and unsubscribe', async () => {
  const client = new Channel().connect(address)
  const received: any[] = []
  const subscription = await client.subscribe('v2/room', { room: 'four' }, body => received.push(body))
  expect(received).toEqual(['joined'])
  for (const body of [1, 0, false, '', null, { a: 1 }]) await client.send('v2/publish', { room: 'four', body })
  // undefined is never published
  await client.send('v2/publish', { room: 'four' })
  // other rooms don't arrive
  await client.send('v2/publish', { room: 'other', body: 'x' })
  await sleep(0.01)
  expect(received).toEqual(['joined', 1, 0, false, '', null, { a: 1 }])

  const rooms = stats.rooms
  subscription.cancel()
  await client.send('v2/publish', { room: 'four', body: 'after' })
  await reconnect(client)
  await client.send('v2/publish', { room: 'four', body: 'after reconnect' })
  await sleep(0.01)
  expect(received).toEqual(['joined', 1, 0, false, '', null, { a: 1 }])
  expect(stats.rooms).toBe(rooms)
  client.stop()
})

test('5. active subscriptions are resubscribed after a reconnect with a new snapshot', async () => {
  const client = new Channel().connect(address)
  const received: any[] = []
  await client.subscribe('v2/room', { room: 'five' }, body => received.push(body))
  const rooms = stats.rooms
  await reconnect(client)
  await sleep(0.01)
  expect(stats.rooms).toBe(rooms + 1)
  expect(received).toEqual(['joined', 'joined'])
  await client.send('v2/publish', { room: 'five', body: 'event' })
  await sleep(0.01)
  expect(received).toEqual(['joined', 'joined', 'event'])
  client.stop()
})

test('two subscriptions to one topic get their own snapshots and both get events', async () => {
  const client = new Channel().connect(address)
  const first: any[] = []
  const second: any[] = []
  const a = await client.subscribe('v2/room', { room: 'shared' }, body => first.push(body))
  const b = await client.subscribe('v2/room', { room: 'shared' }, body => second.push(body))
  await client.send('v2/publish', { room: 'shared', body: 1 })
  await sleep(0.01)
  expect(first).toEqual(['joined', 1])
  expect(second).toEqual(['joined', 1])
  // the topic stays joined while one of them is active
  a.cancel()
  await client.send('v2/publish', { room: 'shared', body: 2 })
  await sleep(0.01)
  expect(first).toEqual(['joined', 1])
  expect(second).toEqual(['joined', 1, 2])
  b.cancel()
  client.stop()
})

test('sub handlers can refuse with a structured error', async () => {
  const client = new Channel().connect(address)
  const refused = await failure(client.subscribe('v2/private', undefined, () => {}))
  expect(refused.message).toBe('unauthorized')
  expect(refused.code).toBe(401)
  await client.send('auth', { name: 'ann' })
  const received: any[] = []
  await client.subscribe('v2/private', undefined, body => received.push(body))
  expect(received).toEqual(['ann'])
  client.stop()
})

test('Subscription topic() and body() get the connection', async () => {
  const seen: any[] = []
  const subscription = new Subscription()
  subscription.topic((request, ctx) => {
    seen.push(ctx?.state.user)
    return `${request}`
  })
  subscription.body((request, ctx) => ctx?.context.extra)
  const ch = new Channel<{ user: string }>().events({ news: subscription })
  const sender = new Channel().process()
  const responses: any[] = []
  ch.receive(
    { id: 1, sub: 'news', body: 'today', context: { extra: 'x' } },
    {
      response: r => responses.push(r),
      subscribe() {},
      unsubscribe() {},
      event() {},
      sender,
      state: { user: 'ann' },
    },
  )
  expect(seen).toEqual(['ann'])
  expect(responses).toEqual([{ id: 1, topic: 'news/today', body: 'x' }])
})

test('falsy Subscription events are published, undefined is not', async () => {
  const subscription = new Subscription()
  const events: any[] = []
  subscription.publishers.push({ publish: event => events.push(event.body) })
  for (const body of [0, false, '', null, undefined]) subscription.publish('t', body)
  expect(events).toEqual([0, false, '', null])
})
