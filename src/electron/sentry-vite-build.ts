import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { sentryVitePlugin } from "@sentry/vite-plugin"
import { loadEnv, type PluginOption } from "vite"

export type DesktopSentryBuildOptions = {
  command: "build" | "serve"
  environment?: Record<string, string | undefined>
  envPrefix: string
  productId: string
  releaseName: string
  sourcemapAssets: string[]
}

type DesktopSentryBuildConfig = {
  buildVerificationMarker: string
  dsn: string
  enabled: boolean
  enabledInDevelopment: boolean
  environment: string
  nativeCrashReportsEnabled: boolean
  productId: string
  release: string
}

function booleanEnvironment(
  environment: Record<string, string | undefined>,
  name: string
) {
  const value = environment[name]?.trim()
  if (!value) return false
  if (value === "1") return true
  if (value === "0") return false
  throw new Error(`${name} must be exactly 0 or 1`)
}

function publicDsn(
  environment: Record<string, string | undefined>,
  name: string
) {
  const value = environment[name]?.trim() || ""
  if (!value) return ""
  const parsed = new URL(value)
  if (
    parsed.protocol !== "https:" ||
    !parsed.username ||
    !parsed.pathname.slice(1)
  ) {
    throw new Error(`${name} must be a valid public HTTPS Sentry DSN`)
  }
  if (parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain a password, query, or fragment`)
  }
  return value
}

function packageVersion() {
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8")
  ) as { version?: unknown }
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error("package.json must contain a non-empty version")
  }
  return packageJson.version
}

export function desktopSentryVite({
  command,
  environment = process.env,
  envPrefix,
  productId,
  releaseName,
  sourcemapAssets,
}: DesktopSentryBuildOptions) {
  if (sourcemapAssets.length === 0) {
    throw new Error("Desktop Sentry source-map assets must not be empty")
  }
  const releaseBuildRequested = booleanEnvironment(
    environment,
    `${envPrefix}_SENTRY_RELEASE_BUILD`
  )
  if (releaseBuildRequested && command !== "build") {
    throw new Error(
      `${envPrefix}_SENTRY_RELEASE_BUILD is only valid for production builds`
    )
  }
  const dsn = releaseBuildRequested
    ? publicDsn(environment, `${envPrefix}_SENTRY_DSN`)
    : ""
  if (releaseBuildRequested && !dsn) {
    throw new Error(
      `${envPrefix}_SENTRY_RELEASE_BUILD requires ${envPrefix}_SENTRY_DSN`
    )
  }
  const config: DesktopSentryBuildConfig = {
    buildVerificationMarker: "",
    dsn,
    enabled: false,
    enabledInDevelopment: false,
    environment:
      environment[`${envPrefix}_SENTRY_ENVIRONMENT`]?.trim() ||
      (command === "build" ? "production" : "development"),
    nativeCrashReportsEnabled:
      releaseBuildRequested &&
      booleanEnvironment(
        environment,
        `${envPrefix}_SENTRY_ENABLE_NATIVE_CRASH_REPORTS`
      ),
    productId,
    release: `${releaseName}@${packageVersion()}`,
  }
  config.enabled = releaseBuildRequested
  config.buildVerificationMarker = `desktop-sentry-build:${config.enabled ? "enabled" : "disabled"}:${config.release}`

  const uploadValues = {
    authToken: releaseBuildRequested
      ? environment.SENTRY_AUTH_TOKEN?.trim() || ""
      : "",
    org: releaseBuildRequested ? environment.SENTRY_ORG?.trim() || "" : "",
    project: releaseBuildRequested
      ? environment[`${envPrefix}_SENTRY_PROJECT`]?.trim() || ""
      : "",
  }
  const presentUploadValues = Object.values(uploadValues).filter(Boolean).length
  if (releaseBuildRequested && presentUploadValues !== 3) {
    throw new Error(
      `A Sentry release build requires SENTRY_AUTH_TOKEN, SENTRY_ORG, and ${envPrefix}_SENTRY_PROJECT`
    )
  }
  const uploadEnabled = releaseBuildRequested && presentUploadValues === 3

  const plugins: PluginOption[] = []
  if (uploadEnabled) {
    plugins.push(
      sentryVitePlugin({
        ...uploadValues,
        release: { inject: false, name: config.release },
        errorHandler: (error) => {
          throw error
        },
        sourcemaps: {
          assets: sourcemapAssets,
          rewriteSources: (source) => source.replace(/^.*?\/src\//, "src/"),
        },
        telemetry: false,
      })
    )
  }

  return {
    define: {
      __DESKTOP_SENTRY_CONFIG__: JSON.stringify(config),
    },
    plugins,
    sourcemap: uploadEnabled ? ("hidden" as const) : false,
  }
}

export function loadDesktopSentryEnvironment({
  mode,
  root,
}: {
  mode: string
  root: string
}) {
  return {
    ...loadEnv(mode, root, ""),
    ...process.env,
  }
}
