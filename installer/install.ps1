[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$InstallSafeDependencies,
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
    foreach ($entry in $adapterRoots.GetEnumerator()) {
        $source = Join-Path $repoRoot "adapters\$($entry.Key)\SKILL.md"
        if ((Test-Path -LiteralPath $entry.Value) -and (Test-Path -LiteralPath $source)) {
            $target = Join-Path $entry.Value 'ai-drama-leadgen'
            if ($PSCmdlet.ShouldProcess($target, "Install $($entry.Key) adapter")) {
                New-Item -ItemType Directory -Path $target -Force | Out-Null
                Copy-Item -LiteralPath $source -Destination (Join-Path $target 'SKILL.md') -Force
                $installedAdapters += $entry.Key
            }
        }
    }
}

$credentialNames = @('PIXABAY_API_KEY','PEXELS_API_KEY','AGNES_API_KEY','MIMO_API_KEY','FREESOUND_API_KEY','FIRECRAWL_API_KEY')
$credentials = foreach ($name in $credentialNames) { [ordered]@{ name = $name; configured = [bool][Environment]::GetEnvironmentVariable($name) } }
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
