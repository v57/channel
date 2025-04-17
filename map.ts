export class ObjectMap<Key, Value> {
  private storage: any = {}
  size = 0
  get(id: Key): Value | undefined {
    return this.storage[id]
  }
  set(id: Key, value: Value) {
    this.size += 1
    this.storage[id] = value
  }
  delete(id: Key) {
    this.size -= 1
    delete this.storage[id]
  }
  map<O>(transform: (value: Value) => O): O[] {
    let array: O[] = []
    for (let a of Object.values(this.storage)) {
      array.push(transform(a as Value))
    }
    return array
  }
  forEach<O>(callback: (value: Value, key: Key) => void) {
    for (let [key, value] of Object.entries(this.storage)) {
      callback(value as Value, key as Key)
    }
  }
}
