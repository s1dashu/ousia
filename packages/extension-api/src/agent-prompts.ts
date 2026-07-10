export interface AgentPromptSection {
  readonly id: string
  readonly content: string
}

export interface AgentPromptManifest {
  readonly sections: readonly AgentPromptSection[]
}

const promptSectionIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/

function assertNonEmptyString(
  value: unknown,
  field: string
): asserts value is string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new TypeError(`${field} must be a non-empty, trimmed string.`)
  }
}

export function defineAgentPromptManifest(options: {
  sections: readonly AgentPromptSection[]
}): AgentPromptManifest {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("agentPromptManifest must be an object.")
  }
  for (const key of Object.keys(options)) {
    if (key !== "sections") {
      throw new TypeError(`agentPromptManifest.${key} is not supported.`)
    }
  }
  if (!Array.isArray(options.sections)) {
    throw new TypeError("agentPromptManifest.sections must be an array.")
  }
  const ids = new Set<string>()
  const sections = Array.from(options.sections, (section, index) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw new TypeError(
        `agentPromptManifest.sections[${index}] must be an object.`
      )
    }
    for (const key of Object.keys(section)) {
      if (key !== "id" && key !== "content") {
        throw new TypeError(
          `agentPromptManifest.sections[${index}].${key} is not supported.`
        )
      }
    }
    assertNonEmptyString(
      section.id,
      `agentPromptManifest.sections[${index}].id`
    )
    if (!promptSectionIdPattern.test(section.id)) {
      throw new TypeError(
        `agentPromptManifest.sections[${index}].id must be a lowercase dot- or hyphen-separated identifier.`
      )
    }
    if (ids.has(section.id)) {
      throw new Error(`Duplicate Agent prompt section: ${section.id}`)
    }
    ids.add(section.id)
    assertNonEmptyString(
      section.content,
      `agentPromptManifest.sections[${index}].content`
    )
    return Object.freeze({ id: section.id, content: section.content })
  })
  return Object.freeze({ sections: Object.freeze(sections) })
}

export function renderAgentPrompt(manifest: AgentPromptManifest) {
  return manifest.sections.map((section) => section.content).join("\n\n")
}
