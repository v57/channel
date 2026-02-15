export class LazyStates<Key, T> {
  states = new Map<Key, LazyState<T>>()
  make: (path: Key) => T
  private dedupeMode: 'none' | 'json' | 'equals' = 'none'
  constructor(make: (path: Key) => T) {
    this.make = make
  }
  setNeedsUpdate(path: Key | undefined = undefined) {
    if (path) {
      this.states.get(path)?.setNeedsUpdate()
    } else {
      this.states.forEach(a => a.setNeedsUpdate())
    }
  }
  state(path: Key): LazyState<T> {
    let state = this.states.get(path)
    if (state) return state
    state = new LazyState<T>(() => this.make(path)).dedupe(this.dedupeMode)
    this.states.set(path, state)
    state.onDisconnect = () => this.states.delete(path)
    return state
  }
  makeIterator(path: Key): LazyStateIterator<T> {
    return this.state(path).makeIterator()
  }
  dedupe(mode: 'none' | 'json' | 'equals'): this {
    this.dedupeMode = mode
    return this
  }
}

export class LazyState<T> {
  promise: Promise<any>
  private resolve: (value: any) => void
  private reject: (value: any) => void
  private needsUpdate: boolean = false
  private allowsUpdates: boolean = false
  private waiting: boolean = false
  private subscribers = 0
  lastValue?: T
  private lastEquatable?: string
  getValue: () => Promise<T> | T
  private minimumDelay: number = 1 / 30
  private _alwaysNeedsUpdate: boolean = false
  private dedupeMode = 0
  onDisconnect?: () => void
  constructor(getValue: () => Promise<T> | T) {
    this.getValue = getValue
    const { promise, resolve, reject } = Promise.withResolvers()
    this.promise = promise
    this.resolve = resolve
    this.reject = reject
  }
  delay(minimumDelaySeconds: number): this {
    this.minimumDelay = minimumDelaySeconds
    return this
  }
  alwaysNeedsUpdate(): this {
    this._alwaysNeedsUpdate = true
    return this
  }
  // Dedupe mode allows to ignore sending same event twice in a row
  // 'json' will convert sending value to json and compare with previous json string
  // 'equals' will use Bun.deepEquals. Fast but will fail if you send same object/array
  dedupe(mode: 'none' | 'json' | 'equals'): this {
    switch (mode) {
      case 'json':
        this.dedupeMode = 1
        break
      case 'equals':
        this.dedupeMode = 2
        break
      default:
        this.dedupeMode = 3
        break
    }
    return this
  }
  makeIterator() {
    return new LazyStateIterator(this)
  }
  subscribe() {
    if (this.subscribers === 0) {
      this.allowsUpdates = true
      this.scheduleUpdates()
    }
    this.subscribers += 1
  }
  unsubscribe() {
    if (this.subscribers === 0) return
    this.subscribers -= 1
    if (this.subscribers > 0) return
    this.allowsUpdates = false
    this.onDisconnect?.()
  }
  setNeedsUpdate() {
    const schedule = !this.needsUpdate
    this.needsUpdate = true
    if (schedule) {
      this.scheduleUpdates()
    }
  }
  send(value: T) {
    this.needsUpdate = false
    switch (this.dedupeMode) {
      case 1:
        const json = stableStringify(value)
        if (this.lastEquatable !== undefined && this.lastEquatable === json) return
        this.lastEquatable = json
        break
      case 2:
        if (this.lastValue !== undefined && Bun.deepEquals(value, this.lastValue)) return
        break
      default:
        break
    }
    this.lastValue = value
    this.resolve(value)
    this.createPromise()
  }
  throw() {
    this.needsUpdate = false
    this.reject('cancelled')
    this.createPromise()
  }
  private scheduleUpdates() {
    if (!this.allowsUpdates || (!this._alwaysNeedsUpdate && !this.needsUpdate) || this.waiting) return
    this.waiting = true
    setTimeout(async () => {
      if (this.needsUpdate || this.allowsUpdates) {
        try {
          const value = await this.getValue()
          this.waiting = false
          this.send(value)
          this.scheduleUpdates()
        } catch {
          this.waiting = false
        }
      } else {
        this.waiting = false
      }
    }, this.minimumDelay * 1000)
  }
  private createPromise() {
    const { promise, resolve, reject } = Promise.withResolvers()
    this.promise = promise
    this.resolve = resolve
    this.reject = reject
  }
}

export class LazyStateIterator<T> {
  iterator: LazyState<T>
  isStarted = false
  isCancelled = false
  constructor(iterator: LazyState<T>) {
    this.iterator = iterator
  }
  async next(): Promise<IteratorResult<T, any>> {
    if (!this.isStarted) {
      this.isStarted = true
      this.iterator.subscribe()
      if (this.iterator.lastValue !== undefined) return { value: this.iterator.lastValue }
      const value = await this.iterator.getValue()
      this.iterator.lastValue = value
      return { value }
    }
    return { value: await this.iterator.promise }
  }
  async return() {
    this.cancel()
    return { value: undefined, done: true }
  }
  private cancel() {
    if (!this.isStarted || this.isCancelled) return
    this.isCancelled = true
    this.iterator.unsubscribe()
  }
  [Symbol.asyncIterator]() {
    return this
  }
}
function stableStringify(value: any): string {
  const seen = new WeakMap()
  let nextId = 0
  const encode = (v: any) => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'number') {
        if (Number.isNaN(v)) return { $nan: 1 }
        if (Object.is(v, -0)) return { $neg0: 1 }
      }
      return v
    }
    const ref = seen.get(v)
    if (ref !== undefined) return { $ref: ref }
    seen.set(v, nextId++)
    if (Array.isArray(v)) {
      const out = new Array(v.length)
      for (let i = 0; i < v.length; i++) out[i] = encode(v[i])
      return out
    }
    const keys = Object.keys(v)
    keys.sort()
    const out: any = {}
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      out[k] = encode(v[k])
    }
    return out
  }

  return JSON.stringify(encode(value))
}
