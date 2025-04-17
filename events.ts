interface Publisher {
  publish(event: SubscriptionEvent): void
}

export interface SubscriptionEvent {
  topic: string
  body: any
}

export class Subscription {
  static parse(events: any): Map<string, Subscription> {
    const map = new Map<string, Subscription>()
    this._parse(events, '', map)
    return map
  }
  static _parse(object: any, prefix: string, map: Map<string, Subscription>) {
    for (let [key, value] of Object.entries(object)) {
      if (value instanceof Subscription) {
        value.prefix = prefix.length ? `${prefix}/${key}` : key
        map.set(prefix + key, value)
        continue
      } else if (typeof value === 'object') {
        this._parse(value, `${prefix}${key}/`, map)
      }
    }
  }
  publishers: Publisher[] = []
  prefix: string = ''
  _topic: (request: any) => string = request => (request === undefined ? '' : `${request}`)
  _body: (request: any) => any | Promise<any> | undefined = () => {}
  topic(make: (request: any) => string) {
    this._topic = make
  }
  body(make: (body: any) => any) {
    this._topic = make
  }
  send(request: any, body?: any) {
    const topic = this._topic(request)
    const b: any | Promise<any> | undefined = body ?? this._body(request)
    if (b?.then) {
      b.then((a: any) => this.publish(topic, body))
    } else {
      this.publish(topic, b)
    }
  }
  publish(topic: string, body?: any) {
    if (!body) return
    const event: SubscriptionEvent = { topic: this.prefix.length ? this.prefix + '/' + topic : topic, body }
    this.publishers.forEach(a => a.publish(event))
  }
}
