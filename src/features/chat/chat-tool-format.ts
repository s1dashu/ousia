const BUILT_IN_TOOL_NAMES = new Set([
  "bash",
  "edit",
  "find",
  "grep",
  "ls",
  "read",
  "write",
])

function normalizeToolName(name: string) {
  return name
    .trim()
    .replace(/^tool[-_:]/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
}

export function formatToolName(name: string) {
  if (!name) {
    return "tool"
  }

  const normalizedName = normalizeToolName(name)
  const canonicalName = normalizedName.toLowerCase()
  if (BUILT_IN_TOOL_NAMES.has(canonicalName)) {
    return canonicalName
  }

  return normalizedName || "tool"
}

export function shouldAutoExpandTool(name: string) {
  const normalizedName = normalizeToolName(name).toLowerCase()
  return normalizedName === "write" || normalizedName === "edit"
}
