import { Channel, ObjectMap, makeSender } from './channel'
import type { Cancellable, EventBody, Sender, SubscriptionEvent, Subscription } from './channel'
export { Channel, ChannelError, ObjectMap, type Sender } from './channel'

declare module './channel' {
  interface Channel<State> {
    connect(address: string | number, options?: Options): ClientSender
  }
}

export interface Options {
  /** Evaluated before every connection attempt, can be async */
  headers?(): any
  onConnect?(sender: Sender): Promise<void>
  /** Default timeout in seconds for every post and subscription. None by default. */
  requestTimeout?: number
  /**
   * Seconds between pings, 15 by default, 0 disables them. Without a pong within 10 s the client reconnects.
   * Bun only: browsers can't send pings, the server's pings keep their connections open.
   */
  pingInterval?: number
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'

/** What the client needs from a socket. Other transports (`quic.ts`) register one for their address scheme. */
export interface Socket {
  onopen: ((event: any) => void) | null
  onclose: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onmessage: ((event: any) => void) | null
  send(data: string): void
  close(): void
}

export interface ClientSender extends Sender {
  ws: WebSocketClient
  readonly state: ConnectionState
  /** Calls `observer` with the current state, then with every change */
  onStateChange(observer: (state: ConnectionState) => void): Cancellable
  /** Resets the reconnect backoff and, when waiting to retry, connects at once (on network changes, coming to the foreground) */
  reconnectNow(): void
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
  ws.onfail = request => ch.fail(request.id, 'disconnected')
  ws.onstop = () => ch.failAll(sender)
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
  return {
    ...sender,
    ws,
    get state() {
      return ws.state
    },
    onStateChange: observer => ws.onStateChange(observer),
    reconnectNow: () => ws.reconnectNow(),
  }
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
  /** Pending requests sent with `replay: false` */
  noReplay = new Set<number>()
  /** A pending `replay: false` request is dropped with the connection */
  onfail?: (request: any) => void
  onstop?: () => void
  private isWaiting = 0
  private isWaitingLength = 0
  queue: any[] = []
  isConnected: boolean = false
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  isRunning = true
  /** Failed connection attempts since the last open, drives the reconnect backoff */
  attempts = 0
  /** Seconds to wait for a pong */
  static pongTimeout = 10
  state: ConnectionState = 'connecting'
  private observers = new Set<(state: ConnectionState) => void>()
  private retry?: ReturnType<typeof setTimeout>
  private stopPings?: () => void
  get requestTimeout() {
    return this.options.requestTimeout
  }
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
    this.setState('connecting')

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
      this.startPings(ws)
      this.setState('connected')
      await this.onopen?.()
      ws.send(JSON.stringify(this.pending.map(a => a)))
    }
    ws.onerror = c => {
      // This address doesn't have a websocket server, or refused the connection (404 path, 401 state)
      // @ts-ignore
      if (c?.message?.includes('101')) this.stop()
    }
    ws.onclose = c => {
      const opened = this.ws === ws
      this.isConnected = false
      this.ws = undefined
      this.stopPings?.()
      this.stopPings = undefined
      this.setState('disconnected')
      // Everything pending was written to this socket
      if (opened && this.noReplay.size) {
        for (const id of this.noReplay) {
          const request = this.pending.get(id)
          this.pending.delete(id)
          if (request) this.onfail?.(request)
        }
        this.noReplay.clear()
      }
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
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.start()
    }, delay * (0.5 + Math.random() / 2))
  }
  reconnectNow() {
    this.attempts = 0
    if (this.retry === undefined || !this.isRunning) return
    clearTimeout(this.retry)
    this.retry = undefined
    this.start()
  }
  onStateChange(observer: (state: ConnectionState) => void): Cancellable {
    this.observers.add(observer)
    observer(this.state)
    return { cancel: () => this.observers.delete(observer) }
  }
  private setState(state: ConnectionState) {
    if (this.state === state) return
    this.state = state
    for (const observer of [...this.observers]) {
      try {
        observer(state)
      } catch {}
    }
  }
  /** Pings in Bun, whose client WebSocket has `ping()` and a `pong` event. Browsers have neither. */
  private startPings(ws: Socket) {
    const interval = this.options.pingInterval ?? 15
    const socket = ws as any
    if (!interval || typeof socket.ping !== 'function' || typeof socket.addEventListener !== 'function') return
    let waiting: ReturnType<typeof setTimeout> | undefined
    socket.addEventListener('pong', () => {
      clearTimeout(waiting)
      waiting = undefined
    })
    const timer = setInterval(() => {
      if (waiting !== undefined) return
      try {
        socket.ping()
      } catch {}
      waiting = setTimeout(() => {
        // No pong: the connection is gone without a close, so don't wait for the closing handshake either
        if (typeof socket.terminate === 'function') socket.terminate()
        else ws.close()
      }, WebSocketClient.pongTimeout * 1000)
    }, interval * 1000)
    this.stopPings = () => {
      clearInterval(timer)
      clearTimeout(waiting)
    }
  }
  /** Stops reconnecting and fails every pending call with `disconnected` */
  stop() {
    this.isRunning = false
    if (this.retry !== undefined) clearTimeout(this.retry)
    this.retry = undefined
    this.setState('disconnected')
    this.pending = new ObjectMap()
    this.noReplay.clear()
    this.ws?.close()
    this.onstop?.()
  }
  send(body: any, replay?: boolean): number {
    const id = this.id++
    this.pending.set(id, body)
    if (replay === false) this.noReplay.add(id)
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
    if (this.noReplay.size) this.noReplay.delete(id)
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
