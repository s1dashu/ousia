import type { SessionRecord } from "./app-state"

const BRANCH_SUFFIX_PATTERN = /（[1-9]\d*）$/

function branchBaseTitle(title: string) {
  let baseTitle = title
  while (BRANCH_SUFFIX_PATTERN.test(baseTitle)) {
    baseTitle = baseTitle.replace(BRANCH_SUFFIX_PATTERN, "")
  }
  return baseTitle
}

function branchNumber(title: string, baseTitle: string) {
  const prefix = `${baseTitle}（`
  if (!title.startsWith(prefix) || !title.endsWith("）")) {
    return null
  }

  const numberText = title.slice(prefix.length, -1)
  if (!/^[1-9]\d*$/.test(numberText)) {
    return null
  }

  const number = Number(numberText)
  return Number.isSafeInteger(number) ? number : null
}

export function nextBranchSessionTitle(
  sourceSession: Pick<SessionRecord, "projectId" | "title">,
  sessions: ReadonlyArray<Pick<SessionRecord, "projectId" | "title">>
) {
  const baseTitle = branchBaseTitle(sourceSession.title)
  const highestExistingNumber = sessions.reduce((highest, session) => {
    if (session.projectId !== sourceSession.projectId) {
      return highest
    }
    const number = branchNumber(session.title, baseTitle)
    return number === null ? highest : Math.max(highest, number)
  }, 0)

  return `${baseTitle}（${highestExistingNumber + 1}）`
}
