import { expect, test } from "bun:test"
import { Channel } from "./channel"

const server = new Channel()
  .post('hello', () => 'world')
  .post('echo', (body) => body)
const client = new Channel()
test("/hello", async () => {
  const response = await client.send(server, 'hello')
  expect(response).toBe('world')
})
test("/echo", async () => {
  const random = Math.random()
  const response = await client.send(server, 'echo', random)
  expect(response).toBe(random)
})
test("sub/echo", async () => {

})
test("/progress", async () => {

})
