const { spawnSync } = require("node:child_process")

const npmCli = process.env.npm_execpath
const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm"
const args = [
  ...(npmCli ? [npmCli] : []),
  "pack",
  "--dry-run",
  "--json",
  "--ignore-scripts",
]
const result = spawnSync(command, args, {
  cwd: require("node:path").join(__dirname, ".."),
  encoding: "utf8",
})
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const report = JSON.parse(result.stdout)
if (!Array.isArray(report) || report.length !== 1) {
  throw new Error("Expected exactly one npm pack report.")
}
const paths = new Set(report[0].files.map((file) => file.path))
for (const required of [
  "LICENSE",
  "README.md",
  "dist/index.d.ts",
  "dist/index.js",
  "package.json",
]) {
  if (!paths.has(required)) {
    throw new Error(`Packed extension API is missing ${required}.`)
  }
}
for (const path of paths) {
  if (path.endsWith(".map")) {
    throw new Error(`Packed extension API contains stale source map ${path}.`)
  }
  if (
    path !== "LICENSE" &&
    path !== "README.md" &&
    path !== "package.json" &&
    !path.startsWith("dist/")
  ) {
    throw new Error(`Packed extension API contains unexpected file ${path}.`)
  }
}

process.stdout.write(
  `Verified @ousia/extension-api pack contents (${paths.size} files).\n`
)
