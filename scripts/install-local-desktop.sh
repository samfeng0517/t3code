#!/usr/bin/env bash
# Builds the macOS desktop app from this checkout and replaces the installed copy.
#
#   scripts/install-local-desktop.sh               build, then quit, replace and reopen the app
#   scripts/install-local-desktop.sh --skip-build  reuse the existing dist bundles
#   scripts/install-local-desktop.sh --build-only  build and verify, leave the installed app alone
#
# The install step runs in its own session because quitting T3 Code ends every
# process it started, including a thread's shell that ran this script.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script installs the macOS app and only runs on macOS." >&2
  exit 1
fi

skip_build=()
build_only=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) skip_build=(--skip-build) ;;
    --build-only) build_only=true ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work_dir="$repo_root/release/local-install"
arch="$(uname -m)"
[[ "$arch" == "x86_64" ]] && arch="x64"

rm -rf "$work_dir/build" "$work_dir/app"
mkdir -p "$work_dir/build" "$work_dir/app"

(cd "$repo_root" && node scripts/build-desktop-artifact.ts --platform mac --target zip \
  --arch "$arch" --output-dir "$work_dir/build" ${skip_build[@]+"${skip_build[@]}"})

zip_path="$(find "$work_dir/build" -maxdepth 1 -name '*.zip' -print -quit)"
if [[ -z "$zip_path" ]]; then
  echo "The build produced no zip in $work_dir/build." >&2
  exit 1
fi
ditto -x -k "$zip_path" "$work_dir/app"
new_app="$(find "$work_dir/app" -maxdepth 1 -name '*.app' -print -quit)"
if [[ -z "$new_app" ]]; then
  echo "$zip_path contains no app bundle." >&2
  exit 1
fi

codesign --verify --deep --strict "$new_app"
# An ad hoc identity changes every build, so macOS privacy grants and 1Password's trust would reset.
if codesign -dv "$new_app" 2>&1 | grep -q 'Signature=adhoc'; then
  echo "The build is ad hoc signed. Set T3CODE_MACOS_DEV_SIGNING_IDENTITY to a signing identity and rebuild." >&2
  exit 1
fi

app_name="$(basename "$new_app")"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$new_app/Contents/Info.plist")"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$new_app/Contents/Info.plist")"
echo "Built $app_name $version ($bundle_id) at $new_app"

if [[ "$build_only" == true ]]; then
  exit 0
fi

installer="$work_dir/install.sh"
log="$work_dir/install.log"
cat >"$installer" <<'INSTALLER'
#!/usr/bin/env bash
set -euo pipefail
new_app="$1" bundle_id="$2" work_dir="$3"
target="/Applications/$(basename "$new_app")"
backup="$work_dir/previous/$(basename "$new_app")"
echo "$(date '+%F %T') installing $new_app"

running() { [[ "$(osascript -e "application id \"$bundle_id\" is running")" == "true" ]]; }

if running; then
  osascript -e "tell application id \"$bundle_id\" to quit"
  for _ in $(seq 1 120); do
    running || break
    sleep 0.5
  done
  if running; then
    echo "The app did not quit within 60 seconds; the installed copy was left in place."
    exit 1
  fi
fi

if [[ -d "$target" ]]; then
  rm -rf "$backup"
  mkdir -p "$(dirname "$backup")"
  mv "$target" "$backup"
fi
ditto "$new_app" "$target"
open -b "$bundle_id"
echo "$(date '+%F %T') installed $target; the previous copy is at $backup"
INSTALLER
chmod +x "$installer"

# perl's setsid puts the installer outside T3 Code's process group, so the quit does not take it down.
nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' "$installer" "$new_app" "$bundle_id" "$work_dir" \
  >"$log" 2>&1 </dev/null &
echo "Installing in the background: $app_name will quit, be replaced and reopen."
echo "Log: $log"
