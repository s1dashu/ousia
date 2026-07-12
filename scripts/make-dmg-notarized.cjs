#!/usr/bin/env node

const { notarizeExistingDmg, runMacBuild } = require("./mac-build.cjs")

async function main() {
  const { dmgPath } = await runMacBuild({
    makeDmg: true,
    requireSentry: true,
    sign: true,
  })
  await notarizeExistingDmg({ dmgPath })
}

main().catch((error) => {
  console.error(error)
  process.exit(error.exitCode ?? 1)
})
