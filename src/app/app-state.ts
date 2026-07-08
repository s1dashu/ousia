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

function readStoredThemePreference(): AppSettings["theme"] | null {
  if (typeof window === "undefined") {
    return null
  }
  const storedTheme = window.localStorage.getItem("ousia.theme")
  if (
    storedTheme === "dark" ||
    storedTheme === "light" ||
    storedTheme === "system"
  ) {
    return storedTheme
  }
  return null
}

export async function loadInitialAppState(): Promise<InitialAppState> {
  if (typeof window === "undefined" || !window.ousia) {
    const storedTheme = readStoredThemePreference()
    const state = createDefaultAppState()
    return storedTheme
      ? {
          ...state,
          settings: {
            ...state.settings,
            theme: storedTheme,
          },
        }
      : state
  }
  return window.ousia.loadAppState()
}
