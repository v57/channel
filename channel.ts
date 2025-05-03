export type Body<State> = { body: any; sender: Sender; state: State }
type Function<State> = (body: Body<State>, path: string) => any | Promise<any>
type Stream<State> = (body: Body<State>, path: string) => AsyncGenerator<any, void, any>
export type EventBody = (body: any) => void
type Api<State> = {
  [key: string]: Api<State> | ((body: Body<State>) => any)
}
interface Controller<State> {
  response: (response: any) => void
  subscribe: (topic: string) => void
  unsubscribe: (topic: string) => void
  event: (topic: string, event: any) => void
  sender: Sender
  state: State
}

export class Channel<State> {
  private id = 0
  publish: (topic: string, body: any) => void = () => {}
  requests = new Map<number, PendingRequest>()
  postApi = new ObjectMap<string, Function<State>>()
  otherPostApi: { path: (path: string) => boolean; request: Function<State> }[] = []
  streamApi = new ObjectMap<string, Stream<State>>()
  otherStreamApi: { path: (path: string) => boolean; request: Stream<State> }[] = []
  _onDisconnect?: (state: State, sender: Sender) => void
  eventsApi?: Map<string, Subscription>
  private streams = new ObjectMap<number, AsyncGenerator<any, void, any>>()
  constructor() {}
  post(path: string, request: Function<State>) {
    this.postApi.set(path, request)
    return this
  }
  postOther(path: (path: string) => boolean, request: Function<State>) {
    this.otherPostApi.push({ path, request })
    return this
  }
  stream(path: string, request: Stream<State>) {
    this.streamApi.set(path, request)
    return this
  }
  streamOther(path: (path: string) => boolean, request: Stream<State>) {
    this.otherStreamApi.push({ path, request })
    return this
  }
  onDisconnect(action: (state: State, sender: Sender) => void) {
    this._onDisconnect = action
    return this
  }
  makeRequest(path: string, body: any | undefined, response: (response: Response) => void): Request {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, path, body },
      response,
    }
    this.requests.set(id, pending)
    return { id, path, body }
  }
  makeStream(stream: string, body: any | undefined, response: (response: Response) => void): StreamRequest {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, stream, body },
      response,
    }
    this.requests.set(id, pending)
    return { id, stream, body }
  }
  makeSubscription(sub: string, body: any | undefined, response: (response: Response) => void): SubscriptionRequest {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, sub, body },
      response,
    }
    this.requests.set(id, pending)
    return { id, sub, body }
  }
  receive(some: any, controller: Controller<State>) {
    if (Array.isArray(some)) {
      some.forEach(a => this.receiveOne(a, controller))
    } else {
      this.receiveOne(some, controller)
    }
  }
  receiveOne(some: any, controller: Controller<State>) {
    if (some.path) {
      const id: number | undefined = some.id
      const api = this.postApi.get(some.path) ?? this.otherPostApi.find(a => a.path(some.path))?.request
      try {
        if (!api) throw 'api not found'
        const body = api({ body: some.body, sender: controller.sender, state: controller.state }, some.path)
        if (id !== undefined) {
          if (body?.then && body?.catch) {
            body
              .then((a: any) => controller.response({ id, body: a }))
              .catch((e: any) => controller.response({ id, error: `${e}` }))
          } else {
            controller.response({ id, body })
          }
        }
      } catch (e) {
        if (id !== undefined) controller.response({ id, error: `${e}` })
      }
    } else if (some.stream) {
      const id: number | undefined = some.id
      const api = this.streamApi.get(some.stream) ?? this.otherStreamApi.find(a => a.path(some.stream))?.request
      if (!api) throw 'api not found'
      if (id === undefined) throw 'stream requires id'
      this.streamRequest(id, controller, some.stream, some.body, api)
    } else if (some.cancel !== undefined) {
      const id: number | undefined = some.cancel
      if (id === undefined) throw 'stream requires id'
      this.streams.get(id)?.return()
    } else if (some.sub) {
      const id: number | undefined = some.id
      const subscription = this.eventsApi?.get(some.sub)
      try {
        if (!subscription) throw 'subscription not found'
        let topic = subscription._topic(some.body)
        if (topic.length === 0) topic = subscription.prefix
        else topic = subscription.prefix + '/' + topic
        const body = subscription._body(some.body)
        if (body?.then && body.catch) {
          body
            .then((a: any) => {
              controller.subscribe(topic)
              controller.response({ id, topic, body: a })
            })
            .catch((e: any) => controller.response({ id, error: `${e}` }))
        } else {
          controller.subscribe(topic)
          controller.response({ id, topic, body })
        }
      } catch (e) {
        if (id !== undefined) controller.response({ id, error: `${e}` })
      }
    } else if (some.unsub) {
      controller.unsubscribe(some.unsub)
    } else if (some.topic) {
      if (some.id !== undefined) {
        const request = this.requests.get(some.id)
        this.requests.delete(some.id)
        if (request) request.response(some)
      }
      if (some.body) controller.event(some.topic, some.body)
    } else if (some.id !== undefined) {
      const request = this.requests.get(some.id)
      if (!request) return
      if (!('stream' in request.request && !some.done)) {
        this.requests.delete(some.id)
      }
      if (request) request.response(some)
    }
  }
  private async streamRequest(
    id: number,
    controller: Controller<State>,
    path: string,
    body: any,
    stream: Stream<State>,
  ) {
    try {
      const values = stream({ body, sender: controller.sender, state: controller.state }, path)
      this.streams.set(id, values)
      for await (const value of values) {
        controller.response({ id, body: value })
      }
      controller.response({ id, done: true })
    } catch (e) {
      controller.response({ id, error: `${e}` })
    }
    this.streams.delete(id)
  }
  events(events: Map<string, Subscription> | any, prefix: string = '') {
    if (!this.eventsApi) this.eventsApi = new Map()
    let p = prefix.length ? prefix + '/' : ''
    const e = this.eventsApi
    if (events instanceof Map) {
      events.forEach((value, key) => e.set(p + key, value))
    } else {
      Subscription.parse(events, prefix, this.eventsApi)
    }
    return this
  }
  api(api: Api<State>) {
    this._parseApi(api, '')
    return this
  }
  merge(channel: Channel<State>, prefix = '') {
    let p = prefix.length ? prefix + '/' : ''
    if (channel.eventsApi) {
      this.events(channel.events, prefix)
    }
    channel.postApi.forEach((value, key) => this.post(p + key, value))
    channel.streamApi.forEach((value, key) => this.stream(p + key, value))
    return this
  }
  private _parseApi(api: Api<State>, prefix: string) {
    for (let [key, value] of Object.entries(api)) {
      if (typeof value === 'function') {
        const name = value.constructor.name
        const isIterator = name === 'AsyncGeneratorFunction' || name === 'GeneratorFunction'
        const path = key === '_' ? prefix : prefix.length ? `${prefix}/${key}` : key
        if (isIterator) {
          this.stream(path, value)
        } else {
          this.post(path, value)
        }
        continue
      } else if (typeof value === 'object') {
        this._parseApi(value, prefix.length ? `${prefix}/${key}` : key)
      }
    }
  }
}

interface PendingRequest {
  request: Request | SubscriptionRequest | StreamRequest
  response: (response: Response) => void
}
interface Request {
  id: number
  path: string
  body?: any
}
interface SubscriptionRequest {
  id: number
  sub: string
  body?: any
}
interface StreamRequest {
  id: number
  stream: string
  body?: any
}
export interface Response {
  id: number
  topic?: string
  body?: any
  error?: any
  done?: boolean
}

interface Publisher {
  publish(event: SubscriptionEvent): void
}

export interface SubscriptionEvent {
  topic: string
  body: any
}

export class Subscription {
  static parse(object: any, prefix: string, map: Map<string, Subscription>) {
    for (let [key, value] of Object.entries(object)) {
      if (value instanceof Subscription) {
        value.prefix = prefix.length ? `${prefix}/${key}` : key
        map.set(prefix + key, value)
        continue
      } else if (typeof value === 'object') {
        this.parse(value, `${prefix}${key}/`, map)
      }
    }
  }
  publishers: Publisher[] = []
  prefix: string = ''
  _topic: (request: any) => string = request => (request === undefined ? '' : `${request}`)
  _body: (request: any) => any | Promise<any> | undefined = () => {}
  topic(make: (request: any) => string) {
    this._topic = make
  }
  body(make: (body: any) => any) {
    this._topic = make
  }
  send(request: any, body?: any) {
    const topic = this._topic(request)
    const b: any | Promise<any> | undefined = body ?? this._body(request)
    if (b?.then) {
      b.then((a: any) => this.publish(topic, a)).catch(() => {})
    } else {
      this.publish(topic, b)
    }
  }
  publish(topic: string, body?: any) {
    if (!body) return
    const event: SubscriptionEvent = { topic: this.prefix.length ? this.prefix + '/' + topic : topic, body }
    this.publishers.forEach(a => a.publish(event))
  }
}

export class ObjectMap<Key, Value> {
  storage: any = {}
  size = 0
  get(id: Key): Value | undefined {
    return this.storage[id]
  }
  set(id: Key, value: Value) {
    this.size += 1
    this.storage[id] = value
  }
  delete(id: Key) {
    this.size -= 1
    delete this.storage[id]
  }
  map<O>(transform: (value: Value) => O): O[] {
    let array: O[] = []
    for (let a of Object.values(this.storage)) {
      array.push(transform(a as Value))
    }
    return array
  }
  forEach<O>(callback: (value: Value, key: Key) => void) {
    for (let [key, value] of Object.entries(this.storage)) {
      callback(value as Value, key as Key)
    }
  }
}

export interface Sender {
  send(path: string, body?: any): Promise<any>
  values(path: string, body?: any): Values
  subscribe(path: string, body: any | undefined, event: (body: any) => void): Promise<Cancellable>
  stop(): void
}

export interface Cancellable {
  cancel(): void
}

interface ConnectionInterface<RequestId = number> {
  send(body: any): RequestId
  sent(id: RequestId): void
  cancel(id: RequestId): boolean
  notify(body: any): void
  addTopic(topic: string, event: (body: any) => void): () => boolean
  stop(): void
}

export function makeSender<State>(ch: Channel<State>, connection: ConnectionInterface): Sender {
  return {
    async send(path: string, body?: any): Promise<any> {
      return new Promise((success, failure) => {
        let id: number | undefined
        const request = ch.makeRequest(path, body, response => {
          if (response.error) {
            failure(response.error)
          } else {
            success(response.body)
          }
          if (id !== undefined) {
            connection.sent(id)
          }
        })
        id = connection.send(request)
      })
    },
    values(path: string, body?: any) {
      let id: number | undefined
      return new Values(
        ch,
        path,
        body,
        body => (id = connection.send(body)),
        rid => {
          if (id && !connection.cancel(id)) {
            connection.send({ cancel: rid })
          }
        },
      )
    },
    async subscribe(path: string, body: any, event: (body: any) => void): Promise<Cancellable> {
      return new Promise((success, failure) => {
        const request = ch.makeSubscription(path, body, response => {
          if (response.error) {
            failure(response.error)
          } else {
            const topic = response.topic!
            const cancel = connection.addTopic(topic, event)
            success({
              cancel(): void {
                let cancalled = cancel()
                if (cancalled) {
                  connection.notify({ unsub: topic })
                }
              },
            })
          }
        })
        connection.send(request)
      })
    },
    stop() {
      connection.stop()
    },
  }
}

class Values {
  ch: Channel<any>
  path: string
  body: any | undefined
  isRunning = false
  pending: ((response: Response) => void)[] = []
  queued: Response[] = []
  rid: number | undefined
  onSend: (body: any) => void
  onCancel: (id: number) => void
  constructor(
    ch: Channel<any>,
    path: string,
    body: any | undefined,
    onSend: (body: any) => void,
    onCancel: (id: number) => void,
  ) {
    this.ch = ch
    this.path = path
    this.body = body
    this.onSend = onSend
    this.onCancel = onCancel
  }

  private start() {
    if (this.isRunning) return
    this.isRunning = true
    const request = this.ch.makeStream(this.path, this.body, response => {
      const pendingPromise = this.pending.shift()
      if (pendingPromise) {
        pendingPromise(response)
      } else {
        this.queued.push(response)
      }
    })
    this.rid = request.id
    this.onSend(request)
  }
  private processResponse(response: Response): IteratorValue<any> {
    if (response.error) throw response.error
    return { value: response.body, done: response.done ? true : false }
  }
  async next(): Promise<IteratorValue<any>> {
    const result = new Promise<IteratorValue<any>>((success, failure) => {
      this.pending.push(value => {
        try {
          success(this.processResponse(value))
        } catch (error) {
          failure(error)
        }
      })
    })
    this.start()
    const value = await result
    return value
  }
  async return() {
    this.cancel()
    return { value: undefined, done: true }
  }
  private cancel() {
    if (this.rid === undefined) return
    this.onCancel(this.rid)
  }
  [Symbol.asyncIterator]() {
    return this
  }
}

interface IteratorValue<T> {
  value: T
  done: boolean
}
