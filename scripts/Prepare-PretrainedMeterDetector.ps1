param(
    [Parameter(Mandatory = $true)][string]$Python,
    [switch]$IncludeCandidateB,
    [switch]$IncludeStage2,
    [switch]$IncludeFullPublicTest,
    [switch]$EnableDevelopment
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$models = Join-Path $repo '.tools/meter-detection-models'
$images = Join-Path $repo '.tools/meter-detection-evaluation'
New-Item -ItemType Directory -Force -Path $models, $images | Out-Null
function Get-PinnedFile([string]$Uri, [string]$Path, [string]$Sha256) {
    if (-not (Test-Path -LiteralPath $Path)) { Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Path }
    if ($Sha256 -and (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) {
        throw 'Downloaded model failed its pinned SHA256 check.'
    }
}
Get-PinnedFile 'https://huggingface.co/ntarekp/watermeter-yolov8-obb/resolve/c00b2752e3ad762eb269a05e1dceb28f48c1f27b/stage1_meter_window_digits.pt' (Join-Path $models 'water-stage1.pt') 'f2882a477bc12ecc5526cf73438d254945271c3e1b2b4214aa8e4deb637c3be9'
if ($IncludeCandidateB) {
    Get-PinnedFile 'https://huggingface.co/alreaper/Rwanda_Water_Meter_Reading/resolve/d02910f0bea0fea2f71f46bdcdba34ff4c004d4e/best.pt' (Join-Path $models 'rwanda-best.pt') '7215bf64c237d7b376c4f0ac85141ace5b75acdbf5f8be805e2b8ac573269167'
}
# Public author test subset; never substitute private meter or identity images here.
$source = 'https://raw.githubusercontent.com/Ntarekp/Mbarira-Watermeter-model/72d1821ad6d97e00275bfd80c508df233555328a/dataset'
$manifest = Get-Content -LiteralPath (Join-Path $repo 'tools/BHome.OcrSmoke/model_tools/evaluation-manifest.json') -Raw | ConvertFrom-Json
foreach ($number in @(13, 14, 16, 17, 72, 80, 82, 111, 112, 113)) {
    $stem = 'wm_clean_{0:000000}' -f $number
    Get-PinnedFile "$source/images/test/$stem.jpg" (Join-Path $images "$stem.jpg") ([string]$manifest."$stem.jpg")
    Get-PinnedFile "$source/labels/test/$stem.txt" (Join-Path $images "$stem.txt") ([string]$manifest."$stem.txt")
}
if ($IncludeFullPublicTest) {
    $testImages = Join-Path $repo '.tools/meter-detection-all-test'
    New-Item -ItemType Directory -Force -Path $testImages | Out-Null
    $testManifest = Get-Content -LiteralPath (Join-Path $repo 'tools/BHome.OcrSmoke/model_tools/evaluation-full-test-manifest.json') -Raw | ConvertFrom-Json
    foreach ($entry in $testManifest.PSObject.Properties) {
        $folder = if ($entry.Name.EndsWith('.jpg')) { 'images' } else { 'labels' }
        Get-PinnedFile "$source/$folder/test/$($entry.Name)" (Join-Path $testImages $entry.Name) ([string]$entry.Value)
    }
}
$exporter = Join-Path $repo 'tools/BHome.OcrSmoke/model_tools/inspect_export_pretrained.py'
$exportArgs = @($exporter, $models, $images)
if ($IncludeCandidateB) { $exportArgs += '--include-candidate-b' }
& $Python @exportArgs
if ($LASTEXITCODE -ne 0) { throw 'Model export/native parity failed; Development settings were not changed.' }
$expected = '5311b093b39a2ef752c2052e2755ab8f595613d37d612e48c10dc26f6ecb9d44'
if ((Get-FileHash -LiteralPath (Join-Path $models 'water-stage1.onnx')).Hash.ToLowerInvariant() -ne $expected) {
    throw 'Export differs from the verified ONNX artifact. Check pinned Python/CPU dependencies; do not bypass the runtime hash.'
}
if ($IncludeStage2) {
    Get-PinnedFile 'https://huggingface.co/ntarekp/watermeter-yolov8-obb/resolve/c00b2752e3ad762eb269a05e1dceb28f48c1f27b/stage2_digits.pt' (Join-Path $models 'water-stage2.pt') 'f5553aaba25b49b8cab4b74d5b87f0ad68779a889fe19dcbc3139439a0f3ef02'
    & $Python $exporter $models $images '--stage2-only'
    if ($LASTEXITCODE -ne 0) { throw 'Stage2 export/native parity failed.' }
    if ((Get-FileHash -LiteralPath (Join-Path $models 'water-stage2.onnx')).Hash.ToLowerInvariant() -ne '2100d78ae1d762327cb871ee521a8dd9e84afc34de1cd8cf58876332e5834006') {
        throw 'Stage2 ONNX differs from the verified pinned artifact.'
    }
}
Copy-Item -LiteralPath (Join-Path $repo 'tools/BHome.OcrSmoke/model_tools/model-metadata.json') -Destination $models
Copy-Item -LiteralPath (Join-Path $repo 'tools/BHome.OcrSmoke/model_tools/README.md') -Destination $models
if ($EnableDevelopment) {
    # Only nonsensitive OCR settings; preserve all existing secrets.
    $settings = @{
        'Ocr:MeterDetector:Enabled' = 'true'
        'Ocr:MeterDetector:ModelDirectory' = $models
        'Ocr:MeterDetectionMinConfidence' = '0.7'
    }
    if ($IncludeStage2) { $settings['Ocr:MeterDetector:WaterDigitsEnabled'] = 'true' }
    $project = [xml][IO.File]::ReadAllText((Join-Path $repo 'src/backend/BHome.Api/BHome.Api.csproj'))
    $settings | ConvertTo-Json -Compress | dotnet user-secrets set --id ([string]$project.Project.PropertyGroup.UserSecretsId) | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not set Development detector settings.' }
    $envPath = Join-Path $repo '.env'
    if (Test-Path -LiteralPath $envPath) {
        $content = [IO.File]::ReadAllText($envPath)
        foreach ($key in $settings.Keys) {
            $envKey = $key.Replace(':', '__'); $value = $settings[$key]
            $pattern = '(?m)^' + [regex]::Escape($envKey) + '=.*$'
            if ([regex]::IsMatch($content, $pattern)) {
                $content = [regex]::Replace($content, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($m) "$envKey=$value" })
            } else { $content = $content.TrimEnd() + "`n$envKey=$value`n" }
        }
        [IO.File]::WriteAllText($envPath, $content, [Text.UTF8Encoding]::new($false))
    }
    Write-Output 'Development detector enabled. Restart the existing API debugging session; reload Mobile and use Test OCR.'
}
Write-Output 'Pinned water-window model and native/ONNX parity prepared locally. No training performed.'
