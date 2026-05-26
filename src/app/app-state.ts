import type { WorkspaceTabsState } from "@/extensions/workspace-tabs"
import {
  createDefaultOusiaAppState,
  createDefaultOusiaProject,
  createOusiaProject,
  createOusiaId,
  createOusiaSession,
  defaultOusiaAppSettings,
  OUSIA_APP_STATE_SCHEMA_VERSION,
  ousiaProjectNameFromPath,
  type OusiaAppSelectionState,
  type OusiaAppSettings,
  type OusiaAppState,
  type OusiaProjectRecord,
  type OusiaSessionRecord,
} from "@/electron/chat-types"

export type SessionRecord = OusiaSessionRecord
export type ProjectRecord = OusiaProjectRecord
export type AppSettings = OusiaAppSettings
export type AppSelectionState = OusiaAppSelectionState
export type InitialAppState = OusiaAppState
export const APP_STATE_SCHEMA_VERSION = OUSIA_APP_STATE_SCHEMA_VERSION
export const defaultSettings = defaultOusiaAppSettings
export const createId = createOusiaId
export const createSession = createOusiaSession
export const createProject = createOusiaProject
export const projectNameFromPath = ousiaProjectNameFromPath
export const createDefaultProject = createDefaultOusiaProject
export const createDefaultAppState = createDefaultOusiaAppState

export async function loadInitialAppState(): Promise<InitialAppState> {
  if (!window.ousia) {
    return createDefaultAppState()
  }
  return window.ousia.loadAppState()
}

export async function saveAppState(state: InitialAppState) {
  if (!window.ousia) {
    return { ok: true }
  }
  return window.ousia.saveAppState(state)
}

export type { WorkspaceTabsState }
