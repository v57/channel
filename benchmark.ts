import { Channel } from "./channel"
import './client'
import './server'
import type { ClientInterface } from "./client"

interface TestingInfo {
  isCancelled: boolean
}

async function startTest(name: string, test: (client: ClientInterface, info: TestingInfo) => Promise<void>) {
  const start = Bun.nanoseconds()
  let count = 0
  let info: TestingInfo = { isCancelled: false }
  const server = new Channel()
    .post('hello', () => ++count)
    .listen(2048)
  const client = new Channel()
    .connect(2048)
  setTimeout(() => {
    info.isCancelled = true
  }, 500)
  await test(client, info)
  const ops = Math.floor(count / ((Bun.nanoseconds() - start) / 1_000_000_000))
  const formatted = new Intl.NumberFormat('en-US').format(ops);
  console.log(formatted.padStart(9, ' '), 'ops', name)
  client.stop()
  server.stop()
}
async function run(client: ClientInterface, info: TestingInfo, ops: number = 100_000) {
  for (let i = 0; i < ops; i += 1) {
    if (info.isCancelled) return
    await client.send('hello')
  }
}

await startTest('1 thread', async (client, info) => {
  await run(client, info, 1_000_000)
})
await startTest('10 threads', async (client, info) => {
  await Promise.all(Array.from({ length: 10 }, () => run(client, info)))
})
await startTest('100 threads', async (client, info) => {
  await Promise.all(Array.from({ length: 100 }, () => run(client, info)))
})
await startTest('1000 threads', async (client, info) => {
  await Promise.all(Array.from({ length: 1000 }, () => run(client, info)))
})
await startTest('10000 threads', async (client, info) => {
  await Promise.all(Array.from({ length: 10000 }, () => run(client, info)))
})
/*
51,668 ops 1 thread
200,081 ops 10 threads
313,227 ops 100 threads
312,440 ops 1000 threads
263,569 ops 10000 threads
*/
