// Wire v2 interop cases (docs/v2.md), against the fixture in tests/server.ts
import { expect, test } from 'bun:test'
import { Channel, ChannelError, errorResponse } from '../channel'
import '../client'
import { port } from './server'

const address = `ws://127.0.0.1:${port}`

async function sleep(seconds: number = 0.001) {
  await new Promise(resolve => setTimeout(resolve, seconds * 1000))
}
async function failure(promise: Promise<any>): Promise<ChannelError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ChannelError)
    return error as ChannelError
  }
  throw new Error('expected a rejection')
}

test('errors are converted from thrown values', () => {
  expect(errorResponse(1, 'plain')).toEqual({ id: 1, error: 'plain' })
  expect(errorResponse(1, new Error('boom'))).toEqual({ id: 1, error: 'boom' })
  expect(errorResponse(1, { message: 'banned', code: 403, info: { a: 1 } })).toEqual({
    id: 1,
    error: 'banned',
    code: 403,
    info: { a: 1 },
  })
  expect(errorResponse(1, new ChannelError('x', 'y', false))).toEqual({ id: 1, error: 'x', code: 'y', info: false })
  expect(errorResponse(1, 42)).toEqual({ id: 1, error: '42' })
  expect(errorResponse(1, '')).toEqual({ id: 1, error: 'error' })
  expect(errorResponse(1, new Error())).toEqual({ id: 1, error: 'error' })
  // Codes are strings or integers, anything else is dropped
  expect(errorResponse(1, { message: 'm', code: 1.5 })).toEqual({ id: 1, error: 'm' })
})

test('1. structured errors carry message, code and info', async () => {
  const client = new Channel().connect(address)
  const banned = await failure(client.send('v2/error'))
  expect(banned.message).toBe('banned')
  expect(banned.code).toBe(403)
  expect(banned.info).toEqual({ remaining: 5 })
  expect(String(banned)).toBe('banned')
  expect(`${banned}`).toBe('banned')

  const slow = await failure(client.send('v2/error/code'))
  expect(slow.message).toBe('slow down')
  expect(slow.code).toBe('rate_limited')
  expect(slow.info).toEqual({ retryAfter: 1 })
  client.stop()
})

test('2. v1 string errors and library codes', async () => {
  const client = new Channel().connect(address)
  const unauthorized = await failure(client.send('auth/name'))
  expect(String(unauthorized)).toBe('unauthorized')
  expect(unauthorized.code).toBeUndefined()
  expect(unauthorized.info).toBeUndefined()

  const notFound = await failure(client.send('v2/missing'))
  expect(notFound.message).toBe('api not found')
  expect(notFound.code).toBe('not_found')

  const subNotFound = await failure(client.subscribe('v2/missing', undefined, () => {}))
  expect(subNotFound.message).toBe('subscription not found')
  expect(subNotFound.code).toBe('not_found')

  const streamNotFound = await failure(client.values('v2/missing').next())
  expect(streamNotFound.code).toBe('not_found')
  client.stop()
})
