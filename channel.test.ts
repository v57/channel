import { expect, test } from "bun:test"
import { Channel } from "./channel"
import './client'
import './server'

new Channel()
  .post('hello', () => 'world')
  .post('echo', (body) => body)
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
test("sub/echo", async () => {

})
test("/progress", async () => {

})
