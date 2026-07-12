function requireEnabledPackagedSentry(bundleSource, release) {
  const enabledMarker = `desktop-sentry-build:enabled:${release}`
  if (!bundleSource.includes(enabledMarker)) {
    throw new Error(
      `Refusing to create a distributable with Sentry disabled: expected ${enabledMarker}`
    )
  }
}

module.exports = { requireEnabledPackagedSentry }
