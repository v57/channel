import { ObjectMap } from "./map"

type Function = (body: any) => any | Promise<any>

export class Channel {
  private id = 0
  requests = new Map<number, PendingRequest>()
  private postApi = new ObjectMap<string, Function>
  constructor() { }
  makeRequest(path: string, body: any | undefined, response: (response: Response) => void): Request {
    const id = this.id++
    const pending: PendingRequest = {
      request: { id, path, body }, response
    }
    this.requests.set(id, pending)
    return { id, path, body }
  }
  cancel(id: number) {
    this.requests.delete(id)
  }
  post(path: string, request: Function) {
    this.postApi.set(path, request)
    return this
  }
  receive(some: any, response: (response: any) => void) {
    if (Array.isArray(some)) {
      some.forEach(a => this.receiveOne(a, response))
    } else {
      this.receiveOne(some, response)
    }
  }
  receiveOne(some: any, response: (response: any) => void) {
    if (some.path) {
      const id: number | undefined = some.id
      const api = this.postApi.get(some.path)
      try {
        if (!api) throw 'api not found'
        const body = api(some.body)
        if (id !== undefined) {
          if (body.then) {
            body.then((a: any) => {
              response({ id, body: a })
            })
          } else {
            response({ id, body })
          }
        }
      } catch (e) {
        if (id !== undefined) response({ id, error: `${e}` })
      }
    } else if (some.id !== undefined) {
      const request = this.requests.get(some.id)
      this.requests.delete(some.id)
      if (request) request.response(some)
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
