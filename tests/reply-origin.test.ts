import { expect, test } from 'bun:test'
import { Channel, type Sender } from '../channel'
import '../server'
import '../client'

// A server that forwards calls to a service it holds the sender of, like the Hub does. Request ids are one counter
// for every connection, so another peer must not be able to answer what the server asked the service.
function relay() {
  let service: Sender | undefined
  let release: () => void = () => {}
  const answered = new Promise<void>(resolve => (release = resolve))
  const server = new Channel()
    .post('register', ({ sender }) => {
      service = sender
      return true
    })
    .post('call', async ({ body }) => await service!.request('svc/read', body).response)
    .stream('watch', async function* () {
      for await (const value of service!.values('svc/values')) yield value
    })
    .listen(0)
  const url = `ws://127.0.0.1:${server.port}`
  const serviceChannel = new Channel()
    .post('svc/read', async () => {
      await answered
      return 'real'
    })
    .stream('svc/values', async function* () {
      await answered
      yield 'real'
    })
  return { server, url, serviceChannel, release }
}

async function open(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url)
  await new Promise(resolve => (ws.onopen = resolve))
  return ws
}

test('a response from another connection answers no forwarded call', async () => {
  const { server, url, serviceChannel, release } = relay()
  const service = serviceChannel.connect(url)
  await service.send('register')
  const victim = new Channel().connect(url)
  const call = victim.send('call', 'x')
  await Bun.sleep(50)
  const attacker = await open(url)
  attacker.send(JSON.stringify(Array.from({ length: 256 }, (_, id) => ({ id, body: 'forged' }))))
  attacker.send(JSON.stringify(Array.from({ length: 256 }, (_, id) => ({ id, topic: 'x', body: 'forged' }))))
  await Bun.sleep(50)
  release()
  expect(await call).toBe('real')
  attacker.close()
  victim.stop()
  service.stop()
  server.stop(true)
})

test('another connection can neither feed nor end a forwarded stream', async () => {
  const { server, url, serviceChannel, release } = relay()
  const service = serviceChannel.connect(url)
  await service.send('register')
  const victim = new Channel().connect(url)
  const values: any[] = []
  const reading = (async () => {
    for await (const value of victim.values('watch')) values.push(value)
  })()
  await Bun.sleep(50)
  const attacker = await open(url)
  attacker.send(JSON.stringify(Array.from({ length: 256 }, (_, id) => ({ id, body: 'forged' }))))
  attacker.send(JSON.stringify(Array.from({ length: 256 }, (_, id) => ({ id, done: true }))))
  await Bun.sleep(50)
  release()
  await reading
  expect(values).toEqual(['real'])
  attacker.close()
  victim.stop()
  service.stop()
  server.stop(true)
})

test('the connection a request went to still answers it', async () => {
  const server = new Channel().post('mirror', async ({ sender }) => await sender.send('hello')).listen(0)
  const client = new Channel().post('hello', () => 'client').connect(`ws://127.0.0.1:${server.port}`)
  expect(await client.send('mirror')).toBe('client')
  client.stop()
  server.stop(true)
})
