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
}: DesktopSentryBuildOptions) {
  const dsn = publicDsn(environment, `${envPrefix}_SENTRY_DSN`)
  const config: DesktopSentryBuildConfig = {
    buildVerificationMarker: "",
    dsn,
    enabled: false,
    enabledInDevelopment: booleanEnvironment(
      environment,
      `${envPrefix}_SENTRY_ENABLE_IN_DEVELOPMENT`
    ),
    environment:
      environment[`${envPrefix}_SENTRY_ENVIRONMENT`]?.trim() ||
      (command === "build" ? "production" : "development"),
    nativeCrashReportsEnabled: booleanEnvironment(
      environment,
      `${envPrefix}_SENTRY_ENABLE_NATIVE_CRASH_REPORTS`
    ),
    productId,
    release: `${releaseName}@${packageVersion()}`,
  }
  config.enabled =
    Boolean(dsn) && (command === "build" || config.enabledInDevelopment)
  config.buildVerificationMarker = `desktop-sentry-build:${config.enabled ? "enabled" : "disabled"}:${config.release}`
  if (config.enabledInDevelopment && !dsn) {
    throw new Error(
      `${envPrefix}_SENTRY_ENABLE_IN_DEVELOPMENT requires ${envPrefix}_SENTRY_DSN`
    )
  }
  if (config.nativeCrashReportsEnabled && !dsn) {
    throw new Error(
      `${envPrefix}_SENTRY_ENABLE_NATIVE_CRASH_REPORTS requires ${envPrefix}_SENTRY_DSN`
    )
  }

  const uploadValues = {
    authToken: environment.SENTRY_AUTH_TOKEN?.trim() || "",
    org: environment.SENTRY_ORG?.trim() || "",
    project: environment[`${envPrefix}_SENTRY_PROJECT`]?.trim() || "",
  }
  const presentUploadValues = Object.values(uploadValues).filter(Boolean).length
  if (presentUploadValues !== 0 && presentUploadValues !== 3) {
    throw new Error(
      `Source-map upload requires SENTRY_AUTH_TOKEN, SENTRY_ORG, and ${envPrefix}_SENTRY_PROJECT together`
    )
  }
  const uploadEnabled = command === "build" && presentUploadValues === 3
  if (command === "build" && dsn && !uploadEnabled) {
    throw new Error(
      `A Sentry-enabled production build requires source-map upload credentials`
    )
  }

  const plugins: PluginOption[] = []
  if (uploadEnabled) {
    plugins.push(
      sentryVitePlugin({
        ...uploadValues,
        release: { inject: false, name: config.release },
        sourcemaps: {
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
