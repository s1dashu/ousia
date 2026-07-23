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

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  updater_key_path=${TAURI_SIGNING_PRIVATE_KEY_PATH:-"$HOME/.tauri/pi-updater.key"}
  [[ -f "$updater_key_path" ]] ||
    fail "Tauri updater signing key is unavailable: $updater_key_path"
  export TAURI_SIGNING_PRIVATE_KEY=$(<"$updater_key_path")
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}
fi

npm run desktop:build -- --bundles app,dmg

app_path="$root_dir/src-tauri/target/release/bundle/macos/Pi.app"
dmg_dir="$root_dir/src-tauri/target/release/bundle/dmg"
dmg_paths=("$dmg_dir"/Pi_"$version"_*.dmg(N))
updater_dir="$root_dir/src-tauri/target/release/bundle/macos"
updater_path="$updater_dir/Pi.app.tar.gz"

[[ -d "$app_path" ]] || fail "Tauri did not produce $app_path"
(( ${#dmg_paths} == 1 )) || fail "expected exactly one Pi $version DMG, found ${#dmg_paths}"
[[ -s "$updater_path" ]] ||
  fail "Tauri did not produce updater archive $updater_path"
dmg_path=${dmg_paths[1]}
updater_signature_path="$updater_path.sig"
[[ -s "$updater_signature_path" ]] ||
  fail "Tauri did not produce updater signature $updater_signature_path"

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

updater_verify_dir=$(mktemp -d)
tar -xzf "$updater_path" -C "$updater_verify_dir"
updater_apps=("$updater_verify_dir"/Pi.app(N))
(( ${#updater_apps} == 1 )) ||
  fail "updater archive does not contain exactly one Pi.app"
codesign --verify --deep --strict --verbose=2 "${updater_apps[1]}"
spctl --assess --type execute --verbose=4 "${updater_apps[1]}"
xcrun stapler validate "${updater_apps[1]}"
rm -rf "$updater_verify_dir"

case "$(uname -m)" in
  arm64) updater_target=darwin-aarch64 ;;
  x86_64) updater_target=darwin-x86_64 ;;
  *) fail "unsupported macOS updater architecture: $(uname -m)" ;;
esac
latest_json_path="$updater_dir/latest.json"
node scripts/generate-latest-json.mjs \
  "$version" \
  "$updater_target" \
  "$updater_path" \
  "$updater_signature_path" \
  "$latest_json_path"

checksum_path="$dmg_dir/Pi_${version}_SHA256SUMS.txt"
(
  cd "$dmg_dir"
  shasum -a 256 "${dmg_path:t}" "${zip_path:t}" > "${checksum_path:t}"
)

print -- "Verified release artifacts:"
print -- "$dmg_path"
print -- "$zip_path"
print -- "$updater_path"
print -- "$updater_signature_path"
print -- "$latest_json_path"
print -- "$checksum_path"
