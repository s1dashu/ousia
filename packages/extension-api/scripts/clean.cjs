const { rmSync } = require("node:fs")
const { join } = require("node:path")

rmSync(join(__dirname, "..", "dist"), { force: true, recursive: true })
