import type { Channel, Response } from './channel'

export interface Sender {
  send(path: string, body?: any): Promise<any>
  values(path: string, body?: any): Values
  subscribe(path: string, body: any | undefined, event: (body: any) => void): Promise<Cancellable>
  stop(): void
}
export interface Body<State> {
  body: any
  sender: Sender
  state: State
}

export interface Cancellable {
  cancel(): void
}

interface ConnectionInterface<RequestId = number> {
  send(body: any): RequestId
  sent(id: RequestId): void
  cancel(id: RequestId): boolean
  notify(body: any): void
  addTopic(topic: string, event: (body: any) => void): () => boolean
  stop(): void
}

export function makeSender<State>(ch: Channel<State>, connection: ConnectionInterface): Sender {
  return {
    async send(path: string, body?: any): Promise<any> {
      return new Promise((success, failure) => {
        let id: number | undefined
        const request = ch.makeRequest(path, body, response => {
          if (response.error) {
            failure(response.error)
          } else {
            success(response.body)
          }
          if (id !== undefined) {
            connection.sent(id)
          }
        })
        id = connection.send(request)
      })
    },
    values(path: string, body?: any) {
      let id: number | undefined
      return new Values(
        ch,
        path,
        body,
        body => (id = connection.send(body)),
        rid => {
          if (id && !connection.cancel(id)) {
            connection.send({ cancel: rid })
          }
        },
      )
    },
    async subscribe(path: string, body: any, event: (body: any) => void): Promise<Cancellable> {
      return new Promise((success, failure) => {
        const request = ch.makeSubscription(path, body, response => {
          if (response.error) {
            failure(response.error)
          } else {
            const topic = response.topic!
            const cancel = connection.addTopic(topic, event)
            success({
              cancel(): void {
                let cancalled = cancel()
                if (cancalled) {
                  connection.notify({ unsub: topic })
                }
              },
            })
          }
        })
        connection.send(request)
      })
    },
    stop() {
      connection.stop()
    },
  }
}

class Values {
  ch: Channel<any>
  path: string
  body: any | undefined
  isRunning = false
  pending: ((response: Response) => void)[] = []
  queued: Response[] = []
  rid: number | undefined
  onSend: (body: any) => void
  onCancel: (id: number) => void
  constructor(
    ch: Channel<any>,
    path: string,
    body: any | undefined,
    onSend: (body: any) => void,
    onCancel: (id: number) => void,
  ) {
    this.ch = ch
    this.path = path
    this.body = body
    this.onSend = onSend
    this.onCancel = onCancel
  }

  private start() {
    if (this.isRunning) return
    this.isRunning = true
    const request = this.ch.makeStream(this.path, this.body, response => {
      const pendingPromise = this.pending.shift()
      if (pendingPromise) {
        pendingPromise(response)
      } else {
        this.queued.push(response)
      }
    })
    this.rid = request.id
    this.onSend(request)
  }
  private processResponse(response: Response): IteratorValue<any> {
    if (response.error) throw response.error
    return { value: response.body, done: response.done ? true : false }
  }
  async next(): Promise<IteratorValue<any>> {
    const result = new Promise<IteratorValue<any>>((success, failure) => {
      this.pending.push(value => {
        try {
          success(this.processResponse(value))
        } catch (error) {
          failure(error)
        }
      })
    })
    this.start()
    const value = await result
    return value
  }
  async return() {
    this.cancel()
    return { value: undefined, done: true }
  }
  private cancel() {
    if (this.rid === undefined) return
    this.onCancel(this.rid)
  }
  [Symbol.asyncIterator]() {
    return this
  }
}

interface IteratorValue<T> {
  value: T
  done: boolean
}
