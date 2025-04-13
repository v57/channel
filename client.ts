import { Channel, type Response } from "./channel"
import { ObjectMap } from "./map"
export { Channel }

export interface ClientInterface {
  send(path: string, body?: any): Promise<any>
  values(path: string, body?: any): Values
  subscribe(path: string, body: any | undefined, event: (body: any) => void): Promise<string>
  unsubscribe(topic: string): void
  stop(): void
}

declare module "./channel" {
  interface Channel {
    connect(address: string | number): ClientInterface
  }
}

Channel.prototype.connect = function (address: string | number): ClientInterface {
  const ch = this
  const ws = new WebSocketClient(typeof address === 'string' ? address : `ws://localhost:${address}`)
  let topics = new Set<string>()
  let subscribed = new Map<string, (body: any) => void>()
  let isWaiting = false

  ws.onmessage = (message) => {
    ch.receive(message, {
      response(body: string) {
        ws.notify(body)
      },
      subscribe(topic: string) {
        topics.add(topic)
      },
      unsubscribe(topic: string) {
        topics.delete(topic)
      },
      event(topic: string, body: any) {
        subscribed.get(topic)?.(body)
      }
    })
  }
  return {
    async send(path: string, body?: any): Promise<any> {
      return new Promise((success, failure) => {
        const id = ws.request()
        const request = ch.makeRequest(path, body, (response) => {
          if (response.error) {
            failure(response.error)
          } else {
            success(response.body)
          }
        })
        ws.send(id, request)
      })
    },
    values(path: string, body?: any) {
      return new Values(ws.request(), ws, ch, path, body)
    },
    async subscribe(path: string, body: any, event: (body: any) => void): Promise<string> {
      return new Promise((success, failure) => {
        const id = ws.request()
        const request = ch.makeSubscription(path, body, (response) => {
          if (response.error) {
            failure(response.error)
          } else {
            const topic = response.topic!
            subscribed.set(topic, event)
            success(topic)
          }
          ws.sent(id)
        })
        ws.send(id, request)
      })
    },
    unsubscribe(topic: string): void {
      subscribed.delete(topic)
      ws.notify({ unsub: topic })
    },
    stop() {
      ws.stop()
    }
  }
}

export class WebSocketClient {
  id = 0
  address: string
  ws?: WebSocket
  onopen: (() => void) | undefined
  onmessage: ((message: any) => void) | undefined
  pending = new ObjectMap<number, any>()
  constructor(address: string) {
    this.address = address
    this.start()
  }
  start() {
    const ws = new WebSocket(this.address)
    ws.onopen = () => {
      this.ws = ws
      this.onopen?.()
      ws.send(JSON.stringify(this.pending.map(a => a)))
    }
    ws.onclose = () => {
      this.ws = undefined
      setTimeout(() => this.start(), 100)
    }
    ws.onmessage = (message: MessageEvent<any>) => {
      if (typeof message.data === 'string') {
        const value = JSON.parse(message.data)
        this.onmessage?.(value)
      }
    }
  }
  stop() {
    this.ws?.close()
  }
  request(): number {
    return this.id++
  }
  send(id: number, body: any): number {
    this.pending.set(id, body)
    this.ws?.send(JSON.stringify(body))
    return id
  }
  notify(body: any) {
    this.ws?.send(JSON.stringify(body))
  }
  sent(id: number) {
    this.pending.delete(id)
  }
}
class Values {
  id: number
  ws: WebSocketClient
  ch: Channel
  path: string
  body: any | undefined
  isRunning = false
  pending: ((response: Response) => void)[] = []
  queued: Response[] = []
  rid: number | undefined
  constructor(id: number, ws: WebSocketClient, ch: Channel, path: string, body: any | undefined) {
    this.id = id
    this.ws = ws
    this.ch = ch
    this.path = path
    this.body = body
  }

  private start() {
    if (this.isRunning) return
    this.isRunning = true
    const request = this.ch.makeStream(this.path, this.body, (response) => {
      const pendingPromise = this.pending.shift()
      if (pendingPromise) {
        pendingPromise(response)
      } else {
        this.queued.push(response)
      }
    })
    this.rid = request.id
    this.ws.send(this.id, request)
  }
  private processResponse(response: Response): IteratorValue<any> {
    if (response.error) throw response.error
    return { value: response.body, done: response.done ? true : false }
  }
  async next(): Promise<IteratorValue<any>> {
    const result = new Promise<IteratorValue<any>>((success, failure) => {
      this.pending.push((value) => {
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
    this.ws.send(this.id, { cancel: this.rid })
  }
  [Symbol.asyncIterator]() {
    return this
  }
}

interface IteratorValue<T> {
  value: T
  done: boolean
}
