import {
  defineDesktopPathPolicy,
  defineProductIdentity,
} from "@ousia/extension-api"

export const OUSIA_PRODUCT_IDENTITY = defineProductIdentity({
  id: "ousia",
  displayName: "Ousia",
} as const)

export const OUSIA_DESKTOP_PATH_POLICY = defineDesktopPathPolicy({
  userDataDirectoryName: "ousia-desktop",
  runtimeLog: {
    homeDirectoryName: ".ousia",
    directoryName: "logs",
    fileName: "ousia-desktop.log",
  },
} as const)
