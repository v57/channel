import { expect, test } from 'bun:test'
import {
  Channel,
  ObjectMap,
  Subscription,
  makeSender,
  type CancellableRequest,
  type Controller,
  type Response,
  type Sender,
} from '../channel'

function createSender(): Sender {
  return {
    streams: new ObjectMap<number, AsyncIterator<any, void, any>>(),
    requests: new ObjectMap<number, CancellableRequest>(),
    async send() {
      return undefined
    },
    request() {
      throw new Error('unused in test')
    },
    values() {
      throw new Error('unused in test')
    },
    async subscribe() {
      return {
        cancel() {},
      }
    },
    stop() {},
  } as unknown as Sender
}

function createController(sender: Sender) {
  const responses: Response[] = []
  const subscriptions: string[] = []
  const unsubscriptions: string[] = []
  const events: Array<{ topic: string; body: any }> = []

  const controller: Controller<Record<string, any>> = {
    response(response: any) {
      responses.push(response)
    },
    subscribe(topic: string) {
      subscriptions.push(topic)
    },
    unsubscribe(topic: string) {
      unsubscriptions.push(topic)
    },
    event(topic: string, body: any) {
      events.push({ topic, body })
    },
    sender,
    state: {},
  }

  return { controller, responses, subscriptions, unsubscriptions, events }
}

function firstRequestId(ch: Channel<any>) {
  let id = -1
  ch.requests.forEach((_, key) => {
    id = Number(key)
  })
  return id
}

function createConnection(options?: { cancelResult?: boolean; sendReturnsUndefined?: boolean }) {
  let nextId = 200
  const sentIds: number[] = []
  const cancelIds: number[] = []
  const notifyBodies: any[] = []

  const connection = {
    send(_body: any) {
      if (options?.sendReturnsUndefined) return undefined as unknown as number
      return nextId++
    },
    sent(id: number) {
      sentIds.push(id)
    },
    cancel(id: number) {
      cancelIds.push(id)
      return options?.cancelResult ?? false
    },
    notify(body: any) {
      notifyBodies.push(body)
    },
    addTopic() {
      return () => true
    },
    stop() {},
  }

  return { connection, sentIds, cancelIds, notifyBodies }
}

async function tick() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

test('Channel.postOther and streamOther route dynamic paths', async () => {
  const ch = new Channel()
  ch.postOther(path => path.startsWith('dynamic/'), ({ path, body }) => `${path}:${body}`)
  ch.streamOther(path => path.endsWith('/stream'), async function* ({ body }) {
    yield body
  })

  const sender = createSender()
  const { controller, responses } = createController(sender)

  ch.receiveOne({ id: 1, path: 'dynamic/echo', body: 'ok' }, controller)
  ch.receiveOne({ id: 2, stream: 'dynamic/stream', body: 7 }, controller)
  await tick()

  expect(responses).toContainEqual({ id: 1, body: 'dynamic/echo:ok' })
  expect(responses).toContainEqual({ id: 2, body: 7 })
  expect(responses).toContainEqual({ id: 2, done: true })
})

test('Channel.disconnect runs cleanup callbacks and clears pending maps', () => {
  let disconnected = 0
  const ch = new Channel<Record<string, any>>().onDisconnect(() => {
    disconnected += 1
    throw new Error('ignored')
  })
  const sender = createSender()

  let closedStreams = 0
  sender.streams.set(
    1,
    {
      async next() {
        return { value: undefined, done: true }
      },
      async return() {
        closedStreams += 1
        return { value: undefined, done: true }
      },
    },
  )

  let cancelActions = 0
  sender.requests.set(
    10,
    {
      isCancelled: false,
      cancelActions: [
        () => {
          cancelActions += 1
        },
        () => {
          cancelActions += 1
          throw new Error('ignored')
        },
      ] as any,
      onCancel() {},
      cancel() {},
    },
  )

  ch.makeRequest('pending', undefined, undefined, () => {}, sender)
  ch.disconnect({}, sender)

  expect(disconnected).toBe(1)
  expect(closedStreams).toBe(1)
  expect(cancelActions).toBe(2)
  expect(sender.streams.size).toBe(0)
  expect(sender.requests.size).toBe(0)
  expect(ch.requests.size).toBe(0)
})

test('Channel.cancel removes request by id', () => {
  const ch = new Channel()
  const request = ch.makeRequest('hello', undefined, undefined, () => {})
  expect(ch.requests.size).toBe(1)
  ch.cancel(request.id)
  expect(ch.requests.size).toBe(0)
})

test('Channel.receiveOne handles async post rejection', async () => {
  const ch = new Channel().post('fails', async () => {
    throw 'boom'
  })
  const sender = createSender()
  const { controller, responses } = createController(sender)

  ch.receiveOne({ id: 1, path: 'fails' }, controller)
  await tick()

  expect(responses).toContainEqual({ id: 1, error: 'boom' })
})

test('Channel.receiveOne cancel runs every task onCancel action', async () => {
  const onCancelCalls: number[] = []
  const ch = new Channel().post('wait', ({ task }) => {
    task?.onCancel(() => onCancelCalls.push(1))
    task?.onCancel(() => onCancelCalls.push(2))
    return new Promise(() => {})
  })
  const sender = createSender()
  const { controller, responses } = createController(sender)

  ch.receiveOne({ id: 5, path: 'wait' }, controller)
  ch.receiveOne({ cancel: 5 }, controller)
  await tick()

  expect(onCancelCalls).toEqual([1, 2])
  expect(responses).toContainEqual({ id: 5, error: 'cancelled' })
  expect(sender.requests.size).toBe(0)
})

test('Channel.receiveOne subscribes after async subscription body resolves', async () => {
  const news = new Subscription()
  news.topic(() => 'ready')
  news._body = async (request: { value: string }) => request.value.toUpperCase()
  const ch = new Channel().events({ news })
  const sender = createSender()
  const { controller, responses, subscriptions } = createController(sender)

  ch.receiveOne({ id: 9, sub: 'news', body: { value: 'ok' } }, controller)
  await tick()

  expect(subscriptions).toEqual(['news/ready'])
  expect(responses).toContainEqual({ id: 9, topic: 'news/ready', body: 'OK' })
})

test('Subscription.topic and body can both replace topic formatter', () => {
  const subscription = new Subscription()
  const events: Array<{ topic: string; body: any }> = []
  subscription.publishers.push({
    publish(event) {
      events.push(event)
    },
  })

  subscription.topic((body: string) => `topic-${body}`)
  subscription.body((body: string) => `body-${body}`)
  subscription.send('x', 'payload')

  expect(events).toEqual([{ topic: 'body-x', body: 'payload' }])
})

test('ObjectMap.uncheckedSet increments size without key checks', () => {
  const map = new ObjectMap<string, number>()

  map.uncheckedSet('a', 1)
  map.uncheckedSet('a', 2)

  expect(map.size).toBe(2)
  expect(map.get('a')).toBe(2)
})

test('makeSender.request resolves and marks sent id', async () => {
  const ch = new Channel()
  const { connection, sentIds } = createConnection()
  const sender = makeSender(ch, connection as any)
  const request = sender.request('hello')
  const rid = firstRequestId(ch)
  const { controller } = createController(sender)

  ch.receiveOne({ id: rid, body: 'world' }, controller)

  await expect(request.response).resolves.toBe('world')
  expect(sentIds).toEqual([200])
})

test('makeSender.request rejects and marks sent id', async () => {
  const ch = new Channel()
  const { connection, sentIds } = createConnection()
  const sender = makeSender(ch, connection as any)
  const request = sender.request('hello')
  const rid = firstRequestId(ch)
  const { controller } = createController(sender)

  ch.receiveOne({ id: rid, error: 'failed' }, controller)

  await expect(request.response).rejects.toBe('failed')
  expect(sentIds).toEqual([200])
})

test('makeSender.request cancel notifies when transport cancel fails', () => {
  const ch = new Channel()
  const { connection, cancelIds, notifyBodies } = createConnection({ cancelResult: false })
  const sender = makeSender(ch, connection as any)
  const request = sender.request('slow')
  const rid = firstRequestId(ch)

  request.cancel()

  expect(cancelIds).toEqual([200])
  expect(notifyBodies).toEqual([{ cancel: rid }])
  expect(ch.requests.size).toBe(0)
})

test('makeSender.request cancel notifies by request id when send id is missing', () => {
  const ch = new Channel()
  const { connection, cancelIds, notifyBodies } = createConnection({ sendReturnsUndefined: true })
  const sender = makeSender(ch, connection as any)
  const request = sender.request('slow')
  const rid = firstRequestId(ch)

  request.cancel()

  expect(cancelIds).toEqual([])
  expect(notifyBodies).toEqual([{ cancel: rid }])
  expect(ch.requests.size).toBe(0)
})
