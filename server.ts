import type { ServerWebSocket, Server } from 'bun'
import { Channel, makeSender, type EventBody, type SubscriptionEvent, type Sender } from './channel'
export { Channel, type Sender, ObjectMap } from './channel'

declare module './channel' {
  interface Channel<State> {
    listen(port: number, state?: (headers: Headers) => Promise<State> | State): Server
  }
}

interface BodyContext<State> {
  state: State
  sender: Sender
  subscriptions: Subscriptions
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

Channel.prototype.listen = function <State>(
  port: number,
  state?: (headers: Headers) => Promise<State> | State,
): Server {
  const channel = this
  const ws = Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req, server) {
      if (server.upgrade(req, { data: { state: (await state?.(req.headers)) ?? {} } })) return
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
      },
      close(ws: ServerWebSocket<BodyContext<State>>) {
        channel.disconnect(ws.data.state, ws.data.sender)
      },
      message(ws: ServerWebSocket<BodyContext<State>>, message: any) {
        if (typeof message !== 'string') return
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
