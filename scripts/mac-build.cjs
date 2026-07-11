const { spawnSync } = require("node:child_process")
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} = require("node:fs")
const { homedir, tmpdir } = require("node:os")
const { isAbsolute, join, resolve } = require("node:path")

const rootDir = join(__dirname, "..")
const outDir = join(rootDir, "out")
const packagedAppDir = join(outDir, "Ousia-darwin-arm64")
const makeDir = join(outDir, "make")
const stalePackageDirs = [packagedAppDir]
const staleMakeDirs = [
  makeDir,
  join(outDir, "dmgroot"),
  join(outDir, "manual"),
]
const dmgVolumeName = "Ousia"
const nativeDmgDependencies = ["macos-alias", "fs-xattr"]
const forgeBin = join(rootDir, "node_modules", ".bin", "electron-forge")
const osxSignBin = join(
  rootDir,
  "node_modules",
  "@electron",
  "osx-sign",
  "bin",
  "electron-osx-sign.js"
)
const packagedAppPath = join(packagedAppDir, "Ousia.app")
const buildStartedAt = Date.now()
const npmExecPath = process.env.npm_execpath
const electronVersion = require(join(
  rootDir,
  "node_modules",
  "electron",
  "package.json"
)).version
const appVersion = require(join(rootDir, "package.json")).version
const electronCacheRoot = join(homedir(), "Library", "Caches", "electron")
const appleEnvKeys = [
  "APPLE_SIGN_IDENTITY",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
]
const appleNetworkBypassDomains = [
  "timestamp.apple.com",
  "api.apple-cloudkit.com",
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    const status = result.signal ? `signal ${result.signal}` : `exit ${result.status}`
    const error = new Error(
      `Command failed with ${status}: ${[command, ...args].join(" ")}`
    )
    error.exitCode = result.status ?? 1
    throw error
  }
  return result
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    env: process.env,
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  return result
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function listFiles(dir, predicate) {
  if (!existsSync(dir)) {
    return []
  }

  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFiles(path, predicate))
    } else if (predicate(path)) {
      files.push(path)
    }
  }
  return files
}

function parseScutilProxySettings(output) {
  const settings = {}
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z]+)\s*:\s*(.+?)\s*$/)
    if (match) {
      settings[match[1]] = match[2]
    }
  }
  return settings
}

function configureNodeProxyFromSystem() {
  if (process.platform !== "darwin") {
    return
  }

  const result = capture("scutil", ["--proxy"])
  if (result.status !== 0) {
    return
  }

  const settings = parseScutilProxySettings(result.stdout)
  const proxyUrl =
    settings.HTTPSEnable === "1" &&
    settings.HTTPSProxy &&
    settings.HTTPSPort
      ? `http://${settings.HTTPSProxy}:${settings.HTTPSPort}`
      : undefined
  if (!proxyUrl) {
    return
  }

  process.env.ELECTRON_GET_USE_PROXY ||= "1"
  process.env.HTTPS_PROXY ||= proxyUrl
  process.env.https_proxy ||= proxyUrl
  process.env.HTTP_PROXY ||= proxyUrl
  process.env.http_proxy ||= proxyUrl
}

function findCachedElectronZipDir(platform, arch) {
  const fileName = `electron-v${electronVersion}-${platform}-${arch}.zip`
  const matches = listFiles(electronCacheRoot, (path) => path.endsWith(fileName))
  const newestZip = matches.sort(
    (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs
  )[0]
  return newestZip ? join(newestZip, "..") : undefined
}

function rebuildNativeDmgDependencies() {
  if (npmExecPath) {
    run(process.execPath, [npmExecPath, "rebuild", ...nativeDmgDependencies])
    return
  }
  run("npm", ["rebuild", ...nativeDmgDependencies])
}

function detectDeveloperIdIdentity() {
  if (process.env.APPLE_SIGN_IDENTITY) {
    return process.env.APPLE_SIGN_IDENTITY
  }

  const result = capture("security", ["find-identity", "-v", "-p", "codesigning"])
  if (result.status !== 0) {
    return undefined
  }

  const match = result.stdout.match(/"([^"]*Developer ID Application:[^"]+)"/)
  return match?.[1]
}

function hasAppleNotarizationCredentials() {
  return Boolean(
    process.env.APPLE_ID &&
      process.env.APPLE_APP_SPECIFIC_PASSWORD &&
      process.env.APPLE_TEAM_ID
  )
}

function requireAppleNotarizationCredentials() {
  assert(
    hasAppleNotarizationCredentials(),
    [
      "Apple notarization credentials are required.",
      "Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID.",
    ].join("\n")
  )
}

function listNetworkServices() {
  const result = capture("networksetup", ["-listallnetworkservices"])
  if (result.status !== 0) {
    return []
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("An asterisk") &&
        !line.startsWith("*")
    )
}

function getProxyBypassDomains(service) {
  const result = capture("networksetup", ["-getproxybypassdomains", service])
  if (result.status !== 0) {
    return undefined
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("There aren't any bypass domains"))
}

function listMountedDmgVolumes(volumeName) {
  if (process.platform !== "darwin") {
    return []
  }

  const result = capture("hdiutil", ["info"])
  if (result.status !== 0) {
    return []
  }

  const escapedName = volumeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const volumePattern = new RegExp(`(/Volumes/${escapedName}(?: \\d+)?)$`)
  return [
    ...new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.match(volumePattern)?.[1])
        .filter(Boolean)
    ),
  ]
}

function detachMountedDmgVolumes(volumeName) {
  for (const mountPath of listMountedDmgVolumes(volumeName)) {
    console.log(`Detaching mounted ${volumeName} DMG volume: ${mountPath}`)
    const result = capture("hdiutil", ["detach", mountPath])
    if (result.status === 0) {
      continue
    }

    const forcedResult = capture("hdiutil", ["detach", "-force", mountPath])
    assert(
      forcedResult.status === 0,
      [
        `Failed to detach mounted ${volumeName} DMG volume: ${mountPath}`,
        "Eject it manually before building the DMG so Finder background aliases",
        "are written for the canonical /Volumes/Ousia mount point.",
      ].join("\n")
    )
  }
}

function setProxyBypassDomains(service, domains) {
  run("networksetup", [
    "-setproxybypassdomains",
    service,
    ...(domains.length > 0 ? domains : ["Empty"]),
  ])
}

function restoreProxyBypassDomains(entries) {
  for (const entry of [...entries].reverse()) {
    try {
      setProxyBypassDomains(entry.service, entry.domains)
    } catch (error) {
      console.warn(
        `Failed to restore proxy bypass domains for ${entry.service}: ${error.message}`
      )
    }
  }
}

async function withAppleNetworkBypass(task) {
  if (process.platform !== "darwin") {
    return await task()
  }

  const restoreEntries = []
  for (const service of listNetworkServices()) {
    const domains = getProxyBypassDomains(service)
    if (!domains) {
      continue
    }

    const nextDomains = [...domains]
    for (const domain of appleNetworkBypassDomains) {
      if (!nextDomains.includes(domain)) {
        nextDomains.push(domain)
      }
    }

    if (nextDomains.length !== domains.length) {
      restoreEntries.push({ service, domains })
      setProxyBypassDomains(service, nextDomains)
    }
  }

  if (restoreEntries.length > 0) {
    console.log("Temporarily bypassing system proxy for Apple notarization hosts.")
  }

  try {
    return await task()
  } finally {
    restoreProxyBypassDomains(restoreEntries)
  }
}

function installDarwinZipExtractorPatch() {
  if (process.platform !== "darwin") {
    return
  }

  const unzipModule = require("@electron/packager/dist/unzip")
  unzipModule.extractElectronZip = async (zipPath, targetDir) => {
    mkdirSync(targetDir, { recursive: true })
    run("ditto", ["-x", "-k", zipPath, targetDir])
  }
}

async function withHiddenAppleSigningEnv(task) {
  const saved = Object.fromEntries(
    appleEnvKeys.map((key) => [key, process.env[key]])
  )
  for (const key of appleEnvKeys) {
    delete process.env[key]
  }
  try {
    return await task()
  } finally {
    for (const key of appleEnvKeys) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
  }
}

async function notarizeArtifact(artifactPath, label) {
  requireAppleNotarizationCredentials()

  const { notarize } = require("@electron/notarize")
  console.log(`Notarizing ${label} with Apple notarytool...`)
  await notarize({
    appPath: artifactPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })
  run("xcrun", ["stapler", "validate", artifactPath])
}

function requireCodeSigningIdentity() {
  const detectedIdentity = detectDeveloperIdIdentity()
  assert(
    detectedIdentity,
    "Developer ID Application signing identity is required."
  )
  if (!process.env.APPLE_SIGN_IDENTITY) {
    process.env.APPLE_SIGN_IDENTITY = detectedIdentity
    console.log(`Using code signing identity: ${detectedIdentity}`)
  }
}

function signApp(appPath) {
  requireCodeSigningIdentity()
  console.log(`Signing app: ${appPath}`)
  run(process.execPath, [
    osxSignBin,
    appPath,
    `--identity=${process.env.APPLE_SIGN_IDENTITY}`,
    "--hardened-runtime",
    "--platform=darwin",
  ])
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath])
}

function signDmg(dmgPath) {
  requireCodeSigningIdentity()
  console.log(`Signing DMG: ${dmgPath}`)
  run("codesign", [
    "--force",
    "--sign",
    process.env.APPLE_SIGN_IDENTITY,
    "--timestamp",
    dmgPath,
  ])
  run("codesign", ["--verify", "--verbose=2", dmgPath])
}

function resolveDmgPath(dmgPath) {
  if (dmgPath) {
    return isAbsolute(dmgPath) ? dmgPath : resolve(rootDir, dmgPath)
  }

  const dmgFiles = listFiles(makeDir, (path) => path.endsWith(".dmg"))
  assert(
    dmgFiles.length > 0,
    "No DMG found. Run npm run make:dmg:signed first or pass a DMG path."
  )
  return dmgFiles.sort(
    (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs
  )[0]
}

function verifySignedAppInsideDmg(dmgPath) {
  if (process.platform !== "darwin") {
    return
  }

  const mountDir = mkdtempSync(join(tmpdir(), "ousia-dmg-"))
  let attached = false
  try {
    run("hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-mountpoint",
      mountDir,
      dmgPath,
    ])
    attached = true

    const appPath = join(mountDir, "Ousia.app")
    assert(
      existsSync(appPath),
      `DMG does not contain Ousia.app at the expected path: ${appPath}`
    )
    run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath])
  } finally {
    if (attached) {
      const detachResult = capture("hdiutil", ["detach", mountDir])
      if (detachResult.status !== 0) {
        capture("hdiutil", ["detach", "-force", mountDir])
      }
    }
    rmSync(mountDir, { force: true, recursive: true })
  }
}

function verifyAppDistribution(appPath, { signed, notarized }) {
  if (process.platform !== "darwin" || !signed) {
    return
  }

  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath])
  if (notarized) {
    run("spctl", ["-a", "-vvv", "-t", "execute", appPath])
  }
}

function verifyDmgDistribution(dmgPath, { signed, notarized }) {
  if (process.platform !== "darwin") {
    return
  }

  run("hdiutil", ["verify", dmgPath])
  if (signed) {
    run("codesign", ["--verify", "--verbose=2", dmgPath])
  }
  if (notarized) {
    run("spctl", ["-a", "-vvv", "-t", "install", dmgPath])
    run("spctl", [
      "-a",
      "-vvv",
      "-t",
      "open",
      "--context",
      "context:primary-signature",
      dmgPath,
    ])
  }
}

async function notarizeExistingDmg(options = {}) {
  const dmgPath = resolveDmgPath(options.dmgPath)
  assert(existsSync(dmgPath), `DMG does not exist: ${dmgPath}`)
  requireAppleNotarizationCredentials()
  requireCodeSigningIdentity()
  configureNodeProxyFromSystem()

  return await withAppleNetworkBypass(async () => {
    verifySignedAppInsideDmg(dmgPath)
    signDmg(dmgPath)
    await notarizeArtifact(dmgPath, "DMG")
    verifyDmgDistribution(dmgPath, { notarized: true, signed: true })
    console.log(`Notarized DMG: ${dmgPath}`)
    return { dmgPath }
  })
}

async function buildMac(options = {}) {
  const {
    arch = "arm64",
    makeDmg = false,
    makeZip = false,
    notarize = false,
    platform = "darwin",
    sign = notarize,
  } = options

  if (sign) {
    requireCodeSigningIdentity()
  }
  if (notarize) {
    requireAppleNotarizationCredentials()
  }

  for (const dir of [
    ...stalePackageDirs,
    ...(makeDmg ? staleMakeDirs : []),
  ]) {
    rmSync(dir, { force: true, recursive: true })
  }

  if (makeDmg) {
    rebuildNativeDmgDependencies()
  }
  configureNodeProxyFromSystem()
  installDarwinZipExtractorPatch()

  const { api } = require("@electron-forge/core")
  const electronZipDir = findCachedElectronZipDir(platform, arch)
  if (electronZipDir) {
    console.log(
      `Using cached Electron ${electronVersion} zip from: ${electronZipDir}`
    )
  }

  await withHiddenAppleSigningEnv(() =>
    api.package({
      arch,
      dir: rootDir,
      ...(electronZipDir ? { electronZipDir } : {}),
      interactive: true,
      platform,
    })
  )

  const mainBundle = join(
    packagedAppPath,
    "Contents",
    "Resources",
    "app",
    ".vite",
    "build",
    "main2.js"
  )
  assert(
    existsSync(mainBundle),
    [
      `Missing packaged main bundle: ${mainBundle}`,
      `Node ${process.version} may have made Electron Forge exit before packaging finished.`,
    ].join("\n")
  )

  const mainBundleSource = readFileSync(mainBundle, "utf8")
  assert(
    mainBundleSource.includes(".tmp") && /\.rename\(/.test(mainBundleSource),
    "Packaged app does not include atomic app-state writes."
  )
  assert(
    mainBundleSource.includes("appData") && mainBundleSource.includes("userData"),
    "Packaged app is missing current startup path logging."
  )

  if (sign) {
    signApp(packagedAppPath)
    if (notarize) {
      await notarizeArtifact(packagedAppPath, "app")
    }
    verifyAppDistribution(packagedAppPath, { notarized: notarize, signed: sign })
  }

  let newestDmg
  let updateZip

  if (makeDmg) {
    await withHiddenAppleSigningEnv(() => {
      detachMountedDmgVolumes(dmgVolumeName)
      run(process.execPath, [
        forgeBin,
        "make",
        "--skip-package",
        "--arch",
        arch,
        "--platform",
        platform,
        "--targets",
        "dmg",
      ])
    })

    const dmgFiles = listFiles(makeDir, (path) => path.endsWith(".dmg")).filter(
      (path) => statSync(path).mtimeMs >= buildStartedAt
    )
    assert(dmgFiles.length > 0, "Forge completed without producing a fresh DMG.")

    newestDmg = dmgFiles.sort(
      (left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs
    )[0]

    if (sign) {
      signDmg(newestDmg)
      if (notarize) {
        await notarizeArtifact(newestDmg, "DMG")
      }
    }
    verifyDmgDistribution(newestDmg, { notarized: notarize, signed: sign })
  }

  if (makeZip) {
    const zipDir = join(makeDir, "zip", platform, arch)
    mkdirSync(zipDir, { recursive: true })
    updateZip = join(zipDir, `Ousia-${appVersion}-${arch}.zip`)
    rmSync(updateZip, { force: true })
    run("ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      packagedAppPath,
      updateZip,
    ])
    assert(existsSync(updateZip), `Failed to create update ZIP: ${updateZip}`)
    console.log(`Automatic update ZIP: ${updateZip}`)
  }

  if (newestDmg) {
    console.log(`Fresh DMG: ${newestDmg}`)
  } else {
    console.log(`Fresh app: ${packagedAppPath}`)
  }

  return {
    appPath: packagedAppPath,
    dmgPath: newestDmg,
    updateZip,
  }
}

async function runMacBuild(options = {}) {
  const needsAppleNetworkBypass = options.sign || options.notarize
  if (needsAppleNetworkBypass) {
    return await withAppleNetworkBypass(() => buildMac(options))
  }
  return await buildMac(options)
}

module.exports = {
  buildMac,
  notarizeExistingDmg,
  paths: {
    makeDir,
    packagedAppDir,
    packagedAppPath,
    rootDir,
  },
  runMacBuild,
}
