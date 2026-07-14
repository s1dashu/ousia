export type PreviewSchedulerClock = {
  clearTimeout: (timerId: number) => void
  now: () => number
  setTimeout: (callback: () => void, delay: number) => number
}

type PreviewSchedulerOptions<Snapshot> = {
  clock: PreviewSchedulerClock
  commit: (snapshot: Snapshot) => void
  initialSnapshot: Snapshot
  intervalMilliseconds: number
}

export type PreviewSnapshotScheduler<Snapshot> = {
  dispose: () => void
  update: (snapshot: Snapshot, isStreaming: boolean) => void
}

export function shouldThrottleToolPreview(
  status: "running" | "finished" | "failed",
  inputComplete: boolean | undefined,
) {
  return status === "running" && inputComplete !== true
}

export function createPreviewSnapshotScheduler<Snapshot>({
  clock,
  commit,
  initialSnapshot,
  intervalMilliseconds,
}: PreviewSchedulerOptions<Snapshot>): PreviewSnapshotScheduler<Snapshot> {
  let latestSnapshot = initialSnapshot
  let lastCommitAt: number | null = null
  let timerId: number | null = null

  const clearPendingCommit = () => {
    if (timerId === null) {
      return
    }
    clock.clearTimeout(timerId)
    timerId = null
  }

  return {
    dispose() {
      clearPendingCommit()
    },
    update(snapshot, isStreaming) {
      latestSnapshot = snapshot

      if (!isStreaming) {
        clearPendingCommit()
        lastCommitAt = clock.now()
        commit(latestSnapshot)
        return
      }

      if (timerId !== null) {
        return
      }
      const delay =
        lastCommitAt === null
          ? 0
          : Math.max(0, intervalMilliseconds - (clock.now() - lastCommitAt))
      timerId = clock.setTimeout(() => {
        timerId = null
        lastCommitAt = clock.now()
        commit(latestSnapshot)
      }, delay)
    },
  }
}
