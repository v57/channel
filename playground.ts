import { Channel } from "./channel"
import './client'
import './server'

new Channel()
  .post('hello', () => 'hello')
  .post('echo', (body) => body)
  .listen(2048)

const client = new Channel()
  .connect('ws://127.0.0.1:2048')

console.log(await client.send('hello'))
console.log(await client.send('echo', 200))
