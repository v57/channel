import { expect, test } from 'bun:test'
import { Channel } from '../channel'
import '../server'

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error('refused'))
  })
}
function closed(ws: WebSocket): Promise<number> {
  return new Promise(resolve => (ws.onclose = event => resolve(event.code)))
}

test('path upgrades only matching requests, others get 404', async () => {
  const server = new Channel().post('hello', () => 'world').listen(0, { path: '/ws' })
  expect((await fetch(`http://127.0.0.1:${server.port}/other`)).status).toBe(404)
  const ws = await open(`ws://127.0.0.1:${server.port}/ws`)
  ws.send(JSON.stringify({ id: 1, path: 'hello' }))
  const reply = await new Promise<any>(resolve => (ws.onmessage = event => resolve(JSON.parse(event.data))))
  expect(reply).toEqual({ id: 1, body: 'world' })
  ws.close()
  expect(open(`ws://127.0.0.1:${server.port}/`)).rejects.toThrow()

  const matching = new Channel().listen(0, { path: path => path.startsWith('/v2/') })
  expect((await fetch(`http://127.0.0.1:${matching.port}/v1/`)).status).toBe(404)
  ;(await open(`ws://127.0.0.1:${matching.port}/v2/ws`)).close()
  // without the leading slash
  const relative = new Channel().listen(0, { path: 'ws' })
  ;(await open(`ws://127.0.0.1:${relative.port}/ws`)).close()
  server.stop(true)
  matching.stop(true)
  relative.stop(true)
})

test('state() throwing or rejecting refuses the upgrade with 401', async () => {
  const server = new Channel().listen(0, {
    state: headers => {
      if (headers.token === 'sync') throw { message: 'unauthorized', code: 401 }
      if (headers.token !== 'good') return Promise.reject('unauthorized')
      return { token: headers.token, ip: headers['x-hub-remote-ip'] }
    },
  })
  expect((await fetch(`http://127.0.0.1:${server.port}/?token=sync`)).status).toBe(401)
  expect((await fetch(`http://127.0.0.1:${server.port}/?token=bad`)).status).toBe(401)
  expect(open(`ws://127.0.0.1:${server.port}/?token=bad`)).rejects.toThrow()
  ;(await open(`ws://127.0.0.1:${server.port}/?token=good`)).close()
  server.stop(true)
})

test('maxPayload closes connections that send bigger messages', async () => {
  const server = new Channel().post('echo', ({ body }) => body).listen(0, { maxPayload: 1024 })
  const ws = await open(`ws://127.0.0.1:${server.port}`)
  ws.send(JSON.stringify({ id: 1, path: 'echo', body: 'small' }))
  const reply = await new Promise<any>(resolve => (ws.onmessage = event => resolve(JSON.parse(event.data))))
  expect(reply).toEqual({ id: 1, body: 'small' })
  const code = closed(ws)
  ws.send(JSON.stringify({ id: 2, path: 'echo', body: 'x'.repeat(2000) }))
  expect(await code).not.toBe(1000)
  server.stop(true)
})

test('perMessageDeflate is off by default and can be turned on', async () => {
  const plain = new Channel().listen(0)
  const ws = await open(`ws://127.0.0.1:${plain.port}`)
  expect(ws.extensions).not.toContain('permessage-deflate')
  ws.close()
  const server = new Channel().listen(0, { perMessageDeflate: true, idleTimeout: 30 })
  const deflate = await open(`ws://127.0.0.1:${server.port}`)
  expect(deflate.extensions).toContain('permessage-deflate')
  deflate.close()
  plain.stop(true)
  server.stop(true)
})
