// The parts of Bun's experimental `node:quic` that quic.ts uses (the pinned @types/node predates it)
declare module 'node:quic' {
  import type { KeyObject, X509Certificate } from 'node:crypto'
  import type { SocketAddress } from 'node:net'
  interface SessionOptions {
    alpn?: string
    ca?: string | Buffer
    servername?: string
    verifyPeer?: 'strict' | 'auto' | 'manual'
    enableEarlyData?: boolean
    sni?: Record<string, { keys: KeyObject; certs: Buffer }>
    endpoint?: { address?: string }
    transportParams?: { maxIdleTimeout?: number }
  }
  interface Writer {
    readonly desiredSize: number | null
    writevSync(chunks: Uint8Array[]): boolean
  }
  class QuicStream {
    readonly writer: Writer
    destroy(error?: any): void
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array[]>
  }
  class QuicSession {
    readonly opened: Promise<{ validationErrorReason?: string; validationErrorCode?: string }>
    readonly closed: Promise<void>
    readonly peerCertificate: X509Certificate | undefined
    onstream: ((stream: QuicStream) => void) | undefined
    createBidirectionalStream(): Promise<QuicStream>
    destroy(error?: any): void
  }
  class QuicEndpoint {
    readonly address: SocketAddress | undefined
    close(): Promise<void>
  }
  function connect(address: string | SocketAddress, options?: SessionOptions): Promise<QuicSession>
  function listen(onsession: (session: QuicSession) => void, options?: SessionOptions): Promise<QuicEndpoint>
}
