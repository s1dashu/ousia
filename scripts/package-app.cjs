#!/usr/bin/env node

const { runMacBuild } = require("./mac-build.cjs")

runMacBuild({ makeDmg: false }).catch((error) => {
  console.error(error)
  process.exit(error.exitCode ?? 1)
})
