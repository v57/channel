import { afterAll, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { connect } from 'node:quic'
import { Channel, Subscription } from '../channel'
import { FrameReader, encodeFrame, maxFrame, type QuicServer } from '../quic'

const key = readFileSync(`${import.meta.dir}/quic/key.pem`)
const cert = readFileSync(`${import.meta.dir}/quic/cert.pem`)
const fingerprint = 'DD:D2:37:00:BD:8A:BD:29:14:15:D8:65:84:BE:C2:80:10:FF:21:DA:A1:C5:9D:B3:4A:7F:36:63:EF:4B:55:9B'
const quic = { ca: cert }

async function sleep(ms = 10) {
  await new Promise(resolve => setTimeout(resolve, ms))
}
async function waitFor(predicate: () => boolean, ms = 3000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(5)) if (predicate()) return
  throw new Error('timed out')
}

const events = { hello: new Subscription() }
const clientEvents = { names: new Subscription() }
const stats = { connected: 0, disconnected: 0, streamCancel: 0, disconnect: false }
const server = new Channel<{ name?: string }>()
  .post('hello', () => 'world')
  .post('echo', ({ body }) => body)
  .post('name', ({ state }) => state.name)
  .post('mirror', async ({ sender }) => await sender.send('hello'))
  .post('mirror/events', async ({ sender }) => {
    const { promise, resolve } = Promise.withResolvers()
    const subscription = await sender.subscribe('names', '1', resolve)
    clientEvents.names.send('1', 'name')
    const name = await promise
    subscription.cancel()
    return name
  })
  .post('mirror/stream', async ({ sender }) => {
    for await (const value of sender.values('count')) return value
  })
  .post('disconnect', ({ sender }) => {
    // Once: the client replays unanswered requests after reconnecting
    if (stats.disconnect) return
    stats.disconnect = true
    sender.stop()
  })
  .stream('values', async function* () {
    for (let i = 0; i < 3; i += 1) yield i
  })
  .stream('cancel', async function* () {
    for (let i = 0; i < 10; i += 1) {
      yield i
      stats.streamCancel += 1
      await sleep(1)
    }
  })
  .events(events)
let listener: QuicServer
const ready = server
  .listenQuic('127.0.0.1:0', {
    key,
    cert,
    state: headers => {
      if (headers['reject']) throw 'rejected'
      return { name: headers['name'] }
    },
    onConnect: () => (stats.connected += 1),
    onDisconnect: () => (stats.disconnected += 1),
  })
  .then(value => (listener = value))
const address = async () => `quic://127.0.0.1:${(await ready).port}`

const clients: { ws: { stop(): void } }[] = []
async function client(options: Parameters<Channel<any>['connect']>[1] = { quic }) {
  const client = new Channel()
    .post('hello', () => 'client world')
    .stream('count', async function* () {
      for (let i = 0; i < 100; i += 1) {
        yield i
        await sleep(1)
      }
    })
    .events(clientEvents)
    .connect(await address(), options)
  clients.push(client)
  return client
}
afterAll(async () => {
  clients.forEach(client => client.ws.stop())
  await listener?.stop()
})

test('frames/varint lengths', () => {
  for (const length of [1, 63, 64, 16383, 16384, 100_000]) {
    const text = 'a'.repeat(length)
    const [header, payload] = encodeFrame(text)
    expect(header.length).toBe(length < 64 ? 1 : length < 16384 ? 2 : 4)
    expect(new FrameReader().push(new Uint8Array([...header, ...payload]))).toEqual([text])
  }
})
test('frames/split and joined chunks', () => {
  const texts = ['{"id":1}', 'é'.repeat(100), 'x'.repeat(20_000)]
  const bytes = Buffer.concat(texts.flatMap(encodeFrame))
  const reader = new FrameReader()
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 7) out.push(...reader.push(bytes.subarray(i, i + 7)))
  expect(out).toEqual(texts)
  expect(new FrameReader().push(bytes)).toEqual(texts)
})
test('frames/empty keepalive frames are skipped', () => {
  expect(new FrameReader().push(Buffer.concat([Uint8Array.of(0), ...encodeFrame('{}'), Uint8Array.of(0)]))).toEqual(['{}'])
})
test('frames/too big', () => {
  const n = maxFrame + 1
  expect(() => new FrameReader().push(Uint8Array.of(0x80 | (n >>> 24), (n >> 16) & 255, (n >> 8) & 255, n & 255))).toThrow(
    'message too big',
  )
})

test('post', async () => {
  const c = await client()
  expect(await c.send('hello')).toBe('world')
  expect(await c.send('echo', { a: [1, 'two'] })).toEqual({ a: [1, 'two'] })
  await expect(c.send('notfound')).rejects.toMatchObject({ message: 'api not found' })
})
test('batching', async () => {
  const c = await client()
  await c.send('hello')
  const responses = await Promise.all(Array.from({ length: 20_000 }, (_, i) => c.send('echo', i)))
  expect(responses[19_999]).toBe(19_999)
})
test('large messages', async () => {
  const c = await client()
  const body = 'x'.repeat(1_000_000)
  expect(await c.send('echo', body)).toBe(body)
})
test('headers become state', async () => {
  const c = await client({ quic, headers: () => ({ Name: 'tester' }) })
  expect(await c.send('name')).toBe('tester')
})
test('events', async () => {
  const c = await client()
  const received: string[] = []
  const subscription = await c.subscribe('hello', 'test', event => received.push(event))
  events.hello.send('test', 'event 1')
  events.hello.send('test', 'event 2')
  await waitFor(() => received.length === 2)
  subscription.cancel()
  await sleep()
  events.hello.send('test', 'event 3')
  await sleep()
  expect(received).toEqual(['event 1', 'event 2'])
})
test('stream', async () => {
  const c = await client()
  const values: number[] = []
  for await (const value of c.values('values')) values.push(value)
  expect(values).toEqual([0, 1, 2])
})
test('stream/cancel', async () => {
  const c = await client()
  for await (const value of c.values('cancel')) if (value === 2) break
  await sleep(30)
  expect(stats.streamCancel).toBe(3)
})
test('server calls the client', async () => {
  const c = await client()
  expect(await c.send('mirror')).toBe('client world')
  expect(await c.send('mirror/events')).toBe('name')
  expect(await c.send('mirror/stream')).toBe(0)
})
test('reconnects after the server drops the connection', async () => {
  const c = await client()
  await c.send('hello')
  const connected = stats.connected
  const replayed = c.send('disconnect')
  await waitFor(() => stats.connected > connected)
  expect(await c.send('hello')).toBe('world')
  expect(await replayed).toBeUndefined()
})
test('certificate pinning', async () => {
  const pinned = await client({ quic: { fingerprint } })
  expect(await pinned.send('hello')).toBe('world')
  const text = await client({ quic: { ca: cert.toString() } })
  expect(await text.send('hello')).toBe('world')
})
test('rejects untrusted and mismatched certificates', async () => {
  for (const options of [{}, { quic: { fingerprint: 'ab'.repeat(32) } }]) {
    const c = await client(options)
    let opened = false
    c.ws.onopen = async () => {
      opened = true
    }
    await sleep(300)
    expect(opened).toBe(false)
    c.ws.stop()
  }
})
test('rejected state closes the connection', async () => {
  const connected = stats.connected
  const c = await client({ quic, headers: () => ({ reject: '1' }) })
  await sleep(200)
  expect(stats.connected).toBe(connected)
  c.ws.stop()
})
test('invalid frames close the connection', async () => {
  const { port } = await ready
  for (const payload of ['not json', '{"nohello":1}']) {
    const session = await connect(`127.0.0.1:${port}`, { alpn: 'channel/1', servername: 'localhost', ca: cert })
    await session.opened
    const stream = await session.createBidirectionalStream()
    stream.writer.writevSync(encodeFrame(payload))
    let closed = false
    session.closed.then(
      () => (closed = true),
      () => (closed = true),
    )
    await waitFor(() => closed)
  }
})
test('disconnect and stop', async () => {
  await waitFor(() => stats.disconnected > 0)
  const c = await client()
  await c.send('hello')
  const disconnected = stats.disconnected
  c.ws.stop()
  await waitFor(() => stats.disconnected === disconnected + 1)
})
