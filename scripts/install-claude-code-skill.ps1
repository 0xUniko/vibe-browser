$ErrorActionPreference = "Stop"

# Install vibe-browser "skill" into Claude Code's skills directory.
# Usage (project scope, default):
#   irm https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-claude-code-skill.ps1 | iex
#
# Optional env vars:
#   REPO_URL      (default: https://github.com/0xUniko/vibe-browser.git)
#   REPO_REF      (default: main)  # branch/tag/commit
#   SKILL_NAME    (default: vibe-browser)
#   TARGET_DIR    (default: current directory) # used when CLAUDE_SCOPE=project
#   CLAUDE_SCOPE  (default: project)           # project | user

$repoUrl = if ($env:REPO_URL) { $env:REPO_URL } else { "https://github.com/0xUniko/vibe-browser.git" }
$repoRef = if ($env:REPO_REF) { $env:REPO_REF } else { "main" }
$skillName = if ($env:SKILL_NAME) { $env:SKILL_NAME } else { "vibe-browser" }
$targetDir = if ($env:TARGET_DIR) { $env:TARGET_DIR } else { (Get-Location).Path }
$claudeScope = if ($env:CLAUDE_SCOPE) { $env:CLAUDE_SCOPE } else { "project" }

if ($claudeScope -ne "project" -and $claudeScope -ne "user") {
    throw "CLAUDE_SCOPE must be 'project' or 'user' (got: $claudeScope)"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "missing required command: git"
}

if ($claudeScope -eq "project") {
    if (-not (Test-Path -LiteralPath $targetDir -PathType Container)) {
        throw "TARGET_DIR does not exist: $targetDir"
    }
    $targetDir = (Resolve-Path -LiteralPath $targetDir).Path
    $destDir = Join-Path $targetDir (".claude\\skills\\{0}" -f $skillName)
}
else {
    $destDir = Join-Path $HOME (".claude\\skills\\{0}" -f $skillName)
}

$tmpDir = Join-Path $env:TEMP ("vibe-browser-" + [guid]::NewGuid().ToString())
$repoDir = Join-Path $tmpDir "repo"

try {
    New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

    Write-Host "==> Cloning repo into temp dir"
    git clone --depth 1 --branch $repoRef $repoUrl $repoDir | Out-Null

    $srcSkillDir = Join-Path $repoDir "skill"
    if (-not (Test-Path -LiteralPath $srcSkillDir -PathType Container)) {
        throw "repo does not contain expected directory: skill/ (looked for: $srcSkillDir)"
    }

    $skillMd = Join-Path $srcSkillDir "SKILL.md"
    if (-not (Test-Path -LiteralPath $skillMd -PathType Leaf)) {
        throw "repo skill/ does not contain SKILL.md (looked for: $skillMd)"
    }

    Write-Host "==> Installing into: $destDir"
    Remove-Item -LiteralPath $destDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null

    # Copy all files including dotfiles.
    Get-ChildItem -LiteralPath $srcSkillDir -Force | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $destDir -Recurse -Force
    }

    $installedSkillMd = Join-Path $destDir "SKILL.md"
    $lines = Get-Content -LiteralPath $installedSkillMd

    if ($lines.Length -gt 0 -and $lines[0] -eq "---") {
        $end = -1
        for ($i = 1; $i -lt $lines.Length; $i++) {
            if ($lines[$i] -eq "---") { $end = $i; break }
        }
        if ($end -eq -1) { throw "SKILL.md frontmatter is unterminated (missing closing ---)" }

        $foundName = $false
        $new = New-Object System.Collections.Generic.List[string]
        $new.Add("---") | Out-Null
        for ($i = 1; $i -lt $end; $i++) {
            $line = $lines[$i]
            if ($line -match "^name:\\s*") {
                $new.Add("name: $skillName") | Out-Null
                $foundName = $true
            }
            else {
                $new.Add($line) | Out-Null
            }
        }
        if (-not $foundName) { $new.Add("name: $skillName") | Out-Null }
        $new.Add("---") | Out-Null
        for ($i = $end + 1; $i -lt $lines.Length; $i++) { $new.Add($lines[$i]) | Out-Null }

        Set-Content -LiteralPath $installedSkillMd -Value $new.ToArray() -Encoding utf8
    }
    else {
        $new = @(
            "---"
            ("name: {0}" -f $skillName)
            "---"
            ""
        ) + $lines
        Set-Content -LiteralPath $installedSkillMd -Value $new -Encoding utf8
    }

    Write-Host "==> Done."
    Write-Host ""
    Write-Host "Next:"
    if ($claudeScope -eq "project") {
        Write-Host "  1) Open Claude Code in this project directory"
    }
    else {
        Write-Host "  1) Restart Claude Code"
    }
    Write-Host ("  2) Type '/{0}' to load the skill" -f $skillName)
    Write-Host ""
    Write-Host "Installed:"
    Write-Host ("  {0}" -f $destDir)
}
finally {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

