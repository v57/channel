import { Channel, type Sender } from '../channel'
import '../process'

interface TestingInfo {
  isCancelled: boolean
}

async function startTest(name: string, test: (client: Sender, info: TestingInfo) => Promise<void>) {
  const start = Bun.nanoseconds()
  let count = 0
  let info: TestingInfo = { isCancelled: false }
  const client = new Channel().post('hello', () => ++count).process()
  setTimeout(() => {
    info.isCancelled = true
  }, 500)
  await test(client, info)
  const ops = Math.floor(count / ((Bun.nanoseconds() - start) / 1_000_000_000))
  const formatted = new Intl.NumberFormat('en-US').format(ops)
  console.log(formatted.padStart(9, ' '), 'ops', name)
}
async function run(client: Sender, info: TestingInfo, ops: number = 100_000) {
  for (let i = 0; i < ops; i += 1) {
    if (info.isCancelled) return
    await client.send('hello', undefined)
  }
}

await startTest('1 thread', async (client, info) => {
  await run(client, info, 100_000)
})
await startTest('10 threads', async (client, info) => {
  await Promise.all(Array.from({ length: 10 }, () => run(client, info)))
})

// await send
// 2,929,337 ops 1 thread
// 4,239,010 ops 10 threads

// Replacing Promise with callback will double the performance
// 5,588,439 ops 1 thread
// 10,757,541 ops 10 threads
// Not sure if we need to increase code complexity for that
// I'll leave code here if we would need that at any time later:
/*
interface Sender {
  fastSend(path: string, body: any, onResponse: (response: Response) => void): void
}
fastSend(path: string, body?: any, onResponse: (response: Response) => void) {
  let id: number | undefined
  const request = ch.makeRequest(path, body, response => {
    onResponse(response)
    if (id !== undefined) {
      connection.sent(id)
    }
  })
  id = connection.send(request)
}
*/
