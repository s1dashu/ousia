import type { SessionRecord } from "./app-state"

function branchNumber(title: string, sourceTitle: string) {
  const prefix = `${sourceTitle}（`
  if (!title.startsWith(prefix) || !title.endsWith("）")) {
    return null
  }

  const numberText = title.slice(prefix.length, -1)
  if (!/^[1-9]\d*$/.test(numberText)) {
    return null
  }

  return Number(numberText)
}

export function nextBranchSessionTitle(
  sourceSession: Pick<SessionRecord, "projectId" | "title">,
  sessions: ReadonlyArray<Pick<SessionRecord, "projectId" | "title">>
) {
  const highestExistingNumber = sessions.reduce((highest, session) => {
    if (session.projectId !== sourceSession.projectId) {
      return highest
    }
    const number = branchNumber(session.title, sourceSession.title)
    return number === null ? highest : Math.max(highest, number)
  }, 0)

  return `${sourceSession.title}（${highestExistingNumber + 1}）`
}
