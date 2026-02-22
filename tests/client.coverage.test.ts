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

    expect(ws.address).toBe('ws://localhost:9999')
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
