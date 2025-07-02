import { ObjectMap } from '../channel'

function compare(name: string, map: () => void, objectMap: () => void) {
  const m = measure(map)
  const o = measure(objectMap)
  if (m > o) {
    console.log(`ObjectMap ${name} ${new Intl.NumberFormat('en-US').format(m / o)} times faster`)
  } else {
    console.log(`Map ${name} ${new Intl.NumberFormat('en-US').format(o / m)} times faster`)
  }
}
function measure(task: () => void): number {
  let minimum = 0
  for (let i = 0; i < 10; i += 1) {
    const start = Bun.nanoseconds()
    task()
    const end = Bun.nanoseconds()
    const time = (end - start) / 1_000_000_000
    minimum = minimum > 0 ? Math.min(minimum, time) : time
  }
  return minimum
}

let map = new Map<number, number>()
let objectMap = new ObjectMap<number, number>()

function fillMaps(size: number, task: () => void) {
  for (let i = 0; i < size; i++) {
    map.set(i, i)
    objectMap.set(i, i)
  }
  task()
  map.clear()
  objectMap.clear()
}

function testWrite() {
  compare(
    'write',
    () => {
      for (let i = 0; i < 1_000_000; i++) map.set(i, i)
      map.clear()
    },
    () => {
      for (let i = 0; i < 1_000_000; i++) objectMap.set(i, i)
      objectMap.clear()
    },
  )
}
function testOverride() {
  compare(
    'override',
    () => {
      for (let i = 0; i < 100_000; i++) map.set(Math.round(Math.random() * 100), i)
      map.clear()
    },
    () => {
      for (let i = 0; i < 100_000; i++) objectMap.set(Math.round(Math.random() * 100), i)
      objectMap.clear()
    },
  )
}
function testRead() {
  fillMaps(10, () => {
    compare(
      'read',
      () => {
        for (let i = 0; i < 1_000_000; i++) map.get(i % 10)
      },
      () => {
        for (let i = 0; i < 1_000_000; i++) objectMap.get(i % 10)
      },
    )
  })
}
function testReadEmpty() {
  fillMaps(10, () => {
    compare(
      'read non exists',
      () => {
        for (let i = 0; i < 1_000_000; i++) map.get(Math.round(Math.random() * 100))
      },
      () => {
        for (let i = 0; i < 1_000_000; i++) objectMap.get(Math.round(Math.random() * 100))
      },
    )
  })
}
function testWriteDelete() {
  compare(
    'write delete',
    () => {
      for (let i = 0; i < 100_000; i++) {
        map.set(i, i)
        map.delete(i)
      }
    },
    () => {
      for (let i = 0; i < 100_000; i++) {
        objectMap.set(i, i)
        objectMap.delete(i)
      }
    },
  )
}
function testWriteReadDelete() {
  compare(
    'write read delete',
    () => {
      for (let i = 0; i < 100_000; i++) {
        map.set(i, i)
        map.get(i)
        map.delete(i)
      }
    },
    () => {
      for (let i = 0; i < 100_000; i++) {
        objectMap.set(i, i)
        objectMap.get(i)
        objectMap.delete(i)
      }
    },
  )
}

testRead()
testReadEmpty()
testWriteDelete()
testWriteReadDelete()
testOverride()
testWrite()

// Map read 1.169 times faster
// Map read non exists 2.668 times faster
// ObjectMap write delete 1.991 times faster
// ObjectMap write read delete 1.661 times faster
// ObjectMap override 1.814 times faster
// ObjectMap write 24.271 times faster
