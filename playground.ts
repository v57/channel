import { Channel } from "./channel"
import './client'
import './server'
import { Subscription } from "./events"

const events = {
  hello: new Subscription()
}

async function sleep(seconds: number) {
  await new Promise((resolve) => { setTimeout(resolve, seconds * 1000) })
}

new Channel()
  .post('hello', () => 'hello')
  .post('echo', ({ body }) => body)
  .stream('progress', async function* () {
    for (let i = 0; i <= 5; i += 1) {
      yield i
      console.log(i)
      await sleep(0.001)
    }
  })
  .events(Subscription.parse(events))
  .listen(2048)

const client = new Channel()
  .connect(2048)

for await (const value of client.values('progress')) {
  console.log(value)
  if (value == 3) break
}
console.log('Done')
