#!/usr/bin/env node

const { runMacBuild } = require("./mac-build.cjs")

runMacBuild({ makeDmg: true, requireSentry: true, sign: true }).catch((error) => {
  console.error(error)
  process.exit(error.exitCode ?? 1)
})
