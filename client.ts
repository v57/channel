import { Channel, ObjectMap, makeSender } from './channel'
import type { EventBody, Sender, SubscriptionEvent, Subscription } from './channel'
export { Channel, ChannelError, ObjectMap, type Sender } from './channel'

declare module './channel' {
  interface Channel<State> {
    connect(address: string | number, options?: Options): ClientSender
  }
}

export interface Options {
  headers?(): any
  onConnect?(sender: Sender): Promise<void>
}

/** What the client needs from a socket. Other transports (`quic.ts`) register one for their address scheme. */
export interface Socket {
  onopen: ((event: any) => void) | null
  onclose: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onmessage: ((event: any) => void) | null
  send(data: string): void
  close(): void
}

interface ClientSender extends Sender {
  ws: WebSocketClient
}

Channel.prototype.connect = function (address: string | number, options: Options = {}) {
  const ch = this
  const ws = new WebSocketTopics(typeof address === 'string' ? address : `ws://localhost:${address}`, options.headers, options)
  let topics = new Set<string>()
  const sender = makeSender(ch, ws)
  let state = Object.create(null)
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
  const publishers: Array<{
    subscription: Subscription
    publish: { publish(event: SubscriptionEvent): void }
  }> = []
  let removedPublishers = false
  // Events from `channel.publish`, for topics the server subscribed to
  const transport = {
    publish(event: SubscriptionEvent) {
      if (topics.has(event.topic)) ws.notify(event)
    },
  }
  ch.transports.push(transport)
  const cleanupPublishers = () => {
    if (removedPublishers) return
    removedPublishers = true
    const index = ch.transports.indexOf(transport)
    if (index >= 0) ch.transports.splice(index, 1)
    for (const item of publishers) {
      const index = item.subscription.publishers.indexOf(item.publish)
      if (index >= 0) item.subscription.publishers.splice(index, 1)
    }
  }
  ws.onclose = () => {
    if (!ws.isRunning) {
      cleanupPublishers()
    }
    ch.disconnect(state, sender, ws.isRunning)
  }
  ws.onmessage = message => ch.receive(message, controller)
  this.eventsApi?.forEach(subscription => {
    const publisher = {
      publish(event: SubscriptionEvent) {
        if (!topics.has(event.topic)) return
        ws.notify(event)
      },
    }
    subscription.publishers.push(publisher)
    publishers.push({ subscription, publish: publisher })
  })
  return { ...sender, ws }
}

export class WebSocketClient {
  static isBun = globalThis.Bun?.env ? true : false
  /** Socket types by address scheme (`quic` once `channel/quic` is imported), WebSocket for the rest */
  static sockets: Record<string, new (address: string, headers: Record<string, string>, options: Options) => Socket> = {}
  id = 0
  address: string
  options: Options
  ws?: Socket
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
  /** Failed connection attempts since the last open, drives the reconnect backoff */
  attempts = 0
  constructor(
    address: string,
    headers?: () => Record<string, string> | Promise<Record<string, string>>,
    options: Options = {},
  ) {
    this.address = address
    this.headers = headers
    this.options = options
    this.start()
  }
  async start() {
    if (!this.isRunning) return

    let ws: Socket
    const Custom = WebSocketClient.sockets[this.address.slice(0, this.address.indexOf(':'))]
    if (Custom) {
      ws = new Custom(this.address, (await this.headers?.()) ?? {}, this.options)
    } else if (this.headers) {
      if (WebSocketClient.isBun) {
        // @ts-ignore
        ws = new WebSocket(this.address, this.headers ? { headers: await this.headers() } : undefined)
      } else {
        const url = new URL(this.address)
        const headers = await this.headers()
        Object.entries(headers).forEach(([key, value]) => {
          if (value) url.searchParams.set(key, value)
        })
        ws = new WebSocket(url.toString())
      }
    } else {
      ws = new WebSocket(this.address)
    }
    ws.onopen = async () => {
      if (!this.isRunning) return ws.close()
      this.isConnected = true
      this.attempts = 0
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
      this.reconnect()
    }
    ws.onmessage = message => {
      if (typeof message.data !== 'string') return
      let value: any
      try {
        value = JSON.parse(message.data)
      } catch {
        // Same as the server: a peer that sends invalid JSON gets disconnected
        ws.close()
        return
      }
      this.onmessage?.(value)
    }
  }
  /** Retries after 100 ms, doubling up to 5 s while the server stays down, each delay randomized to 50-100% */
  reconnect() {
    if (!this.isRunning) return
    const delay = Math.min(5000, 100 * 2 ** this.attempts++)
    setTimeout(() => this.start(), delay * (0.5 + Math.random() / 2))
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
        if (this.isWaitingLength > 4000) {
          this.isWaiting = 3
        }
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
