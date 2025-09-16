# Performance

## Tell me how fast is it?!

JS is fast! A server on a single thread can handle over 4 million sync functions and over 2 million async functions per second. So you won't need to think about scaling it for a long time.
Spend your budget on scaling DB or something else while this thing is delivering a huge performance bump


### Channel
1 client can send 1 million requests per second to 1 server while server's cpu usage sits at 22% and 55mb or ram
### Socket.IO
1 client can send 170k requests per second to 1 server while server's cpu usage sits at 89% and 110mb or ram

## Why is it so fast?
1. No dependencies
2. Very simple logic
3. Channel by design doesn't need much code.
- Client has 600 lines of js code while Socket.IO has 2595 lines of code
- Server has 543 lines of js code while Socket.IO has **44708** lines of code
4. WebSocket server is running on C by Bun
5. When client sends a lot of requests, they start packing into a single request, highly reducing load on its websocket part
6. There are two ways in handling Key-Value storage: Map and Object. Map has slightly faster reads and 25 times slower writes. Channel utilizes both of them for maximum performance
