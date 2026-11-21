param([string]$Destination = (Join-Path $PSScriptRoot '../tests/fixtures/ocr'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $Destination -Force | Out-Null

# Synthetic documents only; no real identity, meter account or location data.
$cards = @{
    'identity-front-layout.png' = @(
        'DỮ LIỆU KIỂM THỬ',
        'Số: 000000000000',
        'Họ và tên / Full name: NGƯỜI KIỂM THỬ',
        'Ngày sinh / Date of birth: 01/01/2000',
        'Giới tính: Nữ       Quốc tịch: Việt Nam',
        'Nơi cư trú / Place of residence:',
        'THÔN GIẢ LẬP',
        'XÃ KIỂM THỬ, TỈNH MÔ PHỎNG'
    )
    'identity-back-residence.png' = @(
        'DỮ LIỆU KIỂM THỬ',
        'Ngày cấp / Date of issue: 01/07/2024',
        'Nơi cư trú / Place of residence:',
        'THÔN GIẢ LẬP',
        'XÃ KIỂM THỬ, TỈNH MÔ PHỎNG',
        'Nơi cấp: CƠ QUAN GIẢ LẬP'
    )
}
foreach ($entry in $cards.GetEnumerator()) {
    $bitmap = [Drawing.Bitmap]::new(1500, 60 + $entry.Value.Count * 75)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $font = [Drawing.Font]::new('Arial', 32, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    try {
        $graphics.Clear([Drawing.Color]::White)
        $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $y = 30
        foreach ($line in $entry.Value) { $graphics.DrawString($line, $font, [Drawing.Brushes]::Black, 40, $y); $y += 75 }
        $bitmap.Save((Join-Path $Destination $entry.Key), [Drawing.Imaging.ImageFormat]::Png)
    }
    finally { $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}

$meters = @(
    @{ File = 'electricity-mechanical-wheels.png'; Value = '00456.78'; Unit = 'kWh'; Digital = $false; Water = $false },
    @{ File = 'water-mechanical-wheels.png'; Value = '00987.654'; Unit = 'm3'; Digital = $false; Water = $true },
    @{ File = 'electricity-digital-lcd.png'; Value = '073219.4'; Unit = 'kWh'; Digital = $true; Water = $false },
    @{ File = 'water-digital-lcd.png'; Value = '000432.1'; Unit = 'm3'; Digital = $true; Water = $true }
)
foreach ($meter in $meters) {
    $bitmap = [Drawing.Bitmap]::new(1000, 650)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $font = [Drawing.Font]::new('Arial', 28, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $digits = [Drawing.Font]::new('Consolas', 64, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $lcd = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(132, 155, 142))
    $lcdInk = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(75, 91, 80))
    try {
        $graphics.Clear([Drawing.Color]::White)
        $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $graphics.DrawString('SYNTHETIC METER - TEST DATA', $font, [Drawing.Brushes]::Black, 40, 30)
        $graphics.DrawString('S/N: 987654321', $font, [Drawing.Brushes]::Black, 40, 90)
        $graphics.DrawString($(if ($meter.Water) { 'DN 15   PN 16   2026' } else { '220 V   50 Hz   5(80) A' }), $font, [Drawing.Brushes]::Black, 40, 145)
        if ($meter.Digital) {
            $graphics.FillRectangle($lcd, 60, 240, 650, 110)
            $graphics.DrawString($meter.Value, $digits, $lcdInk, 90, 255)
        }
        else {
            # White wheels with black integer digits and red fractional digits. The decimal
            # point is explicit; the OCR must not derive precision from colour.
            $fraction = $false
            $x = 90
            foreach ($character in $meter.Value.ToCharArray()) {
                if ($character -eq '.') { $fraction = $true }
                $brush = if ($fraction) { [Drawing.Brushes]::Red } else { [Drawing.Brushes]::Black }
                if ($character -ne '.') { $graphics.DrawRectangle([Drawing.Pens]::LightGray, $x, 240, 46, 100) }
                $graphics.DrawString([string]$character, $digits, $brush, $x, 255)
                $x += 48
            }
        }
        # The water unit is ABOVE the display; electricity unit is BELOW it.
        $unitY = if ($meter.Water) { 200 } else { 365 }
        $graphics.DrawString($meter.Unit, $font, [Drawing.Brushes]::Black, 350, $unitY)
        $graphics.DrawString('No. 876543210   TEST ONLY', $font, [Drawing.Brushes]::Black, 40, 500)
        $bitmap.Save((Join-Path $Destination $meter.File), [Drawing.Imaging.ImageFormat]::Png)
    }
    finally { $lcdInk.Dispose(); $lcd.Dispose(); $digits.Dispose(); $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
}
