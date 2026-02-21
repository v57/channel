import type { ServerWebSocket, Server } from 'bun'
import { Channel, makeSender, type EventBody, type SubscriptionEvent, type Sender } from './channel'
export { Channel, type Sender, ObjectMap, Subscription } from './channel'

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
  state?: (headers: Record<string, string | undefined>) => Promise<State> | State
  onConnect?: (connection: BodyContext<State>) => void
  onDisconnect?: (connection: BodyContext<State>) => void
}

class Subscriptions {
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
  let hostname: string = '127.0.0.1'
  if (typeof address === 'string') {
    const [h, p] = address.split(':')
    hostname = h
    port = Number(p) ?? 80
  } else {
    port = address
  }
  const ws = Bun.serve({
    port,
    hostname,
    async fetch(req, server) {
      const makeState = options?.state
      if (makeState) {
        let headers: Record<string, string | undefined> = Object.create(null)
        new URL(req.url).searchParams.forEach((value, key) => (headers[key] = value))
        req.headers.forEach((value, key) => (headers[key] = value))
        if (server.upgrade(req, { data: { state: await makeState(headers) } })) return
      } else {
        if (server.upgrade(req, { data: { state: {} } })) return
      }
      return new Response()
    },
    websocket: {
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
  return ws
}
