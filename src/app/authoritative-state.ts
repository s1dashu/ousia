export class AuthoritativeState<T> {
  #current: T

  constructor(initialValue: T) {
    this.#current = initialValue
  }

  get current() {
    return this.#current
  }

  update(update: (current: T) => T) {
    const next = update(this.#current)
    this.#current = next
    return next
  }
}
