import {
  defineDesktopPathPolicy,
  defineProductIdentity,
} from "../src/index.js"

const identity = defineProductIdentity({
  id: "typed-product",
  displayName: "Typed Product",
})

const literalId: "typed-product" = identity.id
void literalId

defineProductIdentity({
  id: "typed-product",
  displayName: "Typed Product",
  // @ts-expect-error Unknown product identity fields are rejected by the API.
  protocol: "typed-asset",
})

// @ts-expect-error The returned identity does not advertise unknown fields.
void identity.protocol

defineDesktopPathPolicy({
  userDataDirectoryName: "typed-product-desktop",
  // @ts-expect-error Unknown path policy fields are rejected by the API.
  defaultWorkspaceDirectoryName: "Typed Product",
  runtimeLog: {
    homeDirectoryName: ".typed-product",
    directoryName: "logs",
    fileName: "typed-product.log",
  },
})
