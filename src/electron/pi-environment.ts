import "./pi-package-dir.js"

import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  AuthStorage,
  getAgentDir,
  ModelRegistry,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"

import type {
  OusiaPiEnvironmentStatus,
  OusiaPiProviderCredentialPayload,
  OusiaPiProviderCredentialRemovalPayload,
  OusiaPiProviderCredentialResult,
  OusiaPiRetrySettingsPayload,
  OusiaPiRetrySettingsResult,
} from "./chat-types.js"
import { isDeprecatedProviderModelId } from "./model-compat.js"

type PiAuthStorageData = NonNullable<Parameters<typeof AuthStorage.inMemory>[0]>

export function resolvePiAgentDir() {
  return getAgentDir()
}

function readAuthStorageData(authPath: string): PiAuthStorageData {
  if (!existsSync(authPath)) {
    return {}
  }

  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf8")) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PiAuthStorageData)
      : {}
  } catch {
    return {}
  }
}

export function createReadOnlyPiAuthStorage(agentDir: string) {
  return AuthStorage.inMemory(readAuthStorageData(join(agentDir, "auth.json")))
}

export function createWritablePiAuthStorage(agentDir: string) {
  mkdirSync(agentDir, { recursive: true })
  return AuthStorage.create(join(agentDir, "auth.json"))
}

function createPiSettingsManager() {
  const agentDir = resolvePiAgentDir()
  mkdirSync(agentDir, { recursive: true })
  return SettingsManager.create(homedir(), agentDir)
}

export async function savePiRetrySettings(
  payload: OusiaPiRetrySettingsPayload
): Promise<OusiaPiRetrySettingsResult> {
  try {
    const settingsManager = createPiSettingsManager()
    settingsManager.setRetryEnabled(payload.autoRetryOnFailure)
    return {
      ok: true,
      autoRetryOnFailure: payload.autoRetryOnFailure,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function configuredProvidersFromRegistry(modelRegistry: ModelRegistry) {
  const configuredProviderIds = new Set<string>()
  let modelCount = 0

  for (const model of modelRegistry.getAvailable()) {
    const provider = model.provider.trim()
    const modelId = model.id.trim()
    if (
      provider &&
      modelId &&
      model.input?.includes("text") &&
      !isDeprecatedProviderModelId(provider, modelId)
    ) {
      configuredProviderIds.add(provider)
      modelCount += 1
    }
  }

  return {
    configuredProviderIds: [...configuredProviderIds].sort(),
    modelCount,
  }
}

export async function checkPiEnvironment(): Promise<OusiaPiEnvironmentStatus> {
  const agentDir = resolvePiAgentDir()
  const authJsonPath = join(agentDir, "auth.json")
  const modelsJsonPath = join(agentDir, "models.json")
  const authStorage = createReadOnlyPiAuthStorage(agentDir)
  const modelRegistry = ModelRegistry.create(authStorage, modelsJsonPath)
  const configured = configuredProvidersFromRegistry(modelRegistry)

  return {
    agentDir,
    authJsonExists: existsSync(authJsonPath),
    configDirExists: existsSync(agentDir),
    configuredProviderIds: configured.configuredProviderIds,
    hasConfiguredCredential: configured.configuredProviderIds.length > 0,
    modelCount: configured.modelCount,
    modelsJsonExists: existsSync(modelsJsonPath),
    runtime: "bundled",
  }
}

export async function savePiProviderCredential(
  payload: OusiaPiProviderCredentialPayload
): Promise<OusiaPiProviderCredentialResult> {
  const provider = payload.provider.trim()
  const apiKey = payload.apiKey.trim()
  if (!provider || !apiKey) {
    return { ok: false, error: "供应商和 API Key 不能为空。" }
  }

  try {
    const agentDir = resolvePiAgentDir()
    const authStorage = createWritablePiAuthStorage(agentDir)
    authStorage.set(provider, { type: "api_key", key: apiKey })
    return {
      ok: true,
      status: await checkPiEnvironment(),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function removePiProviderCredential(
  payload: OusiaPiProviderCredentialRemovalPayload
): Promise<OusiaPiProviderCredentialResult> {
  const provider = payload.provider.trim()
  if (!provider) {
    return { ok: false, error: "供应商不能为空。" }
  }

  try {
    const agentDir = resolvePiAgentDir()
    const authStorage = createWritablePiAuthStorage(agentDir)
    authStorage.remove(provider)
    return {
      ok: true,
      status: await checkPiEnvironment(),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
