const { MakerDeb } = require("@electron-forge/maker-deb")
const { MakerRpm } = require("@electron-forge/maker-rpm")
const { MakerSquirrel } = require("@electron-forge/maker-squirrel")
const { MakerZIP } = require("@electron-forge/maker-zip")
const { VitePlugin } = require("@electron-forge/plugin-vite")

module.exports = {
  packagerConfig: {
    asar: {
      unpack: "**/node_modules/node-pty/**/*",
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
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
