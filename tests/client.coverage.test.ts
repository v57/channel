import { expect, test } from 'bun:test'
import { WebSocketClient } from '../client'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  address: string
  options: any
  sent: any[] = []
  onopen?: () => void | Promise<void>
  onclose?: (event?: any) => void
  onerror?: (event?: any) => void
  onmessage?: (event?: any) => void
  constructor(address: string, options?: any) {
    this.address = address
    this.options = options
    FakeWebSocket.instances.push(this)
  }
  send(body: any) {
    this.sent.push(body)
  }
  close() {
    this.onclose?.({})
  }
}

async function waitFor(predicate: () => boolean, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('timed out while waiting for websocket setup')
}

test('WebSocketClient covers browser headers path and 101 onerror handling', async () => {
  const originalWebSocket = globalThis.WebSocket
  const originalHasBunEnv = WebSocketClient.isBun

  expect(typeof WebSocketClient.isBun).toBe('boolean')

  FakeWebSocket.instances.splice(0)
  ;(globalThis as any).WebSocket = FakeWebSocket as any
  WebSocketClient.isBun = false

  try {
    const client = new WebSocketClient('ws://localhost:9999', async () => ({
      token: 'abc',
      empty: '',
    }))

    await waitFor(() => FakeWebSocket.instances.length === 1)
    const ws = FakeWebSocket.instances[0]
    await waitFor(() => typeof ws.onerror === 'function')

    expect(ws.address).toBe('ws://localhost:9999/?token=abc')
    expect(ws.options).toBeUndefined()
    expect(client.isRunning).toBe(true)

    ws.onerror?.({ message: 'error 101' })
    expect(client.isRunning).toBe(false)

    client.stop()
  } finally {
    ;(globalThis as any).WebSocket = originalWebSocket
    ;(WebSocketClient as any).isBun = originalHasBunEnv
  }
})

test('WebSocketClient closes the socket on an unparseable message instead of throwing', async () => {
  const originalWebSocket = globalThis.WebSocket
  FakeWebSocket.instances.splice(0)
  ;(globalThis as any).WebSocket = FakeWebSocket as any

  try {
    const client = new WebSocketClient('ws://localhost:9999')
    const received: any[] = []
    client.onmessage = value => received.push(value)
    await waitFor(() => FakeWebSocket.instances.length === 1)
    const ws = FakeWebSocket.instances[0]
    let closed = 0
    ws.close = () => {
      closed += 1
    }

    expect(() => ws.onmessage?.({ data: '{not json' })).not.toThrow()
    expect(closed).toBe(1)
    expect(received).toEqual([])

    ws.onmessage?.({ data: '{"id":1,"body":2}' })
    expect(received).toEqual([{ id: 1, body: 2 }])

    client.isRunning = false
  } finally {
    ;(globalThis as any).WebSocket = originalWebSocket
  }
})

test('WebSocketClient backs off exponentially with jitter while the server is down', async () => {
  const originalWebSocket = globalThis.WebSocket
  const originalSetTimeout = globalThis.setTimeout
  const originalRandom = Math.random
  FakeWebSocket.instances.splice(0)
  ;(globalThis as any).WebSocket = FakeWebSocket as any
  const delays: number[] = []
  const retries: (() => void)[] = []
  ;(globalThis as any).setTimeout = (fn: () => void, delay: number) => {
    delays.push(delay)
    retries.push(fn)
    return 0
  }
  Math.random = () => 1

  try {
    const client = new WebSocketClient('ws://localhost:9999')
    for (let i = 0; i < 8; i += 1) {
      const ws = FakeWebSocket.instances.at(-1)!
      ws.close()
      retries.shift()!()
    }
    expect(delays).toEqual([100, 200, 400, 800, 1600, 3200, 5000, 5000])

    // A successful open resets the backoff
    const ws = FakeWebSocket.instances.at(-1)!
    await ws.onopen?.()
    ws.close()
    Math.random = () => 0
    FakeWebSocket.instances.at(-1)!.close()
    expect(delays.slice(8)).toEqual([100, 100])

    // No retries after stop
    client.stop()
    expect(delays.length).toBe(10)
  } finally {
    ;(globalThis as any).WebSocket = originalWebSocket
    ;(globalThis as any).setTimeout = originalSetTimeout
    Math.random = originalRandom
  }
})
