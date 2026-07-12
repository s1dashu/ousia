const { join } = require("node:path")

const { MakerDeb } = require("@electron-forge/maker-deb")
const { MakerDMG } = require("@electron-forge/maker-dmg")
const { MakerRpm } = require("@electron-forge/maker-rpm")
const { MakerSquirrel } = require("@electron-forge/maker-squirrel")
const { MakerZIP } = require("@electron-forge/maker-zip")
const { VitePlugin } = require("@electron-forge/plugin-vite")

const appBundleId = process.env.APP_BUNDLE_ID || "com.ousia.desktop"
const macSignIdentity = process.env.APPLE_SIGN_IDENTITY
const macIcon = join(__dirname, "assets", "icon.icns")
const shouldSignMac = Boolean(macSignIdentity)
const shouldNotarizeMac = Boolean(
  process.env.APPLE_ID &&
    process.env.APPLE_APP_SPECIFIC_PASSWORD &&
    process.env.APPLE_TEAM_ID
)

const dmgBackground = join(__dirname, "assets", "dmg-background.png")
const dmgWindowSize = { width: 658, height: 498 }
const hiddenDmgSupportFiles = [
  ".background",
  ".DS_Store",
  ".Trashes",
  ".VolumeIcon.icns",
]
const piCodingAgentPackagePath =
  "/node_modules/@earendil-works/pi-coding-agent"

const macDmgConfig = {
  background: dmgBackground,
  icon: macIcon,
  contents: (options) => [
    { x: 200, y: 234, type: "file", path: options.appPath },
    { x: 458, y: 234, type: "link", path: "/Applications" },
    // Finder shows dotfiles when AppleShowAllFiles is enabled, so keep
    // appdmg's support files outside the initial installer window.
    ...hiddenDmgSupportFiles.map((path, index) => ({
      x: dmgWindowSize.width + 200 + index * 96,
      y: dmgWindowSize.height + 200,
      type: "position",
      path,
    })),
  ],
  additionalDMGOptions: {
    "background-color": "#fbfbfb",
    window: { size: dmgWindowSize },
    ...(shouldSignMac
      ? {
          "code-sign": {
            "signing-identity": macSignIdentity,
            identifier: appBundleId,
          },
        }
      : {}),
  },
}

module.exports = {
  packagerConfig: {
    name: "Ousia",
    executableName: "Ousia",
    appBundleId,
    appCategoryType: "public.app-category.developer-tools",
    icon: macIcon,
    ...(shouldSignMac
      ? {
          osxSign: {
            identity: macSignIdentity,
            hardenedRuntime: true,
          },
        }
      : {}),
    ...(shouldSignMac && shouldNotarizeMac
      ? {
          osxNotarize: {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID,
          },
        }
      : {}),
    ignore: (file) => {
      if (!file || file === "/") {
        return false
      }

      if (file.startsWith("/.vite/") && file.endsWith(".map")) {
        return true
      }

      const includedFiles = [
        "/package.json",
        "/node_modules",
        "/node_modules/@earendil-works",
        piCodingAgentPackagePath,
        `${piCodingAgentPackagePath}/CHANGELOG.md`,
        `${piCodingAgentPackagePath}/README.md`,
        `${piCodingAgentPackagePath}/package.json`,
      ]
      const includedSubtrees = [
        "/.vite",
        `${piCodingAgentPackagePath}/dist`,
        `${piCodingAgentPackagePath}/docs`,
        `${piCodingAgentPackagePath}/examples`,
      ]

      if (includedFiles.includes(file)) {
        return false
      }

      return !includedSubtrees.some(
        (includedPath) =>
          file === includedPath || file.startsWith(`${includedPath}/`)
      )
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerDMG(macDmgConfig, ["darwin"]),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/electron/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/electron/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
}
