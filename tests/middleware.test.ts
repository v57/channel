import { expect, test } from 'bun:test'
import { Channel, ChannelError, Subscription } from '../channel'
import { logger, rateLimit } from '../middleware'
import '../client'
import '../process'
import { port } from './server'

async function failure(promise: Promise<any>): Promise<ChannelError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ChannelError)
    return error as ChannelError
  }
  throw new Error('expected a rejection')
}

test('8. the rate limit refuses the 3rd call with rate_limited and retryAfter', async () => {
  const client = new Channel().connect(`ws://127.0.0.1:${port}`)
  expect(await client.send('v2/rate')).toBe('ok')
  expect(await client.send('v2/rate')).toBe('ok')
  const limited = await failure(client.send('v2/rate'))
  expect(limited.message).toBe('rate limited')
  expect(limited.code).toBe('rate_limited')
  expect(limited.info.retryAfter).toBe(1)
  // Other paths and other connections aren't limited
  expect(await client.send('hello')).toBe('world')
  const other = new Channel().connect(`ws://127.0.0.1:${port}`)
  expect(await other.send('v2/rate')).toBe('ok')
  client.stop()
  other.stop()
})

test('rateLimit allows calls again once the window has passed', async () => {
  const client = new Channel()
    .use(rateLimit({ key: ctx => ctx.body?.user, limit: 1, window: 0.05 }))
    .post('a', () => 'a')
    .process()
  expect(await client.send('a', { user: 'x' })).toBe('a')
  expect((await failure(client.send('a', { user: 'x' }))).code).toBe('rate_limited')
  // another key, and no key
  expect(await client.send('a', { user: 'y' })).toBe('a')
  expect(await client.send('a')).toBe('a')
  expect(await client.send('a')).toBe('a')
  await Bun.sleep(60)
  expect(await client.send('a', { user: 'x' })).toBe('a')
})

test('middleware runs in order around posts, streams and subs', async () => {
  const calls: string[] = []
  const news = new Subscription()
  news.body(() => 'news snapshot')
  const client = new Channel()
    .use(async (ctx, next) => {
      calls.push(`1 ${ctx.kind} ${ctx.path}`)
      const result = await next()
      calls.push(`1 done`)
      return result
    })
    .use((ctx, next) => {
      calls.push(`2 ${ctx.kind}`)
      return next()
    })
    .post('post', ({ body }) => body)
    .stream('stream', async function* () {
      yield 1
      yield 2
    })
    .sub('sub', () => ({ topic: 't', body: 'snapshot' }))
    .events({ news })
    .process()
  expect(await client.send('post', 5)).toBe(5)
  expect(calls).toEqual(['1 post post', '2 post', '1 done'])
  calls.length = 0

  const values: any[] = []
  for await (const value of client.values('stream')) values.push(value)
  expect(values).toEqual([1, 2])
  // middleware sees only the start of a stream
  expect(calls).toEqual(['1 stream stream', '2 stream', '1 done'])
  calls.length = 0

  const events: any[] = []
  await client.subscribe('sub', undefined, body => events.push(body))
  await client.subscribe('news', 'today', body => events.push(body))
  expect(events).toEqual(['snapshot', 'news snapshot'])
  expect(calls).toEqual(['1 sub sub', '2 sub', '1 done', '1 sub news', '2 sub', '1 done'])
})

test('middleware can replace the body and the result, and its errors become error replies', async () => {
  const client = new Channel()
    .use(async (ctx, next) => {
      if (ctx.path === 'refused') throw { message: 'no', code: 403 }
      if (ctx.path === 'after') {
        await next()
        throw new Error('failed after')
      }
      ctx.body = (ctx.body ?? 0) + 1
      const result = await next()
      return ctx.kind === 'sub' ? { ...result, body: result.body + '!' } : result * 10
    })
    .post('double', ({ body }) => body * 2)
    .post('refused', () => 'never')
    .post('after', () => 'never')
    .sub('room', ({ body }) => ({ topic: `room/${body}`, body: `${body}` }))
    .process()
  expect(await client.send('double', 1)).toBe(40)
  const refused = await failure(client.send('refused'))
  expect(refused.message).toBe('no')
  expect(refused.code).toBe(403)
  expect((await failure(client.send('after'))).message).toBe('failed after')
  const events: any[] = []
  await client.subscribe('room', 1, body => events.push(body))
  expect(events).toEqual(['2!'])
})

test('api not found is checked before middleware', async () => {
  let calls = 0
  const client = new Channel()
    .use((_, next) => {
      calls += 1
      return next()
    })
    .process()
  expect((await failure(client.send('missing'))).code).toBe('not_found')
  expect((await failure(client.values('missing').next())).code).toBe('not_found')
  expect((await failure(client.subscribe('missing', undefined, () => {}))).code).toBe('not_found')
  expect(calls).toBe(0)
})

test('logger logs ok and errors, and only slow calls with slow', async () => {
  const lines: string[] = []
  const client = new Channel()
    .use(logger({ log: line => lines.push(line) }))
    .post('ok', () => 1)
    .post('fails', () => {
      throw { message: 'banned', code: 403 }
    })
    .post('plain', () => {
      throw 'nope'
    })
    .process()
  await client.send('ok')
  await failure(client.send('fails'))
  await failure(client.send('plain'))
  expect(lines.length).toBe(3)
  expect(lines[0]).toMatch(/^post ok \d+\.\dms ok$/)
  expect(lines[1]).toMatch(/^post fails \d+\.\dms 403 banned$/)
  expect(lines[2]).toMatch(/^post plain \d+\.\dms nope$/)

  const slowLines: string[] = []
  const slow = new Channel()
    .use(logger({ log: line => slowLines.push(line), slow: 20 }))
    .post('fast', () => 1)
    .post('slow', () => Bun.sleep(30))
    .process()
  await slow.send('fast')
  await slow.send('slow')
  expect(slowLines.length).toBe(1)
  expect(slowLines[0]).toStartWith('post slow ')
})

test('middleware runs on the client side too', async () => {
  const kinds: string[] = []
  const server = new Channel().post('ask', ({ sender }) => sender.send('answer')).listen(0)
  const client = new Channel()
    .use((ctx, next) => {
      kinds.push(`${ctx.kind} ${ctx.path}`)
      return next()
    })
    .post('answer', () => 42)
    .connect(`ws://127.0.0.1:${server.port}`)
  expect(await client.send('ask')).toBe(42)
  expect(kinds).toEqual(['post answer'])
  client.stop()
  server.stop(true)
})
