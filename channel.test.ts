import { expect, test } from "bun:test"
import { Channel } from "./channel"
import { Subscription } from "./events"
import './client'
import './server'

const events = {
  hello: new Subscription()
}

async function sleep(seconds: number = 0.001) {
  await new Promise((resolve) => { setTimeout(resolve, seconds * 1000) })
}

let valuesSent = 0
new Channel()
  .post('hello', () => 'world')
  .post('mirror', async ({ sender }) => await sender.send('hello'))
  .post('echo', ({ body }) => body)
  .stream('stream/values', async function* () {
    for (let i = 0; i < 3; i += 1) {
      yield i
      await sleep()
    }
  })
  .stream('stream/cancel', async function* () {
    for (let i = 0; i < 10; i += 1) {
      yield i
      valuesSent += 1
      await sleep()
    }
  })
  .events(Subscription.parse(events))
  .listen(2049)
const client = new Channel()
  .post('hello', () => 'client world')
  .connect(2049)
test("post/hello", async () => {
  const response = await client.send('hello')
  expect(response).toBe('world')
})
test("post/echo", async () => {
  const random = Math.random()
  const response = await client.send('echo', random)
  expect(response).toBe(random)
})
test("events", async () => {
  events.hello.send('test', 'event 0')
  let count = 0
  await client.subscribe('hello', 'test', (event) => {
    count += 1
    expect(event).toContain('event ')
  })
  events.hello.send('test', 'event 1')
  events.hello.send('test', 'event 2')
  await sleep()
  expect(count).toBe(2)
})
test("events/cancel", async () => {
  events.hello.send('test', 'event 0')
  let count = 0
  const subscription = await client.subscribe('hello', 'test', (event) => {
    count += 1
    expect(event).toContain('event ')
  })
  events.hello.send('test', 'event 1')
  await sleep()
  subscription.cancel()
  await sleep()
  events.hello.send('test', 'event 2')
  await sleep()
  expect(count).toBe(1)
})
test("stream", async () => {
  let a = 0
  for await (const value of client.values('stream/values')) {
    expect(value).toBe(a)
    a += 1
  }
})
test("stream/cancel", async () => {
  let a = 0
  valuesSent = 0
  for await (const value of client.values('stream/cancel')) {
    expect(value).toBe(a)
    a += 1
    if (value === 2) break
  }
  expect(valuesSent).toBe(3)
})
test("server/post", async () => {
  const response = await client.send('mirror')
  expect(response).toBe('client world')
})
