import { Channel } from "./channel"
import './client'
import './server'
import { Subscription } from "./events"


const events = {
  hello: new Subscription()
}

new Channel()
  .post('hello', () => 'hello')
  .post('echo', (body) => body)
  .events(Subscription.parse(events))
  .listen(2048)

const client = new Channel()
  .connect('ws://127.0.0.1:2048')

console.log(await client.send('hello'))
console.log(await client.send('echo', 200))
events.hello.send('test', 'event 0')
await client.subscribe('hello', 'test', (event) => console.log(event))
events.hello.send('test', 'event 1')
events.hello.send('test', 'event 2')
