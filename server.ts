import type { ServerWebSocket } from "bun"
import { Channel } from "./channel"
export { Channel }

declare module "./channel" {
  interface Channel {
    listen(port: number): void
  }
}

Channel.prototype.listen = function <Body>(port: number) {
  const channel = this
  Bun.serve({
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
        if (typeof message != 'string') return
        const req = JSON.parse(message)
        channel.receive(req, (response) => {
          ws.send(JSON.stringify(response))
        })
      },
    },
  })
  return channel
}
