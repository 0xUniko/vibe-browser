#!/usr/bin/env bash
set -euo pipefail

# Install vibe-browser "skill" into Claude Code's skills directory.
# Usage (project scope, default):
#   curl -fsSL https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-claude-code-skill.sh | bash
#
# Optional env vars:
#   REPO_URL      (default: https://github.com/0xUniko/vibe-browser.git)
#   REPO_REF      (default: main)  # branch/tag/commit
#   SKILL_NAME    (default: vibe-browser)
#   TARGET_DIR    (default: current directory) # used when CLAUDE_SCOPE=project
#   CLAUDE_SCOPE  (default: project)           # project | user

REPO_URL="${REPO_URL:-https://github.com/0xUniko/vibe-browser.git}"
REPO_REF="${REPO_REF:-main}"
SKILL_NAME="${SKILL_NAME:-vibe-browser}"
TARGET_DIR="${TARGET_DIR:-$(pwd)}"
CLAUDE_SCOPE="${CLAUDE_SCOPE:-project}"

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
need_cmd head
need_cmd grep
need_cmd mv

if [[ "$CLAUDE_SCOPE" != "project" && "$CLAUDE_SCOPE" != "user" ]]; then
  echo "error: CLAUDE_SCOPE must be 'project' or 'user' (got: $CLAUDE_SCOPE)" >&2
  exit 1
fi

if [[ "$CLAUDE_SCOPE" == "project" ]]; then
  if [[ ! -d "$TARGET_DIR" ]]; then
    echo "error: TARGET_DIR does not exist: $TARGET_DIR" >&2
    exit 1
  fi
  TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
  DEST_DIR="$TARGET_DIR/.claude/skills/$SKILL_NAME"
else
  DEST_DIR="${HOME}/.claude/skills/$SKILL_NAME"
fi

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
mkdir -p "$DEST_DIR"

# Copy whole skill directory content to destination
cp -a "$SRC_SKILL_DIR/." "$DEST_DIR/"

# Ensure the SKILL.md frontmatter name matches SKILL_NAME (Claude Code uses this as the slash command).
SKILL_MD="$DEST_DIR/SKILL.md"
if head -n 1 "$SKILL_MD" | grep -q '^---$'; then
  awk -v want_name="$SKILL_NAME" '
    BEGIN { in_fm=0; found_name=0; }
    NR==1 && $0=="---" { in_fm=1; print; next }
    in_fm==1 && $0=="---" {
      if (found_name==0) print "name: " want_name
      in_fm=0
      print
      next
    }
    in_fm==1 && $0 ~ /^name:[[:space:]]*/ { print "name: " want_name; found_name=1; next }
    { print }
  ' "$SKILL_MD" > "$SKILL_MD.tmp"
  mv "$SKILL_MD.tmp" "$SKILL_MD"
else
  {
    echo '---'
    echo "name: $SKILL_NAME"
    echo '---'
    echo
    cat "$SKILL_MD"
  } > "$SKILL_MD.tmp"
  mv "$SKILL_MD.tmp" "$SKILL_MD"
fi

echo "==> Done."
echo
echo "Next:"
if [[ "$CLAUDE_SCOPE" == "project" ]]; then
  echo "  1) Open Claude Code in this project directory"
else
  echo "  1) Restart Claude Code"
fi
echo "  2) Type '/$SKILL_NAME' to load the skill"
echo
echo "Installed:"
echo "  $DEST_DIR"

