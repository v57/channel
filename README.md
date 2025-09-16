# Channel

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
