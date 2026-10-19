# Channel Server

``` ts
import { Channel } from 'channel/server'
import { logger, rateLimit } from 'channel/middleware'

interface State {
  userId?: string
}

const channel = new Channel<State>()
  // Middleware, in order, before every incoming post, stream start and sub (see v2.md §3)
  .use(logger({ slow: 100 }))
  .use(rateLimit({ key: ctx => ctx.state.userId, limit: 10, window: 1 }))
  // Simple request
  .post('hello', () => 'hi')
  // Request with parameters
  .post('add', ({ body: { a, b } }) => a + b)
  // Errors: strings, Errors, or objects with message, code and info
  .post('admin', ({ state }) => {
    if (!state.userId) throw { message: 'authorization required', code: 401 }
    return 'welcome'
  })
  // Streams
  .stream('count', async function* () {
    for (let i = 0; i < 3; i += 1) yield i
  })
  // Subscriptions: the handler picks the topic and returns the snapshot. Without a topic it is one-shot.
  .sub('chat/list', async ({ state }) => {
    if (!state.userId) throw { message: 'authorization required', code: 401 }
    return { topic: `chat/list/${state.userId}`, body: await loadChats(state.userId) }
  })

channel.listen(8080, {
  // From the upgrade headers and query parameters; throwing refuses the connection with 401
  state: async headers => ({ userId: await verify(headers.authorization) }),
  path: '/ws', // others get 404
  maxPayload: 16 * 1024 * 1024,
  idleTimeout: 120,
  perMessageDeflate: false,
})

// Sends to every connection subscribed to the topic, across every listen() of this channel
channel.publish('chat/list/42', { unread: 3 })
```

Handlers get `{ body, state, sender, context, path, task }`. `sender` calls the client back (`send`, `values`,
`subscribe`); `task` (posts with an id) tells when the client cancelled.

See [v2.md](v2.md) for the error conversion, the library error codes and the subscription rules.
