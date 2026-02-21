import { Channel, makeSender, type SubscriptionEvent } from './channel'
import type { Controller } from './channel'
export { Channel, ObjectMap, type Sender } from './channel'

declare module './channel' {
  interface Channel<State> {
    process(): Sender
  }
}

Channel.prototype.process = function () {
  const ch = this
  const connection = new Interface(ch)
  const sender = makeSender(ch, connection)
  let state = Object.create(null)
  connection.controller = {
    response(body: any) {
      ch.receive(body, this)
    },
    subscribe() {},
    unsubscribe() {},
    event() {},
    sender,
    state,
  }
  return sender
}

class Interface<State> {
  ch: Channel<State>
  controller!: Controller<State>
  constructor(ch: Channel<State>) {
    this.ch = ch
  }
  send(body: any): number {
    this.ch.receive(body, this.controller)
    return 0
  }
  sent(): void {}
  cancel(): boolean {
    return false
  }
  notify(body: any): void {
    this.ch.receive(body, this.controller)
  }
  addTopic(): () => boolean {
    return () => false
  }
  stop(): void {}
}
