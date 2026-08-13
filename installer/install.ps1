[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$InstallSafeDependencies,
    [switch]$InstallOptionalTools,
    [switch]$InstallAdapters,
    [string]$ReportPath = (Join-Path $PWD 'doctor-report.json')
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Get-CommandProbe {
    param([string]$Name, [string[]]$Arguments, [bool]$Required)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        return [ordered]@{ id = $Name; status = $(if ($Required) { 'missing' } else { 'optional' }); detail = 'Not found on PATH' }
    }
    $version = (& $command.Source @Arguments 2>&1 | Select-Object -First 1).ToString()
    return [ordered]@{ id = $Name; status = 'available'; detail = $version; path = $command.Source }
}

if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 or newer is required.' }
if (-not $IsWindows) { throw 'V1 supports Windows 10/11 only.' }

$probes = @(
    Get-CommandProbe node @('--version') $true
    Get-CommandProbe npm @('--version') $true
    Get-CommandProbe git @('--version') $true
    Get-CommandProbe ffmpeg @('-version') $true
    Get-CommandProbe ffprobe @('-version') $true
    Get-CommandProbe python @('--version') $false
)

$nodeMajor = if (($probes | Where-Object id -eq 'node').detail -match 'v(\d+)') { [int]$Matches[1] } else { 0 }
if ($nodeMajor -lt 22) { ($probes | Where-Object id -eq 'node').status = 'missing' }

if ($InstallSafeDependencies -and $PSCmdlet.ShouldProcess($repoRoot, 'Install npm dependencies')) {
    & npm install --prefix $repoRoot
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
    & npm run build --prefix $repoRoot
    if ($LASTEXITCODE -ne 0) { throw 'npm build failed.' }
}

if ($InstallOptionalTools) {
    $optionalInstalls = @(
        [ordered]@{ name = 'edge-tts'; command = 'python'; arguments = @('-m','pip','install','--user','edge-tts') }
        [ordered]@{ name = 'whisper'; command = 'python'; arguments = @('-m','pip','install','--user','openai-whisper') }
        [ordered]@{ name = 'crawl4ai'; command = 'python'; arguments = @('-m','pip','install','--user','crawl4ai') }
    )
    foreach ($install in $optionalInstalls) {
        if (-not (Get-Command $install.name -ErrorAction SilentlyContinue) -and $PSCmdlet.ShouldProcess($install.name, 'Install optional user-level dependency')) {
            & $install.command @($install.arguments)
            if ($LASTEXITCODE -ne 0) { throw "Failed to install $($install.name)." }
        }
    }
    if (-not (Get-Command agent-reach -ErrorAction SilentlyContinue)) {
        Write-Warning 'Agent Reach is optional and requires its official installer; see https://github.com/Panniantong/Agent-Reach.'
    }
    if ($PSCmdlet.ShouldProcess($repoRoot, 'Install Playwright Chromium')) {
        & npx --prefix $repoRoot playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw 'Playwright Chromium installation failed.' }
    }
}

$adapterRoots = [ordered]@{
    codex = Join-Path $env:USERPROFILE '.codex\skills'
    trae = Join-Path $env:USERPROFILE '.trae\skills'
    hermes = Join-Path $env:USERPROFILE '.hermes\skills'
    codebuddy = Join-Path $env:USERPROFILE '.codebuddy\skills'
    workbuddy = Join-Path $env:USERPROFILE '.workbuddy\skills'
}

$installedAdapters = @()
if ($InstallAdapters) {
    $cliPath = Join-Path $repoRoot 'dist\cli\index.js'
    if (-not (Test-Path -LiteralPath $cliPath)) {
        throw "Cannot install adapters before the CLI is built. Run: npm run build --prefix `"$repoRoot`""
    }
    foreach ($entry in $adapterRoots.GetEnumerator()) {
        $source = Join-Path $repoRoot "adapters\$($entry.Key)\SKILL.md"
        if (Test-Path -LiteralPath $source) {
            $target = Join-Path $entry.Value 'ai-drama-leadgen'
            if ($PSCmdlet.ShouldProcess($target, "Install $($entry.Key) adapter")) {
                New-Item -ItemType Directory -Path $target -Force | Out-Null
                $adapter = (Get-Content -LiteralPath $source -Raw).Replace('{{REPO_ROOT}}', $repoRoot)
                Set-Content -LiteralPath (Join-Path $target 'SKILL.md') -Value $adapter -Encoding utf8
                [ordered]@{
                    repository = $repoRoot
                    command = "node `"$(Join-Path $repoRoot 'dist\cli\index.js')`""
                } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target 'COMMAND.json') -Encoding utf8
                $installedAdapters += $entry.Key
            }
        }
    }
}

$credentialNames = @('PIXABAY_API_KEY','PEXELS_API_KEY','AGNES_API_KEY','MIMO_API_KEY','FREESOUND_API_KEY','FIRECRAWL_API_KEY')
$credentialTargets = (& cmdkey /list 2>$null) -join "`n"
$credentials = foreach ($name in $credentialNames) {
    $configured = [bool][Environment]::GetEnvironmentVariable($name)
    $source = if ($configured) { 'environment' } else { $null }
    if ($name -eq 'MIMO_API_KEY' -and $credentialTargets -match 'target=ai-commerce-mimo-tts') {
        $configured = $true
        $source = 'windows-credential-manager'
    }
    [ordered]@{ name = $name; configured = $configured; source = $source }
}
$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($repoRoot).TrimEnd('\').TrimEnd(':'))
$report = [ordered]@{
    generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    platform = [ordered]@{ os = [Environment]::OSVersion.VersionString; architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() }
    hardware = [ordered]@{ cpuLogicalCores = [Environment]::ProcessorCount; memoryBytes = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory; freeDiskBytes = $drive.Free }
    dependencies = $probes
    hyperframesVersion = '0.7.107'
    credentials = $credentials
    installedAdapters = $installedAdapters
    manualActions = @('Install missing required tools', 'Enter API keys', 'Complete account registration or payment', 'Approve UAC or security policy changes')
}
if ($PSCmdlet.ShouldProcess($ReportPath, 'Write doctor report')) {
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding utf8
    Write-Host "Doctor report: $([IO.Path]::GetFullPath($ReportPath))"
}
if ($probes.status -contains 'missing') { exit 1 }
