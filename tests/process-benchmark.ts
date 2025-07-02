import { Channel, type Sender } from '../channel'
import '../process'

async function startTest(name: string, test: (client: Sender) => Promise<void>) {
  let best = 0
  for (let i = 0; i < 100; i += 1) {
    const ops = await measure(test)
    best = Math.max(best, ops)
  }
  const formatted = new Intl.NumberFormat('en-US').format(best)
  console.log(formatted.padStart(9, ' '), 'ops', name)
}
async function measure(test: (client: Sender) => Promise<void>): Promise<number> {
  let count = 0
  const client = new Channel()
    .post('hello', () => ++count)
    .post('async', async () => new Promise(r => r(++count)))
    .process()
  const start = Bun.nanoseconds()
  await test(client)
  return Math.floor(count / ((Bun.nanoseconds() - start) / 1_000_000_000))
}
async function run(client: Sender, api: string, ops: number) {
  for (let i = 0; i < ops; i += 1) {
    await client.send(api)
  }
}

await startTest('async', async client => {
  await run(client, 'async', 10000)
})
await startTest('sync', async client => {
  await run(client, 'hello', 30000)
})

// await send
// 2,297,134 ops async
// 4,166,280 ops sync

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
