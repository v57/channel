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

new Channel()
  .post('hello', () => 'world')
  .post('echo', (body) => body)
  .stream('stream/values', async function* () {
    for (let i = 0; i < 3; i += 1) {
      yield i
      await sleep()
    }
  })
  .events(Subscription.parse(events))
  .listen(2049)
const client = new Channel()
  .connect(2049)
test("/hello", async () => {
  const response = await client.send('hello')
  expect(response).toBe('world')
})
test("/echo", async () => {
  const random = Math.random()
  const response = await client.send('echo', random)
  expect(response).toBe(random)
})
test("sub/hello", async () => {
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
test("sub/hello", async () => {
  events.hello.send('test', 'event 0')
  let count = 0
  const topic = await client.subscribe('hello', 'test', (event) => {
    count += 1
    expect(event).toContain('event ')
  })
  events.hello.send('test', 'event 1')
  await sleep()
  client.unsubscribe(topic)
  await sleep()
  events.hello.send('test', 'event 2')
  await sleep()
  expect(count).toBe(1)
})
test("/stream", async () => {
  let a = 0
  for await (const value of client.values('stream/values')) {
    expect(value).toBe(a)
    a += 1
  }
})
