import "./pi-package-dir.js"

import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"

import {
  DefaultPackageManager,
  loadSkills,
  SettingsManager,
  type ResolvedResource,
} from "@earendil-works/pi-coding-agent"

import type {
  OusiaInstalledSkill,
  OusiaInstalledSkillsResult,
} from "./chat-types.js"
import { resolvePiAgentDir } from "./pi-environment.js"
import { writeRuntimeLog } from "./runtime-logger.js"

type InstalledSkillServiceOptions = {
  loadSkillResource?: (resource: ResolvedResource) => OusiaInstalledSkill[]
  log?: (
    level: "error" | "info",
    details: Record<string, unknown>
  ) => void
  resolveSkillResources?: () => Promise<ResolvedResource[]>
}

function isWithinPath(path: string, directory: string) {
  const normalizedPath = resolve(path)
  const normalizedDirectory = resolve(directory)
  return (
    normalizedPath === normalizedDirectory ||
    normalizedPath.startsWith(`${normalizedDirectory}${sep}`)
  )
}

function sourceForResource(resource: ResolvedResource) {
  if (resource.metadata.origin === "package") {
    return "pi-package" as const
  }
  const globalSkillsDir = join(homedir(), ".agents", "skills")
  return isWithinPath(resource.path, globalSkillsDir)
    ? ("global" as const)
    : ("pi" as const)
}

function createDefaultResourceResolver() {
  const cwd = homedir()
  const agentDir = resolvePiAgentDir()
  const settingsManager = SettingsManager.create(cwd, agentDir)
  const settingsErrors = settingsManager.drainErrors()
  if (settingsErrors.length) {
    throw new AggregateError(
      settingsErrors.map(({ error }) => error),
      `Installed skill settings load failed: ${settingsErrors
        .map(({ error, scope }) => `${scope}: ${error.message}`)
        .join("; ")}`
    )
  }
  const packageManager = new DefaultPackageManager({
    agentDir,
    cwd,
    settingsManager,
  })
  return async () => {
    const resources = await packageManager.resolve(async () => "skip")
    return resources.skills
  }
}

function loadDefaultSkillResource(resource: ResolvedResource) {
  const result = loadSkills({
    agentDir: resolvePiAgentDir(),
    cwd: homedir(),
    includeDefaults: false,
    skillPaths: [resource.path],
  })
  if (result.diagnostics.length) {
    throw new AggregateError(
      result.diagnostics.map(
        (diagnostic) =>
          new Error(`${diagnostic.path}: ${diagnostic.message}`)
      ),
      `Installed skill validation failed: ${result.diagnostics
        .map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
        .join("; ")}`
    )
  }
  const source = sourceForResource(resource)
  return result.skills.map((skill) => ({
    description: skill.description,
    enabled: resource.enabled,
    id: skill.filePath,
    name: skill.name,
    source,
  }))
}

export function createInstalledSkillService(
  options: InstalledSkillServiceOptions = {}
) {
  const resolveSkillResources =
    options.resolveSkillResources ??
    (async () => createDefaultResourceResolver()())
  const loadSkillResource =
    options.loadSkillResource ?? loadDefaultSkillResource
  const log =
    options.log ??
    ((level, details) => writeRuntimeLog("skills.installed", level, details))

  return {
    async listSkills(): Promise<OusiaInstalledSkillsResult> {
      try {
        const resources = await resolveSkillResources()
        const skills = resources.flatMap(loadSkillResource)
        const uniqueSkills = [
          ...new Map(skills.map((skill) => [skill.id, skill])).values(),
        ].sort(
          (left, right) =>
            left.source.localeCompare(right.source) ||
            left.name.localeCompare(right.name)
        )
        log("info", {
          event: "list-completed",
          skillCount: uniqueSkills.length,
          sourceCounts: uniqueSkills.reduce<Record<string, number>>(
            (counts, skill) => {
              counts[skill.source] = (counts[skill.source] ?? 0) + 1
              return counts
            },
            {}
          ),
        })
        return { skills: uniqueSkills }
      } catch (error) {
        log("error", {
          error: error instanceof Error ? error.message : String(error),
          event: "list-failed",
        })
        throw error
      }
    },
  }
}

export const installedSkillService = createInstalledSkillService()
