# Performance

How fast the TypeScript library is, and why. The other languages are scored by the benchmark in the Channel
workspace (`benchmark/`), not here.

## Measurements

A server on a single thread handles over 4 million synchronous handlers and over 2 million async handlers per second.

| Library | Requests per second, one client to one server | Server CPU | Server memory |
| --- | ---: | ---: | ---: |
| Channel | 1 million | 22% | 55 MB |
| Socket.IO | 170k | 89% | 110 MB |

Over QUIC the numbers are lower; [QUIC transport](quic.md#measurements) has them next to WebSocket's.

## Why it is fast

1. No dependencies.
2. Little code. The core is about 900 lines, the WebSocket client 350 and the server 170 (measured with scc, October
   2026, after wire v2). Socket.IO's client has 2,595 lines, and its hello world server pulls in 44,708 lines with its
   dependencies.
3. The WebSocket server is Bun's, written in C.
4. When a client sends many requests at once, they are packed into one frame (a batch), which takes most of the load
   off the WebSocket.
5. Key-value lookups use both `Map` and plain objects: `Map` reads slightly faster, and objects write about 25 times
   faster, so each is used where it wins.
