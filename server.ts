import type { ServerWebSocket, Server } from 'bun'
import { Channel, makeSender, type EventBody, type SubscriptionEvent, type Sender } from './channel'
export { Channel, ChannelError, type Sender, ObjectMap, Subscription } from './channel'

declare module './channel' {
  interface Channel<State> {
    listen(port: number | string, options?: ListenOptions<State>): Server
  }
}

export interface BodyContext<State> {
  state: State
  sender: Sender
  subscriptions: Subscriptions
}

export interface ListenOptions<State> {
  /**
   * Makes the connection state from the upgrade request's headers and query parameters, plus `x-hub-remote-ip`.
   * Throwing (or rejecting) refuses the connection with 401.
   */
  state?: (headers: Record<string, string | undefined>) => Promise<State> | State
  /** Upgrades only requests whose URL path matches, others get 404. Any path by default. */
  path?: string | ((path: string) => boolean)
  /** Largest incoming message in bytes, bigger ones close the connection. 16 MiB by default. */
  maxPayload?: number
  /** Seconds without messages before Bun closes the connection. 120 by default. */
  idleTimeout?: number
  /** Bun's per-message deflate. Off by default. */
  perMessageDeflate?: boolean
  onConnect?: (connection: BodyContext<State>) => void
  onDisconnect?: (connection: BodyContext<State>) => void
}

export class Subscriptions {
  id = 0
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

Channel.prototype.listen = function <State>(address: number | string, options?: ListenOptions<State>): Server {
  const channel = this
  let port: number
  let hostname: string = '0.0.0.0'
  if (typeof address === 'string') {
    const [h, p] = address.split(':')
    hostname = h
    port = Number(p) ?? 80
  } else {
    port = address
  }
  let matches = options?.path
  if (typeof matches === 'string') {
    const path = matches.startsWith('/') ? matches : '/' + matches
    matches = a => a === path
  }
  const ws = Bun.serve({
    port,
    hostname,
    async fetch(req, server) {
      if (matches && !matches(new URL(req.url).pathname)) return new Response('not found', { status: 404 })
      const makeState = options?.state
      if (makeState) {
        let headers: Record<string, string | undefined> = Object.create(null)
        new URL(req.url).searchParams.forEach((value, key) => (headers[key] = value))
        req.headers.forEach((value, key) => (headers[key] = value))
        const remote = server.requestIP(req)
        headers['x-hub-remote-ip'] = remote?.address
        let state: State
        try {
          state = await makeState(headers)
        } catch {
          return new Response('unauthorized', { status: 401 })
        }
        if (server.upgrade(req, { data: { state } })) return
      } else {
        if (server.upgrade(req, { data: { state: {} } })) return
      }
      return new Response()
    },
    websocket: {
      maxPayloadLength: options?.maxPayload ?? 16 * 1024 * 1024,
      idleTimeout: options?.idleTimeout ?? 120,
      perMessageDeflate: options?.perMessageDeflate ?? false,
      open(ws: ServerWebSocket<BodyContext<State>>) {
        ws.data.subscriptions = new Subscriptions()
        ws.data.sender = makeSender(channel, {
          send(body: any): number {
            ws.send(JSON.stringify(body))
            return 0
          },
          sent(id: number) {},
          cancel(id: number): boolean {
            return false
          },
          notify(body: any): void {
            ws.send(JSON.stringify(body))
          },
          addTopic(topic: string, event: (body: any) => void): () => boolean {
            return ws.data.subscriptions.addTopic(topic, event)
          },
          stop(): void {
            ws.close()
          },
        })
        options?.onConnect?.(ws.data)
      },
      close(ws: ServerWebSocket<BodyContext<State>>) {
        channel.disconnect(ws.data.state, ws.data.sender)
        options?.onDisconnect?.(ws.data)
      },
      message(ws: ServerWebSocket<BodyContext<State>>, message: any) {
        if (typeof message !== 'string') return
        try {
          const req = JSON.parse(message)
          channel.receive(req, {
            response(body: string) {
              ws.send(JSON.stringify(body))
            },
            subscribe(topic: string) {
              ws.subscribe(topic)
            },
            unsubscribe(topic: string) {
              ws.unsubscribe(topic)
            },
            event(topic: string, event: any) {
              ws.data.subscriptions.receivedEvent(topic, event)
            },
            sender: ws.data.sender,
            state: ws.data.state,
          })
        } catch {
          ws.close()
        }
      },
    },
  })
  const publisher = {
    publish(event: SubscriptionEvent) {
      ws.publish(event.topic, JSON.stringify(event))
    },
  }
  this.eventsApi?.forEach(a => a.publishers.push(publisher))
  this.transports.push(publisher)
  let removedPublisher = false
  const cleanupPublisher = () => {
    if (removedPublisher) return
    removedPublisher = true
    const index = channel.transports.indexOf(publisher)
    if (index >= 0) channel.transports.splice(index, 1)
    this.eventsApi?.forEach(subscription => {
      const index = subscription.publishers.indexOf(publisher)
      if (index >= 0) subscription.publishers.splice(index, 1)
    })
  }
  const stop = ws.stop.bind(ws)
  ;(ws as any).stop = (...args: any[]) => {
    cleanupPublisher()
    return stop(...args)
  }
  return ws
}
