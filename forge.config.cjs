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

const macDmgConfig = {
  icon: macIcon,
  ...(shouldSignMac
    ? {
        additionalDMGOptions: {
          "code-sign": {
            "signing-identity": macSignIdentity,
            identifier: appBundleId,
          },
        },
      }
    : {}),
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

      const includedSubtrees = ["/.vite"]

      if (file === "/package.json" || file === "/node_modules") {
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
