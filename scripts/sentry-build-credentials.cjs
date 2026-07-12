const { spawnSync } = require("node:child_process")

const SENTRY_KEYCHAIN_ACCOUNT = "source-map-upload"
const SENTRY_KEYCHAIN_SERVICE = "sidasoftware-sentry-build"

function loadSentryBuildToken({
  environment = process.env,
  platform = process.platform,
  readPassword = () =>
    spawnSync(
      "security",
      [
        "find-generic-password",
        "-w",
        "-s",
        SENTRY_KEYCHAIN_SERVICE,
        "-a",
        SENTRY_KEYCHAIN_ACCOUNT,
      ],
      { encoding: "utf8" }
    ),
} = {}) {
  if (environment.SENTRY_AUTH_TOKEN?.trim()) return "environment"
  if (platform !== "darwin") return "unavailable"

  const result = readPassword()
  if (result.error || result.status !== 0) return "unavailable"
  const token = result.stdout?.trim()
  if (!token) {
    throw new Error("Sentry build token in macOS Keychain is empty")
  }
  environment.SENTRY_AUTH_TOKEN = token
  return "keychain"
}

module.exports = {
  loadSentryBuildToken,
  SENTRY_KEYCHAIN_ACCOUNT,
  SENTRY_KEYCHAIN_SERVICE,
}
