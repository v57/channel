export class LazyState<T> {
  promise: Promise<any>
  private resolve: (value: any) => void
  private reject: (value: any) => void
  private needsUpdate: boolean = false
  private allowsUpdates: boolean = false
  private waiting: boolean = false
  private subscribers = 0
  getValue: () => Promise<T> | T
  private minimumDelay: number = 1 / 30
  private _alwaysNeedsUpdate: boolean = false
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
      return { value: await this.iterator.getValue() }
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
