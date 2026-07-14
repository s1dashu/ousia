#!/bin/zsh

set -euo pipefail

fail() {
  print -u2 -- "release-macos: $*"
  exit 1
}

for variable in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  [[ -n "${(P)variable:-}" ]] || fail "$variable is required"
done

security find-identity -v -p codesigning | rg -F -- "$APPLE_SIGNING_IDENTITY" >/dev/null ||
  fail "Developer ID identity is not available in the login keychain: $APPLE_SIGNING_IDENTITY"

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
  --password "$APPLE_PASSWORD" \
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
