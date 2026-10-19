export type Body<State> = {
  body: any
  sender: Sender
  state: State
  path: string
  context: any
  task?: CancellableRequest
}
export type Function<State> = (body: Body<State>) => any | Promise<any>
export type Stream<State> = (
  body: Body<State>,
) => AsyncIterator<any, void, any> | Promise<AsyncIterator<any, void, any>>
export type EventBody = (body: any) => void
/** What a `sub` handler returns: the topic to join, and the snapshot. Without a topic the subscription is one-shot. */
export interface SubResult {
  topic?: string
  body?: any
}
export type SubHandler<State> = (body: Body<State>) => SubResult | void | Promise<SubResult | void>
/** The second argument of `Subscription.topic()` and `body()` callbacks */
export interface SubscriptionContext<State = any> {
  state: State
  sender: Sender
  context: any
}
type Api<State> = {
  [key: string]: Api<State> | ((body: Body<State>) => any)
}
export interface Controller<State> {
  response: (response: any) => void
  subscribe: (topic: string) => void
  unsubscribe: (topic: string) => void
  event: (topic: string, event: any) => void
  sender: Sender
  state: State
}

export class Channel<State> {
  private id = 0
  /** Delivers published events to the connections subscribed to their topic, one per `listen()` */
  transports: Publisher[] = []
  /**
   * Every `publish` goes through here. Replace it to fan events out across processes (Redis, NATS, ...), and call
   * `deliver` with the events that arrive.
   */
  publisher: (event: SubscriptionEvent) => void = event => this.deliver(event)
  subApi = new ObjectMap<string, SubHandler<State>>()
  requests = new Map<number, PendingRequest>()
  postApi = new ObjectMap<string, Function<State>>()
  otherPostApi: { path: (path: string) => boolean; request: Function<State> }[] = []
  streamApi = new ObjectMap<string, Stream<State>>()
  otherStreamApi: { path: (path: string) => boolean; request: Stream<State> }[] = []
  _onDisconnect?: (state: State, sender: Sender) => void
  eventsApi?: Map<string, Subscription>
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
  /** Subscriptions whose handler decides the topic (or none, for one-shot) from the body and the connection */
  sub(path: string, handler: SubHandler<State>) {
    this.subApi.set(path, handler)
    return this
  }
  /** Sends `body` to every connection subscribed to `topic`, across every `listen()`. `undefined` isn't sent. */
  publish(topic: string, body: any) {
    if (body === undefined) return
    this.publisher({ topic, body })
  }
  deliver(event: SubscriptionEvent) {
    for (const transport of this.transports) transport.publish(event)
  }
  onDisconnect(action: (state: State, sender: Sender) => void) {
    this._onDisconnect = action
    return this
  }
  /** `reconnecting`: the client will replay its unanswered requests, so their responses are still awaited */
  disconnect(state: State, sender: Sender, reconnecting = false) {
    try {
      this._onDisconnect?.(state, sender)
    } catch {}
    sender.streams.forEach(stream => {
      try {
        stream?.return?.()
      } catch {}
    })
    sender.requests.forEach(request => {
      request.isCancelled = true
      request.cancelActions?.forEach(action => {
        try {
          action()
        } catch {}
      })
    })
    sender.streams.clear()
    sender.requests.clear()
    if (reconnecting) return
    const toDelete: number[] = []
    this.requests.forEach((request, key) => {
      if (request.request.sender === sender) toDelete.push(key as unknown as number)
    })
    for (const id of toDelete) this.requests.delete(id)
  }
  makeRequest(
    path: string,
    body: any | undefined,
    context: any | undefined,
    response: (response: Response) => void,
    sender?: Sender,
  ): Request {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, path, body, context, sender },
      response,
    }
    this.requests.set(id, pending)
    return { id, path, body, context }
  }
  makeStream(
    stream: string,
    body: any | undefined,
    context: any | undefined,
    response: (response: Response) => void,
    sender?: Sender,
  ): StreamRequest {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, stream, body, context, sender },
      response,
    }
    this.requests.set(id, pending)
    return { id, stream, body, context }
  }
  makeSubscription(
    sub: string,
    body: any | undefined,
    context: any | undefined,
    response: (response: Response) => void,
    sender?: Sender,
  ): SubscriptionRequest {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, sub, body, context, sender },
      response,
    }
    this.requests.set(id, pending)
    return { id, sub, body, context }
  }
  cancel(id: number) {
    this.requests.delete(id)
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
      let task: CancellableRequest | undefined
      try {
        if (!api) throw apiNotFound
        if (id !== undefined) {
          task = {
            isCancelled: false,
            onCancel(action: () => void) {
              if (this.cancelActions) {
                this.cancelActions.push(action)
              } else {
                this.cancelActions = [action]
              }
            },
            cancel() {
              this.isCancelled = true
              this.cancelActions?.forEach(action => action())
              controller.response({ id, error: 'cancelled', code: 'cancelled' })
            },
          }
        }
        const body = api({
          body: some.body,
          context: some.context ?? {},
          sender: controller.sender,
          state: controller.state,
          path: some.path,
          task,
        })
        if (id !== undefined) {
          if (body?.then && body?.catch) {
            if (task) controller.sender.requests.set(id, task) // we only need cancellable tasks here cause it halves the performance and reduces by 30% on Promise
            const onDone = () => {
              if (task) controller.sender.requests.delete(id)
            }
            body
              .then((a: any) => {
                if (!task?.isCancelled) controller.response({ id, body: a })
                onDone()
              })
              .catch((e: any) => {
                if (!task?.isCancelled) controller.response(errorResponse(id, e))
                onDone()
              })
          } else {
            controller.response({ id, body })
            controller.sender.requests.delete(id)
          }
        }
      } catch (e) {
        if (id !== undefined) {
          if (!task?.isCancelled) controller.response(errorResponse(id, e))
          if (task) controller.sender.requests.delete(id)
        }
      }
    } else if (some.stream) {
      const id: number | undefined = some.id
      try {
        const api = this.streamApi.get(some.stream) ?? this.otherStreamApi.find(a => a.path(some.stream))?.request
        if (!api) throw apiNotFound
        if (id === undefined) throw 'stream requires id'
        this.streamRequest(id, controller, some.stream, some.body, some.context ?? {}, api)
      } catch (e) {
        if (id !== undefined) controller.response(errorResponse(id, e))
      }
    } else if (some.cancel !== undefined) {
      try {
        const id: number | undefined = some.cancel
        if (id === undefined) throw 'cancellation requires id'
        controller.sender.streams.get(id)?.return?.()
        controller.sender.streams.delete(id)
        const request = controller.sender.requests.get(id)
        if (request) {
          request.cancel()
          controller.sender.requests.delete(id)
        }
      } catch {}
    } else if (some.sub) {
      const id: number | undefined = some.id
      try {
        const result = this.subscription(some.sub, some.body, some.context ?? {}, controller)
        if (result?.then) {
          result
            .then((a: SubResult | void) => this.subscribed(id, a, controller))
            .catch((e: any) => {
              if (id !== undefined) controller.response(errorResponse(id, e))
            })
        } else {
          this.subscribed(id, result, controller)
        }
      } catch (e) {
        if (id !== undefined) controller.response(errorResponse(id, e))
      }
    } else if (some.unsub) {
      controller.unsubscribe(some.unsub)
    } else if (some.topic) {
      if (some.id !== undefined) {
        // A subscription response. Active subscriptions keep their request, so the snapshots of their
        // resubscriptions after a reconnect reach them too.
        const request = this.requests.get(some.id)
        if (request) {
          if (!('sub' in request.request)) this.requests.delete(some.id)
          request.response(some)
        }
      } else if ('body' in some) {
        controller.event(some.topic, some.body)
      }
    } else if (some.id !== undefined) {
      const request = this.requests.get(some.id)
      if (!request) return
      if (!('stream' in request.request && !some.done)) {
        this.requests.delete(some.id)
      }
      if (request) request.response(some)
    }
  }
  private subscription(path: string, body: any, context: any, controller: Controller<State>): any {
    const handler = this.subApi.get(path)
    const { sender, state } = controller
    if (handler) return handler({ body, context, sender, state, path })
    const subscription = this.eventsApi?.get(path)
    if (!subscription) throw subscriptionNotFound
    const ctx: SubscriptionContext<State> = { state, sender, context }
    const topic = subscription.prefix + '/' + subscription._topic(body, ctx)
    const snapshot = subscription._body(body, ctx)
    if (snapshot?.then) return snapshot.then((a: any) => ({ topic, body: a }))
    return { topic, body: snapshot }
  }
  private subscribed(id: number | undefined, result: SubResult | void, controller: Controller<State>) {
    const topic = result?.topic
    if (topic) controller.subscribe(topic)
    if (id === undefined) return
    const response: Response = { id }
    if (topic) response.topic = topic
    if (result && result.body !== undefined) response.body = result.body
    controller.response(response)
  }
  private async streamRequest(
    id: number,
    controller: Controller<State>,
    path: string,
    body: any,
    context: any,
    stream: Stream<State>,
  ) {
    try {
      const values = await stream({ body, sender: controller.sender, state: controller.state, path, context })
      controller.sender.streams.set(id, values)
      try {
        while (true) {
          const value = await values.next()
          if (value.done) {
            controller.response({ id, done: true })
            break
          } else {
            controller.response({ id, body: value.value })
          }
        }
      } catch {}
    } catch (e) {
      controller.response(errorResponse(id, e))
    }
    controller.sender.streams.delete(id)
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
      this.events(channel.eventsApi, prefix)
    }
    channel.postApi.forEach((value, key) => this.post(p + key, value))
    channel.subApi.forEach((value, key) => this.sub(p + key, value))
    channel.streamApi.forEach((value, key) => this.stream(p + key, value))
    const scoped = (match: (path: string) => boolean) =>
      p.length ? (path: string) => path.startsWith(p) && match(path.slice(p.length)) : match
    channel.otherPostApi.forEach(a => this.postOther(scoped(a.path), a.request))
    channel.otherStreamApi.forEach(a => this.streamOther(scoped(a.path), a.request))
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
  context?: any
  sender?: Sender
}
interface SubscriptionRequest {
  id: number
  sub: string
  body?: any
  context?: any
  sender?: Sender
}
interface StreamRequest {
  id: number
  stream: string
  body?: any
  context?: any
  sender?: Sender
}
export interface Response {
  id: number
  topic?: string
  body?: any
  error?: any
  /** Error code: a library code (`not_found`, `cancelled`, ...) or the application's own */
  code?: string | number
  /** Error details, any JSON */
  info?: any
  done?: boolean
}

/** What requests reject with. `String(error)` is the message, like the plain string errors of v1. */
export class ChannelError extends Error {
  declare code?: string | number
  declare info?: any
  constructor(message: string, code?: string | number, info?: any) {
    super(message)
    this.name = 'ChannelError'
    if (code !== undefined) this.code = code
    if (info !== undefined) this.info = info
  }
  override toString() {
    return this.message
  }
  static from(response: Response): ChannelError {
    const error = response.error
    return new ChannelError(typeof error === 'string' ? error : `${error}`, response.code, response.info)
  }
}

const apiNotFound = { message: 'api not found', code: 'not_found' }
const subscriptionNotFound = { message: 'subscription not found', code: 'not_found' }

/**
 * The error reply for a thrown value: a string is the message; an object with a string `message` (an `Error`, a
 * `ChannelError` or `{ message, code, info }`) also passes its `code` and `info`; anything else is converted with `String`.
 */
export function errorResponse(id: number, e: any): Response {
  let error: string
  let code: any
  let info: any
  if (typeof e === 'string') {
    error = e
  } else if (e !== null && typeof e === 'object' && typeof e.message === 'string') {
    error = e.message
    code = e.code
    info = e.info
  } else {
    error = String(e)
  }
  const response: Response = { id, error: error || 'error' }
  if (typeof code === 'string' || Number.isInteger(code)) response.code = code
  if (info !== undefined) response.info = info
  return response
}

export interface Publisher {
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
  _topic: (request: any, ctx?: SubscriptionContext) => string = request => (request === undefined ? '' : `${request}`)
  _body: (request: any, ctx?: SubscriptionContext) => any | Promise<any> | undefined = () => {}
  /** `ctx` is the subscribing connection, missing when called from `send()` */
  topic(make: (request: any, ctx?: SubscriptionContext) => string) {
    this._topic = make
  }
  body(make: (body: any, ctx?: SubscriptionContext) => any) {
    this._body = make
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
    if (body === undefined) return
    const event: SubscriptionEvent = { topic: this.prefix.length ? this.prefix + '/' + topic : topic, body }
    this.publishers.forEach(a => a.publish(event))
  }
}

export class ObjectMap<Key, Value> {
  storage: any = Object.create(null)
  size = 0
  get(id: Key): Value | undefined {
    return this.storage[id]
  }
  uncheckedSet(id: Key, value: Value) {
    this.size += 1
    this.storage[id] = value
  }
  set(id: Key, value: Value) {
    if (this.storage[id] === undefined) this.size += 1
    this.storage[id] = value
  }
  delete(id: Key) {
    if (this.storage[id] !== undefined) {
      this.size -= 1
      delete this.storage[id]
    }
  }
  map<O>(transform: (value: Value) => O): O[] {
    let array: O[] = []
    for (let a of Object.values(this.storage)) {
      array.push(transform(a as Value))
    }
    return array
  }
  forEach(callback: (value: Value, key: Key) => void) {
    for (let [key, value] of Object.entries(this.storage)) {
      callback(value as Value, key as Key)
    }
  }
  clear() {
    this.storage = Object.create(null)
    this.size = 0
  }
}

export interface Sender {
  streams: ObjectMap<number, AsyncIterator<any, void, any>>
  requests: ObjectMap<number, CancellableRequest>
  send(path: string, body?: any, options?: SendOptions): Promise<any>
  request(path: string, body?: any, options?: SendOptions): SendingRequest
  values(path: string, body?: any, options?: SendOptions): Values
  subscribe(
    path: string,
    body: any | undefined,
    event: (body: any) => void,
    options?: SendOptions,
  ): Promise<Cancellable>
  stop(): void
}

export interface SendOptions {
  context?: any
}

export interface Cancellable {
  cancel(): void
}
export interface CancellableRequest extends Cancellable {
  isCancelled: boolean
  cancelActions?: [() => void]
  onCancel(action: () => void): void
}

interface ConnectionInterface<RequestId = number> {
  send(body: any): RequestId
  sent(id: RequestId): void
  cancel(id: RequestId): boolean
  notify(body: any): void
  addTopic(topic: string, event: (body: any) => void): () => boolean
  stop(): void
}

interface SendingRequest {
  response: Promise<any>
  cancel(): void
}

export function makeSender<State>(ch: Channel<State>, connection: ConnectionInterface): Sender {
  const sender: Sender = {
    streams: new ObjectMap<number, AsyncIterator<any, void, any>>(),
    requests: new ObjectMap<number, CancellableRequest>(),
    async send(path: string, body?: any, options?: SendOptions): Promise<any> {
      return new Promise((success, failure) => {
        let id: number | undefined
        const request = ch.makeRequest(
          path,
          body,
          options?.context,
          response => {
            if (response.error) {
              failure(ChannelError.from(response))
            } else {
              success(response.body)
            }
            if (id !== undefined) {
              connection.sent(id)
            }
          },
          sender,
        )
        id = connection.send(request)
      })
    },
    request(path: string, body?: any, options?: SendOptions): SendingRequest {
      let id: number | undefined
      let rid: number | undefined
      const response = new Promise((success, failure) => {
        const request = ch.makeRequest(
          path,
          body,
          options?.context,
          response => {
            if (response.error) {
              failure(ChannelError.from(response))
            } else {
              success(response.body)
            }
            if (id !== undefined) {
              connection.sent(id)
              id = undefined
              rid = undefined
            }
          },
          sender,
        )
        rid = request.id
        id = connection.send(request)
      })
      return {
        response,
        cancel() {
          if (id !== undefined) {
            const cancelled = connection.cancel(id)
            if (!cancelled && rid !== undefined) {
              connection.notify({ cancel: rid })
            }
          } else if (rid !== undefined) {
            connection.notify({ cancel: rid })
          }
          if (rid !== undefined) ch.cancel(rid)
          id = undefined
          rid = undefined
        },
      }
    },
    values(path: string, body?: any, options?: SendOptions) {
      let id: number | undefined
      return new Values(
        ch,
        path,
        body,
        options,
        body => (id = connection.send(body)),
        rid => {
          if (id !== undefined) {
            if (!connection.cancel(id)) connection.send({ cancel: rid })
          } else {
            connection.send({ cancel: rid })
          }
          ch.cancel(rid)
          id = undefined
        },
        sender,
      )
    },
    async subscribe(path: string, body: any, event: (body: any) => void, options?: SendOptions): Promise<Cancellable> {
      return new Promise((success, failure) => {
        let id: number | undefined
        let rid: number | undefined
        let ended = false
        let resolved = false
        let topic: string | undefined
        let removeTopic: (() => boolean) | undefined
        // Stops waiting for responses and removes the request from the replay set
        const end = () => {
          ended = true
          if (rid !== undefined) ch.cancel(rid)
          if (id !== undefined) connection.sent(id)
          rid = id = undefined
        }
        const leave = () => {
          if (removeTopic?.() && topic) connection.notify({ unsub: topic })
          removeTopic = topic = undefined
        }
        const subscription: Cancellable = {
          cancel() {
            end()
            leave()
          },
        }
        const request = ch.makeSubscription(
          path,
          body,
          options?.context,
          response => {
            if (response.error) {
              // A refused resubscription ends the subscription too
              subscription.cancel()
              if (!resolved) failure(ChannelError.from(response))
              resolved = true
              return
            }
            if (!response.topic) {
              end() // one-shot
              leave()
            } else if (response.topic !== topic) {
              leave()
              topic = response.topic
              removeTopic = connection.addTopic(topic, event)
            }
            // The snapshot, again after every resubscription
            if ('body' in response) event(response.body)
            if (!resolved) success(subscription)
            resolved = true
          },
          sender,
        )
        rid = request.id
        id = connection.send(request)
        if (ended) connection.sent(id)
      })
    },
    stop() {
      connection.stop()
    },
  }
  return sender
}

class Values {
  ch: Channel<any>
  path: string
  body: any | undefined
  options?: SendOptions
  isRunning = false
  pending: ((response: Response) => void)[] = []
  queued: Response[] = []
  rid: number | undefined
  onSend: (body: any) => void
  onCancel: (id: number) => void
  sender: Sender
  constructor(
    ch: Channel<any>,
    path: string,
    body: any | undefined,
    options: SendOptions | undefined,
    onSend: (body: any) => void,
    onCancel: (id: number) => void,
    sender: Sender,
  ) {
    this.ch = ch
    this.path = path
    this.body = body
    this.options = options
    this.onSend = onSend
    this.onCancel = onCancel
    this.sender = sender
  }

  private start() {
    if (this.isRunning) return
    this.isRunning = true
    const request = this.ch.makeStream(
      this.path,
      this.body,
      this.options?.context,
      response => {
        const pendingPromise = this.pending.shift()
        if (pendingPromise) {
          pendingPromise(response)
        } else {
          this.queued.push(response)
        }
      },
      this.sender,
    )
    this.rid = request.id
    this.onSend(request)
  }
  private processResponse(response: Response): IteratorValue<any> {
    if (response.error) throw ChannelError.from(response)
    return { value: response.body, done: response.done ? true : false }
  }
  async next(): Promise<IteratorValue<any>> {
    const queued = this.queued.shift()
    if (queued) return this.processResponse(queued)
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
    this.rid = undefined
  }
  [Symbol.asyncIterator]() {
    return this
  }
}

interface IteratorValue<T> {
  value: T
  done: boolean
}
