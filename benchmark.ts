import { Channel } from "./channel"
import './client'
import './server'
import { Subscription } from "./events"
import type { ClientInterface } from "./client"

const events = {
  hello: new Subscription()
}

async function sleep(seconds: number) {
  await new Promise((resolve) => { setTimeout(resolve, seconds * 1000) })
}

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
  const formatted = new Intl.NumberFormat('fr-FR').format(ops);
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
