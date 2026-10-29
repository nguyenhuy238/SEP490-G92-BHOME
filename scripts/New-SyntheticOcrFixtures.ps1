# Windows-only fixture generation; runtime OCR itself is .NET/OpenCV on Linux CPU.
param([string]$Destination = (Join-Path $PSScriptRoot '../tests/fixtures/ocr'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$samples = @{
    'identity-front.png' = @('DỮ LIỆU KIỂM THỬ', 'Số: 000000000000', 'Họ và tên: NGƯỜI KIỂM THỬ', 'Ngày sinh: 01/01/2000')
    'identity-back.png' = @('DỮ LIỆU KIỂM THỬ', 'Ngày cấp: 01/01/2020')
    'meter.png' = @('00123.45')
}
foreach ($name in $samples.Keys) {
    $bitmap = [Drawing.Bitmap]::new(1100, 100 + $samples[$name].Count * 85)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $font = [Drawing.Font]::new('Arial', 32, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    try {
        $graphics.Clear([Drawing.Color]::White)
        $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $y = 40
        foreach ($line in $samples[$name]) { $graphics.DrawString($line, $font, [Drawing.Brushes]::Black, 40, $y); $y += 85 }
        $bitmap.Save((Join-Path (Resolve-Path $Destination) $name), [Drawing.Imaging.ImageFormat]::Png)
    }
    finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}
