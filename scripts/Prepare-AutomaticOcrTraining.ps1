param(
    [Parameter(Mandatory = $true)][string]$DatasetDirectory,
    [Parameter(Mandatory = $true)][string]$ApprovedWeights,
    [Parameter(Mandatory = $true)][string]$ExpectedWeightsSha256,
    [Parameter(Mandatory = $true)][string]$UltralyticsVersion,
    [Parameter(Mandatory = $true)][string]$OutputDirectory
)
# Offline preparation only. Never installs packages, downloads weights or starts training.
$ErrorActionPreference = 'Stop'
$classes = @('cccd_front', 'cccd_back', 'electricity_mechanical', 'electricity_digital', 'water_mechanical', 'water_digital')
$datasetRoot = (Resolve-Path -LiteralPath $DatasetDirectory).Path.TrimEnd('\', '/')
$weightsPath = (Resolve-Path -LiteralPath $ApprovedWeights).Path
if ([IO.Path]::GetExtension($weightsPath) -ne '.pt' -or (Get-FileHash -LiteralPath $weightsPath -Algorithm SHA256).Hash -ne $ExpectedWeightsSha256) { throw 'approved_weights_checksum_mismatch' }
if ($UltralyticsVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'exact_training_tool_version_required' }
$manifest = Get-Content -Raw -Encoding utf8 -LiteralPath (Join-Path $datasetRoot 'groups.json') | ConvertFrom-Json
if ($manifest.licenseReviewed -ne $true -or $manifest.identityImagesSynthetic -ne $true -or @($manifest.samples).Count -lt 1) { throw 'dataset_provenance_required' }
$groups = @{}; $hashes = @{}; $coverage = @{}; $images = @{}
foreach ($sample in $manifest.samples) {
    if ($sample.split -notin @('train', 'val', 'test') -or !$sample.captureGroup -or !$sample.nearDuplicateGroup -or
        !$sample.objectGroups -or @($sample.objectGroups | Where-Object { !$_ }).Count -gt 0) { throw 'split_and_groups_required' }
    $path = [IO.Path]::GetFullPath((Join-Path $datasetRoot $sample.file))
    if (!$path.StartsWith($datasetRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        $sample.file.Replace('\', '/') -notlike "images/$($sample.split)/*" -or [IO.Path]::GetExtension($path) -notin @('.png', '.jpg', '.jpeg')) { throw 'invalid_dataset_path' }
    # Do not follow reparse-point images/directories out of the declared dataset.
    $imageInfo = Get-Item -LiteralPath $path
    if ($imageInfo.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'reparse_point_not_supported' }
    for ($part = $imageInfo.Directory; $part -and $part.FullName.Length -ge $datasetRoot.Length; $part = $part.Parent) {
        if ($part.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'reparse_point_not_supported' }
        if ($part.FullName -eq $datasetRoot) { break }
    }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($hash -ne $sample.sha256 -or $hashes.ContainsKey($hash)) { throw 'image_checksum_mismatch_or_duplicate' }
    $hashes[$hash] = $sample.split; $images[$path] = $true
    foreach ($group in @($sample.objectGroups | ForEach-Object { "object:$_" }) + @("capture:$($sample.captureGroup)", "near:$($sample.nearDuplicateGroup)")) {
        if ($groups.ContainsKey($group) -and $groups[$group] -ne $sample.split) { throw 'cross_split_group_leakage' }
        $groups[$group] = $sample.split
    }
    $relativeLabel = [IO.Path]::ChangeExtension('labels/' + $sample.file.Replace('\', '/').Substring(7), '.txt')
    foreach ($line in Get-Content -LiteralPath (Join-Path $datasetRoot $relativeLabel)) {
        if (!$line.Trim()) { continue }
        $parts = $line.Trim() -split '\s+'
        if ($parts.Count -ne 5 -or $parts[0] -notmatch '^[0-5]$') { throw 'invalid_six_class_annotation' }
        $box = @($parts[1..4] | ForEach-Object { [double]::Parse($_, [Globalization.CultureInfo]::InvariantCulture) })
        if (@($box | Where-Object { [double]::IsNaN($_) -or [double]::IsInfinity($_) -or $_ -lt 0 -or $_ -gt 1 }).Count -gt 0 -or
            $box[2] -le 0 -or $box[3] -le 0 -or $box[0] - $box[2] / 2 -lt 0 -or $box[0] + $box[2] / 2 -gt 1 -or
            $box[1] - $box[3] / 2 -lt 0 -or $box[1] + $box[3] / 2 -gt 1) { throw 'invalid_normalized_box' }
        $coverage["$($sample.split):$($parts[0])"] = $true
    }
}
foreach ($split in @('train', 'val', 'test')) {
    foreach ($id in 0..5) { if (!$coverage.ContainsKey("${split}:$id")) { throw 'all_six_classes_required_in_each_split' } }
    foreach ($path in Get-ChildItem -LiteralPath (Join-Path $datasetRoot "images/$split") -File -Recurse) {
        if ($path.Extension -in @('.png', '.jpg', '.jpeg') -and !$images.ContainsKey($path.FullName)) { throw 'unlisted_training_image' }
    }
}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$outputRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path
$yamlPath = Join-Path $outputRoot 'dataset.yaml'
$planPath = Join-Path $outputRoot 'training-plan.json'
if ((Test-Path -LiteralPath $yamlPath) -or (Test-Path -LiteralPath $planPath)) { throw 'training_plan_already_exists' }
@("path: '$($datasetRoot.Replace('\', '/').Replace("'", "''"))'", 'train: images/train', 'val: images/val', 'test: images/test', 'names:') +
    @(0..5 | ForEach-Object { "  ${_}: $($classes[$_])" }) | Set-Content -LiteralPath $yamlPath -Encoding utf8
@{
    status = 'prepared_not_trained'; ultralyticsVersion = $UltralyticsVersion; weightsSha256 = $ExpectedWeightsSha256;
    datasetManifestSha256 = (Get-FileHash -LiteralPath (Join-Path $datasetRoot 'groups.json') -Algorithm SHA256).Hash;
    classes = $classes; seed = 42;
    trainArguments = @('detect', 'train', "model=$weightsPath", "data=$yamlPath", 'epochs=100', 'imgsz=640', 'seed=42', 'deterministic=True', 'amp=False', 'workers=0', "project=$outputRoot", 'name=six-class', 'exist_ok=False');
    validateArguments = @('detect', 'val', "model=$outputRoot/six-class/weights/best.pt", "data=$yamlPath", 'split=test');
    exportArguments = @('export', "model=$outputRoot/six-class/weights/best.pt", 'format=onnx', 'imgsz=640', 'batch=1', 'dynamic=False', 'simplify=False', 'opset=17');
    requirements = @('Run in a separately prepared offline environment with the exact reviewed Ultralytics/Python/torch/onnx versions', 'Review applicable model, code and dataset licenses', 'Validate native-vs-ONNX outputs and calibrate thresholds before registering a production adapter', 'Group declarations do not replace perceptual near-duplicate review; no six-class accuracy is established by this plan')
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $planPath -Encoding utf8
Write-Output 'Dataset checks passed; generated training/export argument plan. No training or download performed.'
