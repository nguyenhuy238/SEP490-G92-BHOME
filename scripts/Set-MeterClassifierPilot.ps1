param([switch]$Rollback, [switch]$ValidateOnly)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pilot = Join-Path $repo '.tools/ocr-human-dataset/BHOME_4_meter_classes_starter_20261108/processed/training_4_classes'
$backupPath = Join-Path $pilot 'development-config-backup.json'
$environmentPath = Join-Path $repo '.env'
$project = [xml][IO.File]::ReadAllText((Join-Path $repo 'src/backend/BHome.Api/BHome.Api.csproj'))
$secretsId = [string]$project.Project.PropertyGroup.UserSecretsId
if (-not $secretsId) { throw 'The API must have a Development user-secrets ID.' }
$settings = [ordered]@{
    'Ocr:Enabled' = 'true'
    'Ocr:ModelDirectory' = (Join-Path $repo '.tools/ocr-models')
    'Ocr:VisualClassifier:Enabled' = 'true'
    'Ocr:VisualClassifier:ModelPath' = (Join-Path $pilot 'export_100epochs/body.onnx')
    'Ocr:VisualClassifier:Sha256' = ''
    'Ocr:VisualClassifier:CandidateThreshold' = '0.25'
    'Ocr:VisualClassifier:NmsThreshold' = '0.45'
    'Ocr:AutomaticClassificationMinConfidence' = '0.9'
    'Ocr:ExperimentalMeter:Enabled' = 'false'
}

function Read-Setting($Object, [string]$Key) {
    if ($null -eq $Object) { return $null }
    $flat = $Object.PSObject.Properties[$Key]
    if ($null -ne $flat) { if ($null -eq $flat.Value) { return $null }; return [string]$flat.Value }
    $at = $Object
    foreach ($part in $Key.Split(':')) {
        if ($null -eq $at -or $null -eq $at.PSObject.Properties[$part]) { return $null }
        $at = $at.PSObject.Properties[$part].Value
    }
    if ($null -eq $at) { return $null }
    return [string]$at
}

function Set-EnvironmentLine([string]$Text, [string]$Key, $Value) {
    $pattern = '(?m)^' + [regex]::Escape($Key.Replace(':', '__')) + '=[^\r\n]*\r?\n?'
    if ($null -eq $Value) { return [regex]::Replace($Text, $pattern, '') }
    $line = $Key.Replace(':', '__') + '=' + [string]$Value + "`n"
    if ([regex]::IsMatch($Text, $pattern)) {
        return [regex]::Replace($Text, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($m) $line })
    }
    return $Text.TrimEnd() + "`n" + $line
}

function Save-UserSettings($Values) {
    if ($Values.Count -gt 0) {
        $Values | ConvertTo-Json -Compress | dotnet user-secrets set --id $secretsId | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not save Development classifier settings.' }
    }
}

if ($Rollback) {
    if (-not (Test-Path -LiteralPath $backupPath)) { throw 'No pilot configuration backup exists.' }
    $backup = Get-Content -LiteralPath $backupPath -Raw | ConvertFrom-Json
    if ($backup.repository -ne $repo) { throw 'Backup belongs to a different checkout.' }
    $text = [IO.File]::ReadAllText($environmentPath)
    $restore = @{}
    foreach ($key in $settings.Keys) {
        $text = Set-EnvironmentLine $text $key (Read-Setting $backup.environment $key)
        $value = Read-Setting $backup.userSecrets $key
        if ($null -eq $value) {
            dotnet user-secrets remove $key --id $secretsId | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Could not remove pilot-only Development setting.' }
        } else { $restore[$key] = $value }
    }
    Save-UserSettings $restore
    [IO.File]::WriteAllText($environmentPath, $text, [Text.UTF8Encoding]::new($false))
    Write-Output 'Restored the previous Development classifier configuration. Restart the API to apply it.'
    return
}

$evaluation = Get-Content -LiteralPath (Join-Path $pilot 'export_100epochs/evaluation.json') -Raw | ConvertFrom-Json
$model = Get-Item -LiteralPath $settings['Ocr:VisualClassifier:ModelPath']
if ($model.LinkType -or $model.Length -gt 50MB -or $model.Length -lt 1024) { throw 'Unsupported classifier artifact.' }
$digest = (Get-FileHash -LiteralPath $model.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($digest -ne $evaluation.onnxSha256 -or ($evaluation.input -join ',') -ne '1,3,416,416' -or
    ($evaluation.output -join ',') -ne '1,8,3549' -or
    ($evaluation.classes -join ',') -ne 'electricity_mechanical,electricity_digital,water_mechanical,water_digital' -or
    $evaluation.correct -ne 9 -or $evaluation.wrong -ne 0 -or $evaluation.unknown -ne 0) {
    throw 'Pilot artifact contract or recorded nine-image verification does not match.'
}
$settings['Ocr:VisualClassifier:Sha256'] = $digest
if ($ValidateOnly) {
    Write-Output 'PASS: pilot checksum, tensor shapes, class order and recorded in-sample results. No configuration changed.'
    return
}
if (-not (Test-Path -LiteralPath $environmentPath)) { throw 'Initialize the existing local .env before enabling the pilot.' }
$text = [IO.File]::ReadAllText($environmentPath)
if (-not (Test-Path -LiteralPath $backupPath)) {
    $secretsPath = Join-Path $env:APPDATA "Microsoft/UserSecrets/$secretsId/secrets.json"
    $secrets = if (Test-Path -LiteralPath $secretsPath) { Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json } else { $null }
    $beforeEnvironment = @{}; $beforeSecrets = @{}
    foreach ($key in $settings.Keys) {
        $match = [regex]::Match($text, '(?m)^' + [regex]::Escape($key.Replace(':', '__')) + '=([^\r\n]*)')
        $beforeEnvironment[$key] = if ($match.Success) { $match.Groups[1].Value } else { $null }
        $beforeSecrets[$key] = Read-Setting $secrets $key
    }
    # Back up only these non-secret OCR settings, never the rest of .env/user-secrets.
    @{ repository = $repo; environment = $beforeEnvironment; userSecrets = $beforeSecrets } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $backupPath -Encoding UTF8
}
foreach ($key in $settings.Keys) { $text = Set-EnvironmentLine $text $key $settings[$key] }
Save-UserSettings $settings
[IO.File]::WriteAllText($environmentPath, $text, [Text.UTF8Encoding]::new($false))
Write-Output 'Enabled the nine-image classifier pilot in Development .env and user-secrets. Restart the API to apply it.'
Write-Output 'This is in-sample pipeline verification; independent accuracy remains unmeasured. Use -Rollback to restore the previous classifier configuration.'
