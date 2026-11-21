$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$root = Join-Path $repo ('.tools/automatic-training-test-' + [Guid]::NewGuid().ToString('N'))
$prepare = Join-Path $repo 'scripts/Prepare-AutomaticOcrTraining.ps1'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$weights = Join-Path $root 'synthetic-placeholder-not-a-real-model.pt'
[IO.File]::WriteAllText($weights, 'Synthetic preparation test only. NOT model weights; never run training with this fixture.')
$weightsHash = (Get-FileHash -LiteralPath $weights).Hash
$samples = @(); $number = 0
foreach ($split in @('train', 'val', 'test')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $root "images/$split"), (Join-Path $root "labels/$split") | Out-Null
    foreach ($id in 0..5) {
        $number++; $file = "images/$split/$id.png"; $path = Join-Path $root $file
        $image = [Drawing.Bitmap]::new(100, 100)
        try { $image.SetPixel($number, $number, [Drawing.Color]::FromArgb($number, 100, 150)); $image.Save($path, [Drawing.Imaging.ImageFormat]::Png) }
        finally { $image.Dispose() }
        [IO.File]::WriteAllText((Join-Path $root "labels/$split/$id.txt"), "$id 0.5 0.5 0.5 0.5")
        $samples += [pscustomobject]@{ file = $file; split = $split; sha256 = (Get-FileHash -LiteralPath $path).Hash; objectGroups = @("object-$number"); captureGroup = "capture-$number"; nearDuplicateGroup = "near-$number" }
    }
}
$manifest = [pscustomobject]@{ licenseReviewed = $true; identityImagesSynthetic = $true; samples = $samples }
function Save-Manifest { $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'groups.json') -Encoding utf8 }
function Invoke-Prepare([string]$name) { & $prepare -DatasetDirectory $root -ApprovedWeights $weights -ExpectedWeightsSha256 $weightsHash -UltralyticsVersion '8.3.0' -OutputDirectory (Join-Path $root $name) | Out-Null }
function Expect-Rejection([string]$name, [string]$reason) {
    try { Invoke-Prepare $name; throw 'expected_rejection_did_not_occur' }
    catch { if ($_.Exception.Message -ne $reason) { throw } }
}
Save-Manifest; Invoke-Prepare 'valid'
$plan = Get-Content -Raw (Join-Path $root 'valid/training-plan.json') | ConvertFrom-Json
if ($plan.status -ne 'prepared_not_trained' -or $plan.classes.Count -ne 6 -or $plan.exportArguments -notcontains 'format=onnx') { throw 'invalid_preparation_plan' }
$originalGroup = $manifest.samples[6].objectGroups
$manifest.samples[6].objectGroups = $manifest.samples[0].objectGroups
Save-Manifest; Expect-Rejection 'group-leak' 'cross_split_group_leakage'
$manifest.samples[6].objectGroups = $originalGroup
$duplicatePath = Join-Path $root $manifest.samples[6].file; $originalBytes = [IO.File]::ReadAllBytes($duplicatePath)
[IO.File]::WriteAllBytes($duplicatePath, [IO.File]::ReadAllBytes((Join-Path $root $manifest.samples[0].file)))
$manifest.samples[6].sha256 = $manifest.samples[0].sha256
Save-Manifest; Expect-Rejection 'hash-leak' 'image_checksum_mismatch_or_duplicate'
[IO.File]::WriteAllBytes($duplicatePath, $originalBytes); $manifest.samples[6].sha256 = (Get-FileHash -LiteralPath $duplicatePath).Hash
[IO.File]::WriteAllText((Join-Path $root 'labels/train/0.txt'), '6 0.5 0.5 0.5 0.5')
Save-Manifest; Expect-Rejection 'bad-class' 'invalid_six_class_annotation'
[IO.File]::WriteAllText((Join-Path $root 'labels/train/0.txt'), '0 0.5 0.5 0.5 0.5')
$manifest.identityImagesSynthetic = $false; Save-Manifest; Expect-Rejection 'identity-provenance' 'dataset_provenance_required'
$manifest.identityImagesSynthetic = $true; $manifest.samples[0].file = '../outside.png'
Save-Manifest; Expect-Rejection 'outside' 'invalid_dataset_path'
Write-Output 'PASS: 6 preparation/validation scenarios. Synthetic placeholders only; no model training/export/inference performed.'
