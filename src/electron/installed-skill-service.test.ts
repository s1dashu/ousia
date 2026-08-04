import { describe, expect, it, vi } from "vitest"

vi.mock("./pi-package-dir.js", () => ({}))

import { createInstalledSkillService } from "./installed-skill-service"

describe("installed skill service", () => {
  it("returns enabled and disabled global and Pi skills with stable identities", async () => {
    const log = vi.fn()
    const resources = [
      {
        path: "/skills/pi",
        enabled: false,
        metadata: {
          source: "auto",
          scope: "user" as const,
          origin: "top-level" as const,
        },
      },
      {
        path: "/skills/global",
        enabled: true,
        metadata: {
          source: "auto",
          scope: "user" as const,
          origin: "top-level" as const,
        },
      },
    ]
    const service = createInstalledSkillService({
      log,
      resolveSkillResources: async () => resources,
      loadSkillResource: (resource) => [
        {
          description: `${resource.path} description`,
          enabled: resource.enabled,
          id: `${resource.path}/SKILL.md`,
          name: resource.path.endsWith("global") ? "alpha" : "beta",
          source: resource.path.endsWith("global") ? "global" : "pi",
        },
      ],
    })

    await expect(service.listSkills()).resolves.toEqual({
      skills: [
        {
          description: "/skills/global description",
          enabled: true,
          id: "/skills/global/SKILL.md",
          name: "alpha",
          source: "global",
        },
        {
          description: "/skills/pi description",
          enabled: false,
          id: "/skills/pi/SKILL.md",
          name: "beta",
          source: "pi",
        },
      ],
    })
    expect(log).toHaveBeenCalledWith("info", {
      event: "list-completed",
      skillCount: 2,
      sourceCounts: { global: 1, pi: 1 },
    })
  })

  it("logs discovery failures and rejects the request", async () => {
    const log = vi.fn()
    const service = createInstalledSkillService({
      log,
      resolveSkillResources: async () => {
        throw new Error("settings are unreadable")
      },
    })

    await expect(service.listSkills()).rejects.toThrow(
      "settings are unreadable"
    )
    expect(log).toHaveBeenCalledWith("error", {
      error: "settings are unreadable",
      event: "list-failed",
    })
  })
})
