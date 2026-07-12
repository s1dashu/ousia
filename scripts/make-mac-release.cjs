#!/usr/bin/env node

const { runMacBuild } = require("./mac-build.cjs")

runMacBuild({
  makeDmg: true,
  makeZip: true,
  notarize: true,
  requireSentry: true,
}).catch((error) => {
  console.error(error)
  process.exit(error.exitCode ?? 1)
})
