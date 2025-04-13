import { Channel } from "./channel"
import { ObjectMap } from "./map"
export { Channel }

interface ClientInterface {
  send(path: string, body?: any): Promise<any>
  subscribe(path: string, body: any | undefined, event: (body: any) => void): Promise<any>
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
          ws.sent(id)
        })
        ws.send(id, request)
      })
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
  request(): number {
    return this.id++
  }
  send(id: number, body: any): number {
    this.pending.set(id, body)
    this.ws?.send(JSON.stringify(body))
    return id
  }
  notify(body: any) {
    this.ws?.send(body)
  }
  sent(id: number) {
    this.pending.delete(id)
  }
}
