
# Channel event structure
``` ts {
AnyEvent { // all fields are optional, Channel will receive either AnyEvent or Array<AnyEvent>
  id?: number
  path?: string
  body?: any
  error?: string
  code?: string | number // with error
  info?: any // with error
  cancel?: number
  sub?: string
  unsub?: string
  topic?: string
  stream?: string
  done?: bool
}
```

# Request
``` ts
Request {
  id?: number // request id, should be unique per connection. When not provided, it won't get the response
  path: string // api path
  body?: any // request body
}
SuccessResponse {
  id: number // same as request id
  error: nil
  body?: any // response body
}
ErrorResponse {
  id: number // same as request id
  error: string // response error, a non-empty message
  code?: string | number // library codes: not_found, cancelled, rate_limited. Or the application's own.
  info?: any // any JSON
}
CancelRequest { // doesn't get a response
  cancel: number // request id to cancel
}
```

# Event
``` ts
Request {
  id: number // request id, should be unique per connection
  sub: string // subscription name
  body?: any // request body
}
SuccessResponse {
  id: number // same as request id
  error: nil
  topic?: string // event topic on which you will receive events. Without it the subscription is one-shot.
  body?: any // snapshot, delivered as the first event when the key is present (also 0, false, "" and null)
}
ErrorResponse {
  id: number // same as request id
  error: string // response error
  code?: string | number
  info?: any
}
Event {
  id: nil
  topic: string // event topic
  body: any // event body, delivered when the key is present (also 0, false, "" and null)
}
Unsubscribe {
  unsub: string // event topic
}
```

# Stream
``` ts
Stream {
  id: number // request id
  stream: string // stream path
}
Event {
  id: number
  body?: any // event body
  error?: string // event error, should close the stream without checking for done == true
  code?: string | number // with error
  info?: any // with error
  done?: boolean // when true, means it's the last event from this stream
}
CancelRequest { // cancels stream, doesn't get a response
  cancel: number // request id to cancel
}
```

# Request ids and connections

- The peer that sends a request picks its id. The TypeScript library takes ids from one counter per `Channel`, shared by
  every connection of that channel (posts, streams and subscriptions alike).
- Ids of incoming requests belong to the connection they came on. A `cancel` cancels only a request of the connection
  that sends it.
- **A response answers a request only on the connection the request went to.** A message with an `id` that is not
  itself a request (a post response, a stream value, error or `done`, a subscription response with its snapshot) is
  looked up among the requests sent on that same connection. If the request went to another connection, or there is
  none, the message is ignored.

The last rule matters for any peer with more than one connection. A server that forwards calls to one of its peers
(the Hub calling a service for an app) sends them with the same counter it uses everywhere, so ids are easy to guess.
Without the rule, any other connected peer could answer those calls, feed values into the streams or end them.
Every port must follow it; [ports.md](ports.md) says which ones do. The TypeScript tests are in
`tests/reply-origin.test.ts`.

# Example processing

``` ts
receive(some: any) {
  if (some is Array) {
    for (const value of some) {
      receiveOne(value)
    }
  } else {
    receiveOne(value)
  }
}
receiveOne(some: any) {
  if (some.path) {
    const id = some.id
    if (id) {
      try {
        const body = callApi(some.path, some.body)
        send({ id, body })
      } catch(error) {
        send({ id, error, code, info }) // see v2.md for the conversion of thrown values
      }
    } else {
      callApi(some.path, some.body)
    }
  } else if (some.stream) {
    const id: number | undefined = some.id
    try {
      for await (const body in callStream(some.path, some.body)) {
        send({ id, body })
      }
      send({ id, done: true })
    } catch {
      send({ id, error })
    }
  } else if (some.cancel) {
    cancelRequestOrStream(some.cancel)
  } else if (some.sub) {
    const id = some.id
    if (!id) return
    try {
      const { topic, body } = subscribe(some.sub, some.body) // no topic: one-shot, nothing to join
      send({ id, topic, body })
    } catch {
      send({ id, error })
    }
  } else if (some.unsub) {
    unsubscibeFromTopic(some.unsub)
  } else if (some.topic) {
    if (some.id) {
      const request = getRequest(some.id) // the subscription, which delivers the snapshot to its own handler
      if (request && request.connection === thisConnection) request.receive(some)
    }
    else if ('body' in some) receivedEvent(some.topic, some.body)
  } else if (some.id !== undefined) {
    const request = getRequest(some.id)
    if (!request || request.connection !== thisConnection) return // see "Request ids and connections"
    request.receive(some)
    if (request.isStream) {
      if (some.done) {
        request.complete()
      }
    } else {
      request.complete()
    }
  }
}
```
