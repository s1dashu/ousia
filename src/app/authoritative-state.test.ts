import { describe, expect, it } from "vitest"

import { AuthoritativeState } from "./authoritative-state"

describe("AuthoritativeState", () => {
  it("advances independently of delayed renderer publications", () => {
    const source = new AuthoritativeState({ value: 0 })
    const delayedPublications: Array<{ value: number }> = []

    delayedPublications.push(
      source.update((current) => ({ value: current.value + 1 })),
    )
    delayedPublications.push(
      source.update((current) => ({ value: current.value + 1 })),
    )

    expect(delayedPublications.map((snapshot) => snapshot.value)).toEqual([
      1, 2,
    ])
    expect(source.current.value).toBe(2)

    const staleRenderedSnapshot = delayedPublications[0]
    expect(staleRenderedSnapshot.value).toBe(1)
    expect(source.current.value).toBe(2)
  })

  it("preserves identity when an update has no logical change", () => {
    const initial = { value: 0 }
    const source = new AuthoritativeState(initial)

    expect(source.update((current) => current)).toBe(initial)
    expect(source.current).toBe(initial)
  })
})
