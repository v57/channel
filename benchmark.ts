import { Channel, type Sender } from './channel'
import './client'
import './server'

interface TestingInfo {
  isCancelled: boolean
}

async function startTest(name: string, test: (client: Sender, info: TestingInfo) => Promise<void>) {
  const start = Bun.nanoseconds()
  let count = 0
  let info: TestingInfo = { isCancelled: false }
  const server = new Channel().post('hello', () => ++count).listen(2048)
  const client = new Channel().connect(2048)
  setTimeout(() => {
    info.isCancelled = true
  }, 500)
  await test(client, info)
  const ops = Math.floor(count / ((Bun.nanoseconds() - start) / 1_000_000_000))
  const formatted = new Intl.NumberFormat('en-US').format(ops)
  console.log(formatted.padStart(9, ' '), 'ops', name)
  client.stop()
  server.stop()
}
async function run(client: Sender, info: TestingInfo, ops: number = 100_000) {
  for (let i = 0; i < ops; i += 1) {
    if (info.isCancelled) return
    await client.send('hello')
  }
}

await startTest('1 thread', async (client, info) => {
  await run(client, info, 100_000)
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
// channel
52,478 ops 1 thread
198,796 ops 10 threads
303,340 ops 100 threads
301,064 ops 1000 threads
848,467 ops 10000 threads

// socket.io websocket
39,941 ops 1 thread
126,786 ops 10 threads
175,222 ops 100 threads
169,348 ops 1000 threads
143,752 ops 10000 threads

// socket.io polling
661 ops 1 thread
3,491 ops 10 threads
31,962 ops 100 threads
205,788 ops 1000 threads
388,935 ops 10000 threads
*/
