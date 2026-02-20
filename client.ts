import { Channel, ObjectMap, type EventBody, makeSender, type Sender, type SubscriptionEvent } from './channel'
export { Channel, ObjectMap, type Sender } from './channel'

declare module './channel' {
  interface Channel<State> {
    connect(address: string | number, options?: Options): ClientSender
  }
}

interface Options {
  headers?(): any
  onConnect?(sender: Sender): Promise<void>
}

interface ClientSender extends Sender {
  ws: WebSocketClient
}

Channel.prototype.connect = function (address: string | number, options: Options = {}) {
  const ch = this
  const ws = new WebSocketTopics(typeof address === 'string' ? address : `ws://localhost:${address}`, options.headers)
  let topics = new Set<string>()
  const sender = makeSender(ch, ws)
  let state = {}
  const onConnect = options.onConnect
  if (onConnect) ws.onopen = () => onConnect(sender)
  const controller = {
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
    },
    sender,
    state,
  }
  ws.onclose = () => ch.disconnect(state, sender)
  ws.onmessage = message => ch.receive(message, controller)
  this.eventsApi?.forEach(a =>
    a.publishers.push({
      publish(event: SubscriptionEvent) {
        if (!topics.has(event.topic)) return
        ws.send(event)
      },
    }),
  )
  return { ...sender, ws }
}

export class WebSocketClient {
  id = 0
  address: string
  ws?: WebSocket
  onopen: (() => Promise<void>) | undefined
  onclose?: () => void
  onmessage: ((message: any) => void) | undefined
  pending = new ObjectMap<number, any>()
  private isWaiting = 0
  private isWaitingLength = 0
  queue: any[] = []
  isConnected: boolean = false
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  isRunning = true
  constructor(address: string, headers?: () => Record<string, string> | Promise<Record<string, string>>) {
    this.address = address
    this.headers = headers
    this.start()
  }
  async start() {
    if (!this.isRunning) return

    let ws: WebSocket
    if (this.headers) {
      if (globalThis.Bun?.env) {
        // @ts-ignore
        ws = new WebSocket(this.address, this.headers ? { headers: await this.headers() } : undefined)
      } else {
        const url = new URL(this.address)
        const headers = await this.headers()
        Object.entries(headers).forEach(([key, value]) => {
          if (value) url.searchParams.set(key, value)
        })
        ws = new WebSocket(this.address)
      }
    } else {
      ws = new WebSocket(this.address)
    }
    ws.onopen = async () => {
      this.isConnected = true
      this.ws = ws
      await this.onopen?.()
      ws.send(JSON.stringify(this.pending.map(a => a)))
    }
    ws.onerror = c => {
      // @ts-ignore
      if (c?.message?.includes('101')) this.isRunning = false // This address doesn't have websocket server or not accepting incoming connections
    }
    ws.onclose = c => {
      this.isConnected = false
      this.ws = undefined
      this.onclose?.()
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
    this.isRunning = false
    this.pending = new ObjectMap()
    this.ws?.close()
  }
  send(body: any): number {
    const id = this.id++
    this.pending.set(id, body)
    if (!this.ws) {
      return id
    }
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
  throttle() {
    this.isWaiting = 3
  }
}

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
