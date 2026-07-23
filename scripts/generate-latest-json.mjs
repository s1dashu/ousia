#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import { basename, resolve } from "node:path"

const [version, target, updaterPath, signaturePath, outputPath] =
  process.argv.slice(2)

if (!version || !target || !updaterPath || !signaturePath || !outputPath) {
  throw new Error(
    "Usage: generate-latest-json.mjs <version> <target> <updater> <signature> <output>",
  )
}

const artifactName = basename(updaterPath)
const expectedSignaturePath = `${updaterPath}.sig`
if (resolve(signaturePath) !== resolve(expectedSignaturePath)) {
  throw new Error(
    `Updater signature must be adjacent to its artifact: ${expectedSignaturePath}`,
  )
}

const signature = (await readFile(signaturePath, "utf8")).trim()
if (!signature) {
  throw new Error(`Updater signature is empty: ${signaturePath}`)
}

const repository = "https://github.com/s1dashu/ousia"
const releaseTag = `v${version}`
const latest = {
  version,
  notes: process.env.RELEASE_NOTES?.trim() || `Pi ${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    [target]: {
      signature,
      url: `${repository}/releases/download/${releaseTag}/${encodeURIComponent(artifactName)}`,
    },
  },
}

await writeFile(outputPath, `${JSON.stringify(latest, null, 2)}\n`, "utf8")
