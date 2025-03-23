import { ObjectMap } from "./map"

type Function = (body: any) => any | Promise<any>
export class Channel {
  private id = 0
  private requests = new Map<number, PendingRequest>()
  private postApi = new ObjectMap<string, Function>
  constructor() { }
  fastSend(channel: Channel, path: string, body: any | undefined, response: (response: Response) => void) {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, path, body }, response
    }
    this.requests.set(id, pending)
    channel.receive(this, { id, path, body })
  }
  send(channel: Channel, path: string, body?: any): Promise<any> {
    return new Promise((s, e) => {
      this.fastSend(channel, path, body, (response) => {
        if (response.error) {
          e(response.error)
        } else {
          s(response.body)
        }
      })
    })
  }
  cancel(id: number) {
    this.requests.delete(id)
  }
  post(path: string, request: Function) {
    this.postApi.set(path, request)
    return this
  }
  receive(channel: Channel, some: any) {
    this.receiveOne(channel, some)
  }
  receiveOne(channel: Channel, some: any) {
    if (some.path) {
      const id: number | undefined = some.id
      const api = this.postApi.get(some.path)
      try {
        if (!api) throw 'api not found'
        const body = api(some.body)
        if (id !== undefined) {
          if (body.then) {
            body.then((a: any) => {
              channel.receive(this, { id, body: a })
            })
          } else {
            channel.receive(this, { id, body })
          }
        }
      } catch (e) {
        if (id !== undefined) channel.receive(this, { id, error: `${e}` })
      }
    } else if (some.id !== undefined) {
      const request = this.requests.get(some.id)
      this.requests.delete(some.id)
      if (request) {
        request.response(some)
      }
    }
  }
}

interface PendingRequest {
  request: Request
  response: (response: Response) => void
}
interface Request {
  id: number
  path: string
  body?: any
}
interface Response {
  id: number
  body?: any
  error?: any
}
