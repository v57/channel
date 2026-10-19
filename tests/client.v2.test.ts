// Client request options and connection behaviour (docs/v2.md), against the fixture in tests/server.ts
import { expect, test } from 'bun:test'
import { Channel, ChannelError } from '../channel'
import '../client'
import '../process'
import '../server'
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
async function until(predicate: () => boolean | Promise<boolean>, seconds = 2) {
  const end = Date.now() + seconds * 1000
  while (!(await predicate())) {
    if (Date.now() > end) throw new Error('timed out')
    await sleep(0.005)
  }
}

test('6. timeout fails with code timeout and cancels the request on the server', async () => {
  const client = new Channel().connect(address)
  await client.send('hello')
  const cancels = stats.cancels
  const started = Date.now()
  const error = await failure(client.send('v2/never', undefined, { timeout: 0.05 }))
  expect(error.message).toBe('timeout')
  expect(error.code).toBe('timeout')
  expect(Date.now() - started).toBeGreaterThanOrEqual(45)
  await until(() => stats.cancels === cancels + 1)
  // Not replayed after a reconnect
  client.ws.ws?.close()
  await client.send('hello')
  await sleep(0.01)
  expect(stats.cancels).toBe(cancels + 1)
  client.stop()
})

test('requestTimeout is the default for posts and subscriptions, options override it', async () => {
  const client = new Channel().connect(address, { requestTimeout: 0.03 })
  expect((await failure(client.send('v2/never'))).code).toBe('timeout')
  expect((await failure(client.request('v2/never').response)).code).toBe('timeout')
  expect(await client.send('hello')).toBe('world')
  // A longer timeout for one call
  const slow = client.send('v2/never', undefined, { timeout: 0.1 })
  await sleep(0.05)
  expect(Bun.peek.status(slow)).toBe('pending')
  expect((await failure(slow)).code).toBe('timeout')
  client.stop()
})

test('timeout on a subscription response', async () => {
  const server = new Channel().sub('slow', () => new Promise(() => {})).listen(0)
  const client = new Channel().connect(`ws://127.0.0.1:${server.port}`)
  const error = await failure(client.subscribe('slow', undefined, () => {}, { timeout: 0.03 }))
  expect(error.code).toBe('timeout')
  expect(client.ws.pending.size).toBe(0)
  client.stop()
  server.stop(true)
})

test('timeout while offline drops the request without sending it', async () => {
  let calls = 0
  const server = new Channel().post('count', () => ++calls).listen(0)
  const client = new Channel().connect(`ws://127.0.0.1:${server.port + 1}`)
  const error = await failure(client.send('count', undefined, { timeout: 0.02 }))
  expect(error.code).toBe('timeout')
  expect(client.ws.pending.size).toBe(0)
  client.stop()
  server.stop(true)
})

test('timeouts work in process', async () => {
  const sender = new Channel().post('never', () => new Promise(() => {})).post('now', () => 1).process()
  expect((await failure(sender.send('never', undefined, { timeout: 0.01 }))).code).toBe('timeout')
  expect(await sender.send('now', undefined, { timeout: 0.01 })).toBe(1)
})

test('7. replay: false fails with disconnected, default replay sends it again', async () => {
  const client = new Channel().connect(address)
  await client.send('v2/drops/reset')
  const error = await failure(client.send('v2/drop', undefined, { replay: false }))
  expect(error.message).toBe('disconnected')
  expect(error.code).toBe('disconnected')
  expect(await client.send('v2/drops')).toBe(1)

  // With replay, every reconnect sends it again and the server drops the connection again. Stopping the client
  // ends that after the 2nd drop.
  const observer = new Channel().connect(address)
  const dropping = client.send('v2/drop')
  await until(async () => (await observer.send('v2/drops')) >= 2)
  client.stop()
  expect((await failure(dropping)).code).toBe('disconnected')
  observer.stop()
})

test('replay: false requests queued while offline are still sent once connected', async () => {
  const client = new Channel().connect(address)
  const response = client.send('echo', 'queued', { replay: false })
  expect(await response).toBe('queued')
  client.stop()
})

test('pending requests are replayed in their original order', async () => {
  const received: any[] = []
  const server = new Channel()
    .post('hold', ({ body }) => {
      received.push(body)
      return new Promise(() => {})
    })
    .sub('room', ({ body }) => {
      received.push(`sub ${body}`)
      return { topic: 'room', body }
    })
    .listen(0)
  const client = new Channel().connect(`ws://127.0.0.1:${server.port}`)
  const ignore = () => {}
  client.send('hold', 0).catch(ignore)
  await client.subscribe('room', 1, () => {})
  client.send('hold', 2).catch(ignore)
  client.send('hold', 3).catch(ignore)
  await until(() => received.length === 4)
  client.ws.ws?.close()
  client.send('hold', 4).catch(ignore)
  await until(() => received.length === 9)
  expect(received).toEqual([0, 'sub 1', 2, 3, 0, 'sub 1', 2, 3, 4])
  client.stop()
  server.stop(true)
})

test('10. stop() fails pending calls with disconnected', async () => {
  const client = new Channel().connect(address)
  await client.send('hello')
  const post = client.send('v2/never')
  const request = client.request('v2/never').response
  const values = client.values('stream/cancel')
  expect(await values.next()).toEqual({ value: 0, done: false })
  const next = values.next()
  client.stop()
  expect((await failure(post)).code).toBe('disconnected')
  expect((await failure(request)).code).toBe('disconnected')
  expect((await failure(next)).code).toBe('disconnected')
})

test('stop() while offline fails queued calls', async () => {
  const client = new Channel().connect(`ws://127.0.0.1:1`)
  const post = client.send('hello')
  const sub = client.subscribe('v2/room', { room: 'x' }, () => {})
  client.stop()
  expect((await failure(post)).code).toBe('disconnected')
  expect((await failure(sub)).code).toBe('disconnected')
})
