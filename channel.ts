import type { Subscription } from "./events"
import { ObjectMap } from "./map"
import type { Sender } from "./sender"

type Function<State> = (body: { body: any, sender: Sender, state: State }) => any | Promise<any>
type Stream<State> = (body: { body: any, sender: Sender, state: State }) => AsyncGenerator<any, void, any>
export type EventBody = (body: any) => void
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
  publish: (topic: string, body: any) => void = () => { }
  requests = new Map<number, PendingRequest>()
  private postApi = new ObjectMap<string, Function<State>>
  private streamApi = new ObjectMap<string, Stream<State>>
  private streams = new ObjectMap<number, AsyncGenerator<any, void, any>>
  _events?: Map<string, Subscription>
  constructor() { }
  makeRequest(path: string, body: any | undefined, response: (response: Response) => void): Request {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, path, body }, response
    }
    this.requests.set(id, pending)
    return { id, path, body }
  }
  makeStream(stream: string, body: any | undefined, response: (response: Response) => void): StreamRequest {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, stream, body }, response
    }
    this.requests.set(id, pending)
    return { id, stream, body }
  }
  makeSubscription(sub: string, body: any | undefined, response: (response: Response) => void): SubscriptionRequest {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, sub, body }, response
    }
    this.requests.set(id, pending)
    return { id, sub, body }
  }
  cancel(id: number) {
    this.requests.delete(id)
  }
  post(path: string, request: Function<State>) {
    this.postApi.set(path, request)
    return this
  }
  stream(path: string, request: Stream<State>) {
    this.streamApi.set(path, request)
    return this
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
      const api = this.postApi.get(some.path)
      try {
        if (!api) throw 'api not found'
        const body = api({ body: some.body, sender: controller.sender, state: controller.state })
        if (id !== undefined) {
          if (body?.then) {
            body.then((a: any) => {
              controller.response({ id, body: a })
            })
          } else {
            controller.response({ id, body })
          }
        }
      } catch (e) {
        if (id !== undefined) controller.response({ id, error: `${e}` })
      }
    } else if (some.stream) {
      const id: number | undefined = some.id
      const api = this.streamApi.get(some.stream)
      if (!api) throw 'api not found'
      if (id === undefined) throw 'stream requires id'
      this.streamRequest(id, controller, some.body, api)
    } else if (some.cancel !== undefined) {
      const id: number | undefined = some.cancel
      if (id === undefined) throw 'stream requires id'
      this.streams.get(id)?.return()
    } else if (some.sub) {
      const id: number | undefined = some.id
      const subscription = this._events?.get(some.sub)
      try {
        if (!subscription) throw 'subscription not found'
        let topic = subscription._topic(some.body)
        if (topic.length === 0) topic = subscription.prefix
        else topic = subscription.prefix + '/' + topic
        const body = subscription._body(some.body)
        if (body?.then) {
          body.then((a: any) => {
            controller.subscribe(topic)
            controller.response({ id, topic, body: a })
          })
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
  private async streamRequest(id: number, controller: Controller<State>, body: any, stream: Stream<State>) {
    try {
      const values = stream({ body, sender: controller.sender, state: controller.state })
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
  events(events: Map<string, Subscription>) {
    this._events = events
    return this
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
