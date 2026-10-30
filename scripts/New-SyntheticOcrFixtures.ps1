# Windows-only fixture generation; runtime OCR itself is .NET/OpenCV on Linux CPU.
param([string]$Destination = (Join-Path $PSScriptRoot '../tests/fixtures/ocr'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$samples = @{
    'identity-front.png' = @('DỮ LIỆU KIỂM THỬ', 'Số: 000000000000', 'Họ và tên: NGƯỜI KIỂM THỬ', 'Ngày sinh: 01/01/2000')
    'identity-back.png' = @('DỮ LIỆU KIỂM THỬ', 'Ngày cấp: 01/01/2020')
    'meter.png' = @('00123.45')
    'identity-back-layout.png' = @('DU LIEU KIEM THU', 'Dac diem nhan dang / Personal identification', 'Ngay, thang, nam / Date, month, year:', '01/02/2020', 'Noi cap / Place of issue: CO QUAN GIA LAP')
    'identity-back-2024.png' = @('CAN CUOC - DU LIEU KIEM THU', 'Ngay cap / Date of issue:', '01/07/2024', 'Noi cu tru / Place of residence:', 'DIA CHI GIA LAP')
    'electricity-mechanical.png' = @('CONG TO DIEN - DU LIEU KIEM THU', 'S/N: 987654321', '220 V   50 Hz   5(80) A', '00123.45 kWh', '2026')
    'electricity-digital.png' = @('CONG TO DIEN TU - DU LIEU KIEM THU', 'No. 987654321', '220 V   50 Hz', '00123.45 kWh', '1.8.0')
    'water-mechanical.png' = @('DONG HO NUOC - DU LIEU KIEM THU', 'S/N: 987654321', 'Qn 1.5   DN 15', '00123.45 m3', '2026')
    'water-digital.png' = @('DONG HO NUOC DIEN TU - KIEM THU', 'No. 987654321', 'DN 15   IP68', '00123.45 m3', '2026')
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
