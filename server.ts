import type { ServerWebSocket } from "bun"
import { Channel } from "./channel"
import type { SubscriptionEvent } from "./events"
export { Channel }

declare module "./channel" {
  interface Channel {
    listen(port: number): void
  }
}

Channel.prototype.listen = function <Body>(port: number) {
  const channel = this
  const ws = Bun.serve({
    port,
    hostname: '127.0.0.1',
    async fetch(req, server) {
      if (server.upgrade(req, { data: {} })) return
      return new Response()
    },
    websocket: {
      open(ws: ServerWebSocket<Body>) {

      },
      close(ws: ServerWebSocket<Body>) {

      },
      message(ws: ServerWebSocket<Body>, message: any) {
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
          event() {

          }
        })
      },
    },
  })
  const publisher = {
    publish(event: SubscriptionEvent) {
      ws.publish(event.topic, JSON.stringify(event))
    }
  }
  this._events?.forEach(a => a.publishers.push(publisher))
  return channel
}
