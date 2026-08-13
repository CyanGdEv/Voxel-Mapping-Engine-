#!/usr/bin/env bash
set -euo pipefail

MCWORLD_PATH="${1:-}"
PARK_PRESET="${2:-}"

if [[ -z "$MCWORLD_PATH" || -z "$PARK_PRESET" ]]; then
  echo "usage: publish-mcworld-release.sh <world.mcworld> <park-preset>" >&2
  exit 2
fi

for required_name in GITHUB_REPOSITORY GITHUB_SHA GITHUB_OUTPUT; do
  if [[ -z "${!required_name:-}" ]]; then
    echo "missing required GitHub Actions variable: $required_name" >&2
    exit 2
  fi
done

# A player-facing asset must be traceable to the exact checked-out source. This
# catches accidental publication from a stale workspace or wrong ref before the
# stable release tag is touched.
CHECKOUT_SHA="$(git rev-parse HEAD 2>/dev/null || true)"
if [[ -z "$CHECKOUT_SHA" || "$CHECKOUT_SHA" != "$GITHUB_SHA" ]]; then
  echo "checkout/source identity mismatch (${CHECKOUT_SHA:-missing} != $GITHUB_SHA)" >&2
  exit 1
fi

if [[ ! -f "$MCWORLD_PATH" ]]; then
  echo "generated .mcworld does not exist: $MCWORLD_PATH" >&2
  exit 1
fi

ORIGINAL_ASSET_NAME="$(basename "$MCWORLD_PATH")"
if [[ "$ORIGINAL_ASSET_NAME" != *.mcworld ]]; then
  echo "generated world must use the .mcworld extension: $ORIGINAL_ASSET_NAME" >&2
  exit 1
fi

# Publication is the final player-facing trust boundary. Validate the exact file
# that will be released even if the build runner returned through a cache/fast
# path before its ordinary end-of-run checks. A tiny/incomplete Alton world must
# never become a successful download again.
COMPLETENESS_VALIDATOR="scripts/validate-generated-world-completeness.mjs"
if [[ ! -f "$COMPLETENESS_VALIDATOR" ]]; then
  echo "world completeness validator is missing: $COMPLETENESS_VALIDATOR" >&2
  exit 1
fi
WORLD_OUTPUT_DIR="$(dirname "$MCWORLD_PATH")"
node "$COMPLETENESS_VALIDATOR" \
  --output "$WORLD_OUTPUT_DIR" \
  --world "$MCWORLD_PATH" \
  --preset "$PARK_PRESET" \
  --expected-chunks 0

WORLD_BYTES="$(stat -c '%s' "$MCWORLD_PATH")"
WORLD_SHA256="$(sha256sum "$MCWORLD_PATH" | cut -d' ' -f1)"
SHORT_SOURCE_SHA="${GITHUB_SHA:0:12}"
SHORT_WORLD_SHA="${WORLD_SHA256:0:12}"
ASSET_NAME="${PARK_PRESET}-${SHORT_SOURCE_SHA}-${SHORT_WORLD_SHA}.mcworld"
STAGED_ASSET="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/${ASSET_NAME}"
cp "$MCWORLD_PATH" "$STAGED_ASSET"

# Prove the staged upload is byte-for-byte identical to the validated world.
STAGED_BYTES="$(stat -c '%s' "$STAGED_ASSET")"
STAGED_SHA256="$(sha256sum "$STAGED_ASSET" | cut -d' ' -f1)"
if [[ "$STAGED_BYTES" != "$WORLD_BYTES" || "$STAGED_SHA256" != "$WORLD_SHA256" ]]; then
  echo "staged release asset differs from validated .mcworld" >&2
  exit 1
fi

RELEASE_TAG="generated-world-${PARK_PRESET}-latest"
RELEASE_TITLE="Latest generated world — ${PARK_PRESET//-/ }"
NOTES_FILE="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/${RELEASE_TAG}-notes.md"

{
  printf '%s\n' "Direct Minecraft Bedrock world download for **${PARK_PRESET}**."
  printf '\n'
  printf '%s\n' "Generated from commit \`${GITHUB_SHA}\` by [Actions run ${GITHUB_RUN_NUMBER:-unknown}](https://github.com/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID:-})."
  printf '%s\n' "World SHA-256: \`${WORLD_SHA256}\`"
  printf '%s\n' "World bytes: \`${WORLD_BYTES}\`"
  printf '%s\n' "Asset: \`${ASSET_NAME}\`"
  printf '%s\n' 'The release publisher validates completeness before upload; incomplete or stale worlds fail closed.'
  printf '%s\n' 'Download the `.mcworld` asset below and open it directly in Minecraft. No artifact ZIP extraction is required.'
} > "$NOTES_FILE"

if gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  gh release edit "$RELEASE_TAG" \
    --repo "$GITHUB_REPOSITORY" \
    --target "$GITHUB_SHA" \
    --title "$RELEASE_TITLE" \
    --notes-file "$NOTES_FILE" \
    --prerelease
else
  gh release create "$RELEASE_TAG" \
    --repo "$GITHUB_REPOSITORY" \
    --target "$GITHUB_SHA" \
    --title "$RELEASE_TITLE" \
    --notes-file "$NOTES_FILE" \
    --prerelease \
    --latest=false
fi

# Never overwrite an identically-named asset. The source commit and content hash
# are part of the filename, so the delivered file has an unambiguous identity.
gh release upload "$RELEASE_TAG" "$STAGED_ASSET" \
  --repo "$GITHUB_REPOSITORY"

# Verify GitHub stored the same byte count before replacing the stable release's
# previous world asset. This prevents a failed/partial upload from deleting the
# last known download.
REMOTE_BYTES="$(gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${RELEASE_TAG}" --jq ".assets[] | select(.name == \"${ASSET_NAME}\") | .size" | tail -n1)"
if [[ "$REMOTE_BYTES" != "$WORLD_BYTES" ]]; then
  echo "uploaded release asset byte count mismatch (${REMOTE_BYTES:-missing} != $WORLD_BYTES)" >&2
  exit 1
fi

# Keep exactly one player-facing .mcworld on the stable tag. Older differently
# named worlds are removed only after the new validated upload is confirmed.
while IFS= read -r OLD_ASSET; do
  [[ -z "$OLD_ASSET" || "$OLD_ASSET" == "$ASSET_NAME" || "$OLD_ASSET" != *.mcworld ]] && continue
  gh release delete-asset "$RELEASE_TAG" "$OLD_ASSET" --repo "$GITHUB_REPOSITORY" --yes
done < <(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name')

ENCODED_ASSET_NAME="$(node -p 'encodeURIComponent(process.argv[1])' "$ASSET_NAME")"
DOWNLOAD_URL="https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_TAG}/${ENCODED_ASSET_NAME}"

printf 'asset_name=%s\n' "$ASSET_NAME" >> "$GITHUB_OUTPUT"
printf 'download_url=%s\n' "$DOWNLOAD_URL" >> "$GITHUB_OUTPUT"
printf 'release_tag=%s\n' "$RELEASE_TAG" >> "$GITHUB_OUTPUT"
printf 'world_sha256=%s\n' "$WORLD_SHA256" >> "$GITHUB_OUTPUT"
printf 'world_bytes=%s\n' "$WORLD_BYTES" >> "$GITHUB_OUTPUT"
printf 'source_sha=%s\n' "$GITHUB_SHA" >> "$GITHUB_OUTPUT"
printf 'Published validated direct .mcworld download: %s\n' "$DOWNLOAD_URL"
