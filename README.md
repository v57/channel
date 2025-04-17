# Channel

# Installation
`bun add @v57/channel`

# Usage

``` ts
import { Channel } from '@v57/channel'
new Channel()
  .post('hello', () => 'world')
  .listen(8080)

const client = new Channel()
  .connect(8080)
const response = await client.send('hello')
```
