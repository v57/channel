``` ts
import { Channel } from 'channel/server'
new Channel()
  // Simple request
  .post('hello', () => 'hi')
  // Request with parameters
  .post('add', { body: { a, b } } => a + b)
.stream
  .listen(8080)
```
