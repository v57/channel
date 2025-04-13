import type { Subscription } from "./events"
import { ObjectMap } from "./map"

type Function = (body: any) => any | Promise<any>
interface Controller {
  response: (response: any) => void
  subscribe: (topic: string) => void
  unsubscribe: (topic: string) => void
  event: (topic: string, event: any) => void
}

export class Channel {
  private id = 0
  publish: (topic: string, body: any) => void = () => { }
  requests = new Map<number, PendingRequest>()
  private postApi = new ObjectMap<string, Function>
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
  post(path: string, request: Function) {
    this.postApi.set(path, request)
    return this
  }
  receive(some: any, controller: Controller) {
    if (Array.isArray(some)) {
      some.forEach(a => this.receiveOne(a, controller))
    } else {
      this.receiveOne(some, controller)
    }
  }
  receiveOne(some: any, controller: Controller) {
    if (some.path) {
      const id: number | undefined = some.id
      const api = this.postApi.get(some.path)
      try {
        if (!api) throw 'api not found'
        const body = api(some.body)
        if (id !== undefined) {
          if (body.then) {
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
      this.requests.delete(some.id)
      if (request) request.response(some)
    }
  }
  events(events: Map<string, Subscription>) {
    this._events = events
    return this
  }
}

interface PendingRequest {
  request: Request | SubscriptionRequest
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
interface Response {
  id: number
  topic?: string
  body?: any
  error?: any
}
