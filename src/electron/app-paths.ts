import { app } from "electron"
import { join } from "node:path"

import {
  snapshotDesktopPathPolicy,
  snapshotProductIdentity,
  type DesktopPathPolicy,
  type ProductIdentity,
} from "@ousia/extension-api"

let configuration:
  | Readonly<{
      identity: ProductIdentity
      pathPolicy: DesktopPathPolicy
    }>
  | undefined

function requireConfiguration() {
  if (!configuration) {
    throw new Error(
      "Desktop app paths have not been configured with a product identity and path policy."
    )
  }
  return configuration
}

export function getCanonicalUserDataPath() {
  return join(
    app.getPath("appData"),
    requireConfiguration().pathPolicy.userDataDirectoryName
  )
}

export function configureDesktopAppPaths(
  identity: ProductIdentity,
  pathPolicy: DesktopPathPolicy
) {
  if (configuration) {
    throw new Error("Desktop app paths are already configured.")
  }
  configuration = Object.freeze({
    identity: snapshotProductIdentity(identity),
    pathPolicy: snapshotDesktopPathPolicy(pathPolicy),
  })
  app.setName(configuration.identity.displayName)
  app.setPath("userData", getCanonicalUserDataPath())
}
