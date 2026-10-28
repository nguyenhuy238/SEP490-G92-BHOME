param([string]$Destination = (Join-Path $PSScriptRoot '../.tools/ocr-models'))
$ErrorActionPreference = 'Stop'
$revision = '9b5346432fb84a447fdc4d780a7741126b446b0f'
$files = @{
    'detection.onnx' = 'eb13b44b25bb36f89528b68720af8a61d9cf381176107f465db1757b65d086e1'
    'recognition.onnx' = '767305d37d06728fe9578ff8132595ce23f66139df5e2937fd4131bd1dc34f12'
    'charset.txt' = '5d801bf60472c4c1b184b6b6843aa2c754d8daf1429247e07658ee0bd79ab448'
    'README.md' = '18184f2a6c9289fad5cc30055dde565265c090ff9083261ba4dc12f328c71cea'
}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
foreach ($name in $files.Keys) {
    $target = Join-Path $Destination $name
    if ((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $files[$name]) { continue }
    $temporary = "$target.download"
    try {
        Invoke-WebRequest -UseBasicParsing "https://huggingface.co/truonggiabao7/ocrdoc-models/resolve/$revision/$name" -OutFile $temporary
        if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $files[$name]) { throw "Checksum mismatch: $name" }
        Move-Item -LiteralPath $temporary -Destination $target -Force
    }
    finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary } }
}
Write-Output 'OCR artifacts verified. Weights: Apache-2.0; see downloaded model card and INTERNAL_OCR.md.'
