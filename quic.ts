/// <reference path="./types/node-quic.d.ts" />
// QUIC transport (experimental, see docs/quic.md): one bidirectional stream per connection carrying the same
// JSON messages as a WebSocket, each one prefixed with its length as a QUIC variable-length integer.
import { connect, listen, type QuicSession, type QuicStream } from 'node:quic'
import { createPrivateKey } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP, SocketAddress } from 'node:net'
import { Channel, makeSender, type SubscriptionEvent } from './channel'
import { WebSocketClient, type Options, type Socket } from './client'
import { Subscriptions, type BodyContext, type ListenOptions } from './server'
export { Channel, ChannelError, ObjectMap, type Sender } from './channel'

declare module './channel' {
  interface Channel<State> {
    listenQuic(address: number | string, options: QuicListenOptions<State>): Promise<QuicServer>
  }
}

declare module './client' {
  interface Options {
    /** TLS settings for `quic://` addresses. Without them the server certificate must be trusted by the system. */
    quic?: {
      /** PEM certificate (or CA) to trust, for self-signed servers */
      ca?: string | Buffer
      /** SHA-256 fingerprint of the server certificate to pin instead of verifying it (hex, colons optional) */
      fingerprint?: string
      servername?: string
    }
  }
}

export interface QuicListenOptions<State> extends ListenOptions<State> {
  /** PEM private key */
  key: string | Buffer
  /** PEM certificate chain */
  cert: string | Buffer
}

export interface QuicServer {
  port: number
  stop(): Promise<void>
}

export const alpn = 'channel/1'
/** Largest accepted frame, same as Bun's default WebSocket payload limit */
export const maxFrame = 16 * 1024 * 1024
/** Connections silent for 30 s are closed; clients send an empty frame every 15 s to stay open */
const transportParams = { maxIdleTimeout: 30 }
const keepalive = [Uint8Array.of(0)]
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const drainable = Symbol.for('Stream.drainableProtocol')

/** Length prefix (RFC 9000 varint, 1, 2 or 4 bytes) and UTF-8 payload of one message */
export function encodeFrame(text: string): Uint8Array[] {
  const payload = encoder.encode(text)
  const n = payload.length
  const header =
    n < 64
      ? Uint8Array.of(n)
      : n < 16384
        ? Uint8Array.of(0x40 | (n >> 8), n & 255)
        : Uint8Array.of(0x80 | (n >>> 24), (n >> 16) & 255, (n >> 8) & 255, n & 255)
  return [header, payload]
}

/** Splits a byte stream back into messages */
export class FrameReader {
  private chunks: Uint8Array[] = []
  private buffered = 0
  private needed = 1
  push(chunk: Uint8Array): string[] {
    this.chunks.push(chunk)
    this.buffered += chunk.length
    if (this.buffered < this.needed) return []
    const data = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.buffered)
    const frames: string[] = []
    let offset = 0
    while (true) {
      const left = data.length - offset
      if (!left) {
        this.needed = 1
        break
      }
      const size = 1 << (data[offset] >> 6)
      if (left < size) {
        this.needed = size
        break
      }
      let length = data[offset] & 0x3f
      for (let i = 1; i < size; i += 1) length = length * 256 + data[offset + i]
      if (length > maxFrame) throw new Error('message too big')
      if (left < size + length) {
        this.needed = size + length
        break
      }
      if (length) frames.push(decoder.decode(data.subarray(offset + size, offset + size + length)))
      offset += size + length
    }
    this.chunks = offset < data.length ? [data.slice(offset)] : []
    this.buffered = data.length - offset
    return frames
  }
}

/** A framed bidirectional stream; writes queue up while the stream applies backpressure */
class Connection {
  private queue: Uint8Array[] = []
  private draining = false
  constructor(private stream: QuicStream) {}
  send(text: string) {
    this.write(encodeFrame(text))
  }
  write(frame: Uint8Array[]) {
    if (this.draining || !this.stream.writer.writevSync(frame)) {
      this.queue.push(...frame)
      if (!this.draining) this.drain()
    }
  }
  private async drain() {
    this.draining = true
    const writer: any = this.stream.writer
    try {
      while (this.queue.length && writer.desiredSize !== null) {
        await writer[drainable]()
        if (writer.writevSync(this.queue)) this.queue = []
      }
    } catch {}
    this.queue = []
    this.draining = false
  }
  async *read() {
    const reader = new FrameReader()
    for await (const chunks of this.stream) for (const chunk of chunks) yield* reader.push(chunk)
  }
}

/** Client side of `quic://host:port`, used by `connect()` through `WebSocketClient.sockets` */
export class QuicSocket implements Socket {
  onopen: ((event: any) => void) | null = null
  onclose: ((event: any) => void) | null = null
  onerror: ((event: any) => void) | null = null
  onmessage: ((event: any) => void) | null = null
  private session?: QuicSession
  private connection?: Connection
  private closed = false
  private timer?: ReturnType<typeof setInterval>
  constructor(address: string, headers: Record<string, string>, options: Options) {
    this.open(address, headers, options.quic ?? {}).catch(error => {
      this.onerror?.({ error })
      this.close()
    })
  }
  private async open(address: string, headers: Record<string, string>, tls: NonNullable<Options['quic']>) {
    const url = new URL(address)
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const ip = isIP(host) ? host : (await lookup(host)).address
    const remote = new SocketAddress({ address: ip, port: Number(url.port), family: isIP(ip) === 6 ? 'ipv6' : 'ipv4' })
    // Bun only matches certificates against a host name, so IP addresses are checked here instead
    const byIP = isIP(host) !== 0 && !tls.servername
    const session = await connect(remote, {
      alpn,
      servername: tls.servername ?? (byIP ? undefined : host),
      ca: tls.ca && Buffer.from(tls.ca as string),
      verifyPeer: tls.fingerprint || byIP ? 'manual' : undefined,
      enableEarlyData: false,
      transportParams,
    })
    this.session = session
    session.closed.then(
      () => this.close(),
      () => this.close(),
    )
    const info = await session.opened
    if (tls.fingerprint) {
      const pin = (fingerprint?: string) => fingerprint?.replace(/:/g, '').toLowerCase()
      if (pin(session.peerCertificate?.fingerprint256) !== pin(tls.fingerprint)) {
        throw new Error('certificate fingerprint mismatch')
      }
    } else if (byIP && (info.validationErrorCode || !session.peerCertificate?.checkIP(host))) {
      throw new Error(`certificate is not valid for ${host}: ${info.validationErrorReason ?? 'address mismatch'}`)
    }
    const stream = await session.createBidirectionalStream()
    if (this.closed) return
    this.connection = new Connection(stream)
    this.connection.send(JSON.stringify({ hello: headers }))
    this.timer = setInterval(() => this.connection?.write(keepalive), 15_000)
    this.onopen?.({})
    for await (const text of this.connection.read()) this.onmessage?.({ data: text })
    this.close()
  }
  send(data: string) {
    this.connection?.send(data)
  }
  close() {
    if (this.closed) return
    this.closed = true
    clearInterval(this.timer)
    this.session?.destroy()
    this.onclose?.({})
  }
}
WebSocketClient.sockets.quic = QuicSocket

Channel.prototype.listenQuic = async function <State>(
  address: number | string,
  options: QuicListenOptions<State>,
): Promise<QuicServer> {
  const channel = this
  const [hostname, port] = typeof address === 'number' ? ['0.0.0.0', address] : address.split(':')
  const sessions = new Set<QuicSession>()
  const topics = new Map<string, Set<Connection>>()

  async function accept(session: QuicSession, stream: QuicStream) {
    const connection = new Connection(stream)
    const frames = connection.read()
    const subscribed = new Set<string>()
    let context: BodyContext<State> | undefined
    try {
      // First frame: { hello: headers }, used like the WebSocket upgrade request headers
      const first = await frames.next()
      if (first.done) return
      const hello = JSON.parse(first.value)?.hello
      if (!hello || typeof hello !== 'object') return
      const headers: Record<string, string | undefined> = Object.create(null)
      for (const [key, value] of Object.entries(hello)) if (typeof value === 'string') headers[key.toLowerCase()] = value
      const state = options.state ? await options.state(headers) : ({} as State)
      const subscriptions = new Subscriptions()
      const sender = makeSender(channel, {
        send(body: any): number {
          connection.send(JSON.stringify(body))
          return 0
        },
        sent() {},
        cancel: () => false,
        notify(body: any) {
          connection.send(JSON.stringify(body))
        },
        addTopic: (topic, event) => subscriptions.addTopic(topic, event),
        stop: () => session.destroy(),
      })
      context = { state, sender, subscriptions }
      const controller = {
        response(body: any) {
          connection.send(JSON.stringify(body))
        },
        subscribe(topic: string) {
          subscribed.add(topic)
          let set = topics.get(topic)
          if (!set) topics.set(topic, (set = new Set()))
          set.add(connection)
        },
        unsubscribe(topic: string) {
          subscribed.delete(topic)
          const set = topics.get(topic)
          if (set?.delete(connection) && !set.size) topics.delete(topic)
        },
        event(topic: string, event: any) {
          subscriptions.receivedEvent(topic, event)
        },
        sender,
        state,
      }
      options.onConnect?.(context)
      for await (const text of frames) channel.receive(JSON.parse(text), controller)
    } catch {
      // Invalid frame or JSON, rejected state, or the peer went away: drop the connection, like the WebSocket server
    } finally {
      for (const topic of subscribed) {
        const set = topics.get(topic)
        if (set?.delete(connection) && !set.size) topics.delete(topic)
      }
      session.destroy()
      if (context) {
        channel.disconnect(context.state, context.sender)
        options.onDisconnect?.(context)
      }
    }
  }

  const endpoint = await listen(
    session => {
      sessions.add(session)
      session.closed.then(
        () => sessions.delete(session),
        () => sessions.delete(session),
      )
      session.onstream = stream => {
        // One stream per connection: later streams are refused
        session.onstream = extra => extra.destroy()
        accept(session, stream)
      }
    },
    {
      alpn,
      sni: { '*': { keys: createPrivateKey(options.key), certs: Buffer.from(options.cert as string) } },
      endpoint: { address: `${hostname}:${port}` },
      enableEarlyData: false,
      transportParams,
    },
  )

  const publisher = {
    publish(event: SubscriptionEvent) {
      const set = topics.get(event.topic)
      if (!set) return
      const frame = encodeFrame(JSON.stringify(event))
      for (const connection of set) connection.write(frame)
    },
  }
  this.eventsApi?.forEach(a => a.publishers.push(publisher))
  this.transports.push(publisher)
  let stopped = false
  return {
    port: endpoint.address!.port,
    async stop() {
      if (stopped) return
      stopped = true
      const index = channel.transports.indexOf(publisher)
      if (index >= 0) channel.transports.splice(index, 1)
      channel.eventsApi?.forEach(subscription => {
        const index = subscription.publishers.indexOf(publisher)
        if (index >= 0) subscription.publishers.splice(index, 1)
      })
      for (const session of sessions) session.destroy()
      await endpoint.close()
    },
  }
}
