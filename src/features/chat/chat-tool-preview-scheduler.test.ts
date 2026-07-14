import { describe, expect, it } from "vitest"

import {
  createPreviewSnapshotScheduler,
  shouldThrottleToolPreview,
  type PreviewSchedulerClock,
} from "@/features/chat/chat-tool-preview-scheduler"

class TestClock implements PreviewSchedulerClock {
  private currentTime = 0
  private nextTimerId = 1
  private readonly timers = new Map<
    number,
    { callback: () => void; runAt: number }
  >()

  clearTimeout = (timerId: number) => {
    this.timers.delete(timerId)
  }

  now = () => this.currentTime

  setTimeout = (callback: () => void, delay: number) => {
    const timerId = this.nextTimerId
    this.nextTimerId += 1
    this.timers.set(timerId, {
      callback,
      runAt: this.currentTime + delay,
    })
    return timerId
  }

  advanceTo(time: number) {
    if (time < this.currentTime) {
      throw new Error("Test clock cannot move backwards")
    }

    while (true) {
      const nextTimer = [...this.timers.entries()]
        .filter(([, timer]) => timer.runAt <= time)
        .sort((left, right) => left[1].runAt - right[1].runAt)[0]
      if (!nextTimer) {
        break
      }
      const [timerId, timer] = nextTimer
      this.currentTime = timer.runAt
      this.timers.delete(timerId)
      timer.callback()
    }
    this.currentTime = time
  }
}

describe("tool preview snapshot scheduler", () => {
  it("stops throttling as soon as streamed input is complete", () => {
    expect(shouldThrottleToolPreview("running", undefined)).toBe(true)
    expect(shouldThrottleToolPreview("running", false)).toBe(true)
    expect(shouldThrottleToolPreview("running", true)).toBe(false)
    expect(shouldThrottleToolPreview("finished", true)).toBe(false)
  })

  it("keeps committing the latest snapshot during a sustained stream", () => {
    const clock = new TestClock()
    const commits: string[] = []
    const scheduler = createPreviewSnapshotScheduler({
      clock,
      commit: (snapshot: string) => commits.push(snapshot),
      initialSnapshot: "empty",
      intervalMilliseconds: 120,
    })

    for (let time = 0; time <= 360; time += 20) {
      clock.advanceTo(time)
      scheduler.update(`snapshot-${time}`, true)
    }
    clock.advanceTo(480)

    expect(commits).toEqual([
      "snapshot-0",
      "snapshot-100",
      "snapshot-220",
      "snapshot-340",
      "snapshot-360",
    ])
  })

  it("commits the final snapshot immediately at the stream boundary", () => {
    const clock = new TestClock()
    const commits: string[] = []
    const scheduler = createPreviewSnapshotScheduler({
      clock,
      commit: (snapshot: string) => commits.push(snapshot),
      initialSnapshot: "empty",
      intervalMilliseconds: 120,
    })

    scheduler.update("partial-1", true)
    clock.advanceTo(0)
    clock.advanceTo(20)
    scheduler.update("partial-2", true)
    clock.advanceTo(40)
    scheduler.update("complete", false)

    expect(commits).toEqual(["partial-1", "complete"])
    clock.advanceTo(200)
    expect(commits).toEqual(["partial-1", "complete"])
  })

  it("cancels pending work when disposed", () => {
    const clock = new TestClock()
    const commits: string[] = []
    const scheduler = createPreviewSnapshotScheduler({
      clock,
      commit: (snapshot: string) => commits.push(snapshot),
      initialSnapshot: "empty",
      intervalMilliseconds: 120,
    })

    scheduler.update("partial-1", true)
    clock.advanceTo(0)
    clock.advanceTo(20)
    scheduler.update("partial-2", true)
    scheduler.dispose()
    clock.advanceTo(200)

    expect(commits).toEqual(["partial-1"])
  })
})
