#!/bin/zsh

set -euo pipefail

fail() {
  print -u2 -- "release-macos: $*"
  exit 1
}

for variable in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  [[ -n "${(P)variable:-}" ]] || fail "$variable is required"
done

if [[ -z "${APPLE_SIGN_IDENTITY:-}" ]]; then
  identity_candidates=("${(@f)$(
    security find-identity -v -p codesigning |
      rg -o '"[^"]*Developer ID Application:[^"]+"' |
      sed 's/^"//; s/"$//'
  )}")
  (( ${#identity_candidates} == 1 )) ||
    fail "APPLE_SIGN_IDENTITY is required when the login keychain does not contain exactly one Developer ID Application identity"
  APPLE_SIGN_IDENTITY=${identity_candidates[1]}
  print -- "Using detected Developer ID identity: $APPLE_SIGN_IDENTITY"
fi

security find-identity -v -p codesigning | rg -F -- "$APPLE_SIGN_IDENTITY" >/dev/null ||
  fail "Developer ID identity is not available in the login keychain: $APPLE_SIGN_IDENTITY"

# Preserve Ousia's established release environment as the operator-facing
# contract. Tauri reads these aliases from this process only; credential values
# are never persisted by the release script.
export APPLE_SIGNING_IDENTITY="$APPLE_SIGN_IDENTITY"
export APPLE_PASSWORD="$APPLE_APP_SPECIFIC_PASSWORD"

root_dir=${0:a:h:h}
cd "$root_dir"

version=$(node -p "require('./package.json').version")
[[ -n "$version" ]] || fail "package.json does not contain a version"

npm run desktop:build -- --bundles app,dmg

app_path="$root_dir/src-tauri/target/release/bundle/macos/Pi.app"
dmg_dir="$root_dir/src-tauri/target/release/bundle/dmg"
dmg_paths=("$dmg_dir"/Pi_"$version"_*.dmg(N))

[[ -d "$app_path" ]] || fail "Tauri did not produce $app_path"
(( ${#dmg_paths} == 1 )) || fail "expected exactly one Pi $version DMG, found ${#dmg_paths}"
dmg_path=${dmg_paths[1]}

codesign --verify --deep --strict --verbose=2 "$app_path"
spctl --assess --type execute --verbose=4 "$app_path"
xcrun stapler validate "$app_path"

hdiutil verify "$dmg_path"
codesign --verify --verbose=2 "$dmg_path"
xcrun notarytool submit "$dmg_path" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
xcrun stapler staple "$dmg_path"
spctl --assess --type install --verbose=4 "$dmg_path"
xcrun stapler validate "$dmg_path"

zip_path="${dmg_path%.dmg}.zip"
rm -f "$zip_path"
ditto -c -k --sequesterRsrc --keepParent "$app_path" "$zip_path"

zip_verify_dir=$(mktemp -d)
ditto -x -k "$zip_path" "$zip_verify_dir"
codesign --verify --deep --strict --verbose=2 "$zip_verify_dir/Pi.app"
spctl --assess --type execute --verbose=4 "$zip_verify_dir/Pi.app"
xcrun stapler validate "$zip_verify_dir/Pi.app"
rm -rf "$zip_verify_dir"

checksum_path="$dmg_dir/Pi_${version}_SHA256SUMS.txt"
(
  cd "$dmg_dir"
  shasum -a 256 "${dmg_path:t}" "${zip_path:t}" > "${checksum_path:t}"
)

print -- "Verified release artifacts:"
print -- "$dmg_path"
print -- "$zip_path"
print -- "$checksum_path"
