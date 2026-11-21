param([string]$Destination = (Join-Path $PSScriptRoot '../.tools/automatic-ocr'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$front = @('IDENTITY CARD - SYNTHETIC', 'No: 000000000000', 'Full name: NGUOI KIEM THU', 'Date of birth: 01/02/2000')
$back = @('SYNTHETIC TEST DATA', 'Date of issue: 01/02/2024', 'Place of issue: SYNTHETIC AUTHORITY')
$samples = @(
    @{ name = 'front'; lines = $front; status = 'classified'; category = 'cccd_front'; fields = @{ fullName = 'NGUOI KIEM THU'; dateOfBirth = '2000-02-01' } },
    @{ name = 'back'; lines = $back; status = 'classified'; category = 'cccd_back'; fields = @{ dateOfIssue = '2024-02-01'; placeOfIssue = 'SYNTHETIC AUTHORITY' } },
    @{ name = 'mixed-sides'; lines = $front + $back; status = 'ambiguous'; category = 'unknown'; fields = @{} },
    @{ name = 'electricity'; lines = @('SYNTHETIC METER', 'S/N: 987654321', '00123.45 kWh'); status = 'ambiguous'; category = 'unknown'; fields = @{} },
    @{ name = 'water'; lines = @('SYNTHETIC METER', 'S/N: 987654321', '00123.45 m3'); status = 'ambiguous'; category = 'unknown'; fields = @{} },
    @{ name = 'multiple-displays'; lines = @('SYNTHETIC METER', '00123.45 kWh', '00123.45 kWh'); status = 'ambiguous'; category = 'unknown'; fields = @{} },
    @{ name = 'unknown'; lines = @('SYNTHETIC LABEL', 'Serial 987654321', '220 V 50 Hz'); status = 'unknown'; category = 'unknown'; fields = @{} },
    @{ name = 'blank'; lines = @(); status = 'unknown'; category = 'unknown'; fields = @{} }
)
$cases = @()
foreach ($sample in $samples) {
    $bitmap = [Drawing.Bitmap]::new(1400, [Math]::Max(350, 80 + $sample.lines.Count * 80))
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $font = [Drawing.Font]::new('Arial', 32, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    try {
        $graphics.Clear([Drawing.Color]::White)
        $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $y = 40
        foreach ($line in $sample.lines) { $graphics.DrawString($line, $font, [Drawing.Brushes]::Black, 40, $y); $y += 80 }
        $turns = if ($sample.name -in @('front', 'back')) { @(0, 90, 180, 270) } else { @(0) }
        foreach ($turn in $turns) {
            $variant = [Drawing.Bitmap]$bitmap.Clone()
            try {
                $rotation = switch ($turn) { 90 { [Drawing.RotateFlipType]::Rotate90FlipNone }; 180 { [Drawing.RotateFlipType]::Rotate180FlipNone }; 270 { [Drawing.RotateFlipType]::Rotate270FlipNone }; default { [Drawing.RotateFlipType]::RotateNoneFlipNone } }
                $variant.RotateFlip($rotation)
                $name = "$($sample.name)-$turn.png"
                $variant.Save((Join-Path $Destination $name), [Drawing.Imaging.ImageFormat]::Png)
                $cases += @{ file = $name; expectedStatus = $sample.status; expectedCategory = $sample.category; expectedFields = $sample.fields; source = $sample.name }
            }
            finally { $variant.Dispose() }
        }
    }
    finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}
@{ dataset = 'synthetic'; cases = $cases } | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 (Join-Path $Destination 'manifest.json')
Write-Output 'Created 14 synthetic text-evidence cases, including rotation and explicit review. Not a six-class visual benchmark.'
