<h1>
  <img alt="Containerization logo" src="./icon.png" width="70" valign="middle">
  &nbsp;channel
</h1>

Powerful and lightweight communication built for modern language. Run websocket server, client and even use it inside your process to communicate with different parts of your apps. It supports async and AsyncIterator out of the box.

# Installation
`bun add v57/channel`

# Usage

``` ts
// Server
import { Channel } from 'channel/server'
new Channel().post('hello', () => 'world').listen(8080)
```

``` ts
// Client
import { Channel } from 'channel/client'
const client = new Channel().connect(8080)
const response = await client.send('hello')
console.log(response)
```
