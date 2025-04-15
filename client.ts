import { Channel } from "./channel"
import { ObjectMap } from "./map"
export { Channel }
import { makeSender, type Sender } from "./sender"

declare module "./channel" {
  interface Channel {
    connect(address: string | number): Sender
  }
}

Channel.prototype.connect = function (address: string | number): Sender {
  const ch = this
  const ws = new WebSocketTopics(typeof address === 'string' ? address : `ws://localhost:${address}`)
  let topics = new Set<string>()

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
        ws.receivedEvent(topic, body)
      }
    })
  }
  const sender = makeSender(ch, ws)
  return sender
}

export class WebSocketClient {
  id = 0
  address: string
  ws?: WebSocket
  onopen: (() => void) | undefined
  onmessage: ((message: any) => void) | undefined
  pending = new ObjectMap<number, any>()
  private isWaiting = 0
  private isWaitingLength = 0
  queue: any[] = []
  isConnected: boolean = false
  constructor(address: string) {
    this.address = address
    this.start()
  }
  start() {
    const ws = new WebSocket(this.address)
    ws.onopen = () => {
      this.isConnected = true
      this.ws = ws
      this.onopen?.()
      ws.send(JSON.stringify(this.pending.map(a => a)))
    }
    ws.onclose = () => {
      this.isConnected = false
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
    this.pending = new ObjectMap()
    this.ws?.close()
  }
  send(body: any): number {
    const id = this.id++
    this.pending.set(id, body)
    if (!this.ws) { return id }
    switch (this.isWaiting) {
      case 0:
        this.ws.send(JSON.stringify(body))
        this.isWaiting = 1
        this.isWaitingLength = 0
        setTimeout(() => {
          if (this.isWaitingLength > 4000) {
            this.isWaiting = 3
          }
        }, 10)
        break
      case 1:
        this.ws.send(JSON.stringify(body))
        this.isWaitingLength += 1
        break
      case 2:
        this.queue.push(body)
        break
      case 3:
        this.ws.send(JSON.stringify(body))
        this.isWaiting = 2
        setTimeout(() => {
          this.isWaiting = 3
          if (this.queue.length) {
            this.ws?.send(JSON.stringify(this.queue))
            this.queue.splice(0)
          }
        }, 1)
    }
    return id
  }
  cancel(id: number): boolean {
    if (this.isConnected) return false
    if (!this.pending.get(id)) return false
    this.pending.delete(id)
    return true
  }
  notify(body: any) {
    this.ws?.send(JSON.stringify(body))
  }
  sent(id: number) {
    this.pending.delete(id)
  }
}
type EventBody = (body: any) => void
class WebSocketTopics extends WebSocketClient {
  subscribed = new Map<string, Map<number, EventBody>>()
  addTopic(topic: string, event: EventBody): () => boolean {
    const id = ++this.id
    let map = this.subscribed.get(topic)
    if (map) {
      map.set(id, event)
    } else {
      map = new Map<number, EventBody>()
      map.set(id, event)
      this.subscribed.set(topic, map)
    }
    return () => {
      map.delete(id)
      if (map.size) return false
      this.subscribed.delete(topic)
      return true
    }
  }
  receivedEvent(topic: string, event: any) {
    this.subscribed.get(topic)?.forEach(a => a(event))
  }
}
