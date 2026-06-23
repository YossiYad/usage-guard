#!/usr/bin/env pwsh
# usage-guard: cross-source usage reader for Windows / PowerShell.
# Prints key=value lines (or -Json) describing how much usage is left.
# Sources, in priority order: local snapshot -> oauth usage endpoint -> unavailable.
# Never invents numbers. Anything it cannot read from a real source is reported as "unknown".

[CmdletBinding()]
param(
    [switch]$Json,
    [int]$MaxSnapshotAgeSeconds = 180
)

$ErrorActionPreference = 'Stop'

$claudeDir   = Join-Path $env:USERPROFILE '.claude'
$snapshotPath = Join-Path $claudeDir 'usage-snapshot.json'
$credsPath    = Join-Path $claudeDir '.credentials.json'
$usageUrl     = 'https://api.anthropic.com/api/oauth/usage'

$result = [ordered]@{
    source                = 'unavailable'
    five_hour_pct         = 'unknown'
    seven_day_pct         = 'unknown'
    context_pct           = 'unknown'
    five_hour_resets_at   = 'unknown'
    seven_day_resets_at   = 'unknown'
    snapshot_age_seconds  = 'unknown'
    note                  = ''
}

function Format-Pct($v) {
    if ($null -eq $v) { return 'unknown' }
    if ($v -is [string] -and $v -eq '') { return 'unknown' }
    try { return [string][math]::Round([double]$v) } catch { return 'unknown' }
}

# --- 1) Local snapshot written by the status line ---------------------------
$snapshotUsed = $false
if (Test-Path $snapshotPath) {
    try {
        $snap = Get-Content $snapshotPath -Raw | ConvertFrom-Json
        $ts = [datetimeoffset]::Parse($snap.timestamp)
        $age = [int]([datetimeoffset]::UtcNow - $ts.ToUniversalTime()).TotalSeconds
        $result.snapshot_age_seconds = $age
        if ($age -le $MaxSnapshotAgeSeconds) {
            $result.source              = 'snapshot'
            $result.five_hour_pct       = Format-Pct $snap.five_hour_pct
            $result.seven_day_pct       = Format-Pct $snap.seven_day_pct
            $result.context_pct         = Format-Pct $snap.context_pct
            if ($snap.five_hour_resets_at) { $result.five_hour_resets_at = [string]$snap.five_hour_resets_at }
            if ($snap.seven_day_resets_at) { $result.seven_day_resets_at = [string]$snap.seven_day_resets_at }
            $result.note = "fresh snapshot (${age}s old)"
            $snapshotUsed = $true
        }
    } catch {
        $result.note = "snapshot unreadable: $($_.Exception.Message)"
    }
}

# --- 2) Fallback: oauth usage endpoint --------------------------------------
if (-not $snapshotUsed) {
    $token = $null
    if (Test-Path $credsPath) {
        try {
            $creds = Get-Content $credsPath -Raw | ConvertFrom-Json
            $token = $creds.claudeAiOauth.accessToken
        } catch {
            $result.note = "credentials unreadable: $($_.Exception.Message)"
        }
    } else {
        $result.note = 'credentials file not found'
    }

    if ($token) {
        try {
            $headers = @{ 'Authorization' = "Bearer $token"; 'anthropic-beta' = 'oauth-2025-04-20' }
            $resp = Invoke-RestMethod -Uri $usageUrl -Headers $headers -Method Get -TimeoutSec 15
            $result.source            = 'api'
            $result.five_hour_pct     = Format-Pct $resp.five_hour.utilization
            $result.seven_day_pct     = Format-Pct $resp.seven_day.utilization
            if ($resp.five_hour.resets_at) { $result.five_hour_resets_at = [string]$resp.five_hour.resets_at }
            if ($resp.seven_day.resets_at) { $result.seven_day_resets_at = [string]$resp.seven_day.resets_at }
            $result.note = 'live from unofficial oauth usage endpoint; context fill not available here - use /context'
        } catch {
            $status = ''
            if ($_.Exception.Response) { try { $status = [int]$_.Exception.Response.StatusCode } catch {} }
            $reason = $_.Exception.Message
            if ($status) { $reason = "HTTP $status - $reason" }
            $result.source = 'unavailable'
            $result.note   = "endpoint failed: $reason"
        }
    } elseif (-not $result.note) {
        $result.note = 'no access token in credentials'
    }
}

# --- output -----------------------------------------------------------------
if ($Json) {
    $result | ConvertTo-Json -Compress
} else {
    foreach ($k in $result.Keys) { "$k=$($result[$k])" }
}
