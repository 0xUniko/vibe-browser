#!/usr/bin/env bash
set -euo pipefail

# Install vibe-browser "skill" into a target project's .opencode/skills/ directory
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-opencode-skill.sh | bash
#
# Optional env vars:
#   REPO_URL   (default: https://github.com/0xUniko/vibe-browser.git)
#   REPO_REF   (default: main)  # branch/tag/commit
#   SKILL_NAME (default: vibe-browser)
#   TARGET_DIR (default: current directory)

REPO_URL="${REPO_URL:-https://github.com/0xUniko/vibe-browser.git}"
REPO_REF="${REPO_REF:-main}"
SKILL_NAME="${SKILL_NAME:-vibe-browser}"
TARGET_DIR="${TARGET_DIR:-$(pwd)}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: missing required command: $1" >&2
    exit 1
  }
}

need_cmd git
need_cmd mktemp
need_cmd cp
need_cmd rm
need_cmd mkdir
need_cmd awk
need_cmd sed

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "error: TARGET_DIR does not exist: $TARGET_DIR" >&2
  exit 1
fi

TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
DEST_DIR="$TARGET_DIR/.opencode/skills/$SKILL_NAME"

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

echo "==> Cloning repo into temp dir"
git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$tmpdir/repo" >/dev/null

SRC_SKILL_DIR="$tmpdir/repo/skill"
if [[ ! -d "$SRC_SKILL_DIR" ]]; then
  echo "error: repo does not contain expected directory: skill/" >&2
  echo "       looked for: $SRC_SKILL_DIR" >&2
  exit 1
fi

if [[ ! -f "$SRC_SKILL_DIR/SKILL.md" ]]; then
  echo "error: repo skill/ does not contain SKILL.md" >&2
  echo "       looked for: $SRC_SKILL_DIR/SKILL.md" >&2
  exit 1
fi

echo "==> Installing into: $DEST_DIR"
rm -rf "$DEST_DIR"
mkdir -p "$(dirname "$DEST_DIR")"
mkdir -p "$DEST_DIR"

# Copy whole skill directory content to destination
# (so SKILL.md + any README/package.json/examples are available)
cp -a "$SRC_SKILL_DIR/." "$DEST_DIR/"

# Ensure frontmatter name matches SKILL_NAME (OpenCode expects this)
# Only rewrites within the first YAML frontmatter block if present.
SKILL_MD="$DEST_DIR/SKILL.md"
if head -n 1 "$SKILL_MD" | grep -q '^---$'; then
  awk -v want_name="$SKILL_NAME" '
    BEGIN { in_fm=0; done=0; }
    NR==1 && $0=="---" { in_fm=1; print; next }
    in_fm==1 && $0=="---" { in_fm=0; done=1; print; next }
    in_fm==1 && $0 ~ /^name:[[:space:]]*/ { print "name: " want_name; next }
    { print }
  ' "$SKILL_MD" > "$SKILL_MD.tmp"
  mv "$SKILL_MD.tmp" "$SKILL_MD"
fi

echo "==> Done."
echo
echo "Next:"
echo "  1) Restart opencode in this project directory"
echo "  2) Check available skills in opencode UI"
echo
echo "Installed:"
echo "  $DEST_DIR"
