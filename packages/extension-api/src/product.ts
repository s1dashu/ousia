export interface ProductIdentity<ProductId extends string = string> {
  readonly id: ProductId
  readonly displayName: string
}

export interface DesktopPathPolicy {
  readonly userDataDirectoryName: string
  readonly runtimeLog: Readonly<{
    homeDirectoryName: string
    directoryName: string
    fileName: string
  }>
}

const productIdentityKeys = ["id", "displayName"] as const
const desktopPathPolicyKeys = [
  "userDataDirectoryName",
  "runtimeLog",
] as const
const runtimeLogKeys = ["homeDirectoryName", "directoryName", "fileName"] as const
const productIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

function assertRecord(
  value: unknown,
  field: string
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object.`)
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  field: string
) {
  const expected = new Set(expectedKeys)
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${field}.${key} is required.`)
    }
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new TypeError(`${field}.${key} is not supported.`)
    }
  }
}

function assertNonEmptyString(
  value: unknown,
  field: string
): asserts value is string {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new TypeError(`${field} must be a non-empty, trimmed string.`)
  }
}

function assertPathComponent(
  value: unknown,
  field: string
): asserts value is string {
  assertNonEmptyString(value, field)
  if (
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new TypeError(`${field} must be a single safe path component.`)
  }
}

export function snapshotProductIdentity<const ProductId extends string>(
  value: ProductIdentity<ProductId>
): Readonly<ProductIdentity<ProductId>> {
  assertRecord(value, "productIdentity")
  assertExactKeys(value, productIdentityKeys, "productIdentity")
  assertNonEmptyString(value.id, "productIdentity.id")
  if (!productIdPattern.test(value.id)) {
    throw new TypeError(
      "productIdentity.id must be a lowercase kebab-case identifier."
    )
  }
  assertNonEmptyString(value.displayName, "productIdentity.displayName")
  return Object.freeze({ ...value })
}

export function defineProductIdentity<const ProductId extends string>(
  value: ProductIdentity<ProductId>
): Readonly<ProductIdentity<ProductId>> {
  return snapshotProductIdentity(value)
}

export function snapshotDesktopPathPolicy(
  value: DesktopPathPolicy
): Readonly<DesktopPathPolicy> {
  assertRecord(value, "desktopPathPolicy")
  assertExactKeys(value, desktopPathPolicyKeys, "desktopPathPolicy")
  assertPathComponent(
    value.userDataDirectoryName,
    "desktopPathPolicy.userDataDirectoryName"
  )
  assertRecord(value.runtimeLog, "desktopPathPolicy.runtimeLog")
  assertExactKeys(value.runtimeLog, runtimeLogKeys, "desktopPathPolicy.runtimeLog")
  assertPathComponent(
    value.runtimeLog.homeDirectoryName,
    "desktopPathPolicy.runtimeLog.homeDirectoryName"
  )
  assertPathComponent(
    value.runtimeLog.directoryName,
    "desktopPathPolicy.runtimeLog.directoryName"
  )
  assertPathComponent(
    value.runtimeLog.fileName,
    "desktopPathPolicy.runtimeLog.fileName"
  )

  return Object.freeze({
    ...value,
    runtimeLog: Object.freeze({ ...value.runtimeLog }),
  })
}

export function defineDesktopPathPolicy(
  value: DesktopPathPolicy
): Readonly<DesktopPathPolicy> {
  return snapshotDesktopPathPolicy(value)
}
