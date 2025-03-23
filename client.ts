import { Channel } from "./channel"
import { ObjectMap } from "./map"
export { Channel }

interface ClientInterface {
  send(path: string, body?: any): Promise<any>
}

declare module "./channel" {
  interface Channel {
    connect(address: string): ClientInterface
  }
}

Channel.prototype.connect = function (address: string): ClientInterface {
  const ch = this
  const ws = new WebSocketClient(address)
  ws.onmessage = (message) => {
    ch.receive(message, (body) => {
      ws.notify(body)
    })
  }
  return {
    async send(path: string, body?: any): Promise<any> {
      console.log(`Client: ${path} ${body}`)
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
