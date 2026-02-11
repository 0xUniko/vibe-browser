$ErrorActionPreference = "Stop"

# Install vibe-browser skill into a target project's .agents/skills/ directory.
# Usage:
#   irm https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-skill.ps1 | iex
#
# Optional env vars:
#   REPO_URL   (default: https://github.com/0xUniko/vibe-browser.git)
#   REPO_REF   (default: main)  # branch/tag/commit
#   SKILL_NAME (default: vibe-browser)
#   TARGET_DIR (default: current directory)

$repoUrl = if ($env:REPO_URL) { $env:REPO_URL } else { "https://github.com/0xUniko/vibe-browser.git" }
$repoRef = if ($env:REPO_REF) { $env:REPO_REF } else { "main" }
$skillName = if ($env:SKILL_NAME) { $env:SKILL_NAME } else { "vibe-browser" }
$targetDir = if ($env:TARGET_DIR) { $env:TARGET_DIR } else { (Get-Location).Path }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "missing required command: git"
}

if (-not (Test-Path -LiteralPath $targetDir -PathType Container)) {
    throw "TARGET_DIR does not exist: $targetDir"
}

$targetDir = (Resolve-Path -LiteralPath $targetDir).Path
$destDir = Join-Path $targetDir (".agents\\skills\\{0}" -f $skillName)

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

    $requiredFiles = @(
        "SKILL.md"
        "relay.ts"
        "get-active-target.ts"
        "record-network.ts"
    )
    foreach ($file in $requiredFiles) {
        $path = Join-Path $srcSkillDir $file
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "missing required file in skill/: $file"
        }
    }

    $referencesDir = Join-Path $srcSkillDir "references"
    if (-not (Test-Path -LiteralPath $referencesDir -PathType Container)) {
        throw "missing required directory in skill/: references/"
    }

    Write-Host "==> Installing into: $destDir"
    Remove-Item -LiteralPath $destDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null

    foreach ($file in $requiredFiles) {
        Copy-Item -LiteralPath (Join-Path $srcSkillDir $file) -Destination (Join-Path $destDir $file) -Force
    }
    Copy-Item -LiteralPath $referencesDir -Destination (Join-Path $destDir "references") -Recurse -Force

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
    Write-Host "  1) Restart your local agent in this project directory"
    Write-Host ("  2) Load '/{0}' in your agent" -f $skillName)
    Write-Host ""
    Write-Host "Installed:"
    Write-Host ("  {0}" -f $destDir)
}
finally {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
