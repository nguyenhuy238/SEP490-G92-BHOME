param([string]$Destination = (Join-Path $PSScriptRoot '../tests/fixtures/ocr/identity-camera'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
# Synthetic text and geometry only. Never use real identity photographs or fields.
foreach ($sample in @(
    @{ File = 'front-background.jpg'; Back = $false; Angle = 0 },
    @{ File = 'front-tilted.jpg'; Back = $false; Angle = 6 },
    @{ File = 'back-background.jpg'; Back = $true; Angle = 0 }
)) {
    $scene = [Drawing.Bitmap]::new(2400, 3000)
    $g = [Drawing.Graphics]::FromImage($scene)
    $font = [Drawing.Font]::new('Arial', 26, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $large = [Drawing.Font]::new('Arial', 40, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $ink = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(30, 38, 48))
    $backgroundInk = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(215, 220, 228))
    try {
        $g.Clear([Drawing.Color]::FromArgb(65, 74, 85))
        $g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        for ($row = 0; $row -lt 14; $row++) {
            $g.DrawString("BACKGROUND TEST LINE $row - OUTSIDE THE DOCUMENT", $font, $backgroundInk, 80, (40 + $row * 50))
        }
        $g.TranslateTransform(1200, 1580)
        $g.RotateTransform($sample.Angle)
        $g.TranslateTransform(-700, -440)
        $g.FillRectangle([Drawing.Brushes]::Ivory, 0, 0, 1400, 880)
        $g.DrawRectangle([Drawing.Pens]::Black, 0, 0, 1400, 880)
        $g.DrawString('THE THU NGHIEM - DU LIEU GIA LAP', $font, $ink, 340, 35)
        if ($sample.Back) {
            $g.DrawString('Ngày cấp / Date of issue:', $font, $ink, 90, 190)
            $g.DrawString('01/07/2024', $large, $ink, 90, 240)
            $g.DrawString('Nơi cư trú / Place of residence:', $font, $ink, 90, 330)
            $g.DrawString('THÔN GIẢ LẬP, XÃ KIỂM THỬ', $large, $ink, 90, 390)
            $g.DrawString('TỈNH MÔ PHỎNG', $large, $ink, 90, 450)
            $g.DrawString('Nơi cấp: CƠ QUAN GIẢ LẬP', $font, $ink, 90, 540)
        } else {
            $g.FillRectangle([Drawing.Brushes]::LightGray, 65, 185, 250, 355)
            $g.DrawString('ANH MAU', $font, $ink, 95, 345)
            $g.DrawString('Số / No.:', $font, $ink, 380, 170)
            $g.DrawString('000000000000', $large, $ink, 380, 215)
            $g.DrawString('Họ và tên / Full name:', $font, $ink, 380, 295)
            $g.DrawString('NGƯỜI KIỂM THỬ', $large, $ink, 380, 340)
            $g.DrawString('Ngày sinh / Date of birth:', $font, $ink, 380, 425)
            $g.DrawString('01/01/2000', $large, $ink, 380, 470)
            $g.DrawString('Giới tính / Sex: Nữ', $font, $ink, 380, 560)
            $g.DrawString('Quốc tịch / Nationality: Việt Nam', $font, $ink, 380, 610)
            $g.DrawString('Nơi thường trú / Place of residence:', $font, $ink, 380, 675)
            $g.DrawString('ĐỊA CHỈ GIẢ LẬP, TỈNH MÔ PHỎNG', $font, $ink, 380, 725)
        }
        $g.DrawString('SYNTHETIC TEST DATA - NOT AN IDENTITY DOCUMENT', $font, $ink, 90, 815)
        $g.ResetTransform()
        # Match prepareCapture's identity maximum edge. Actual native encoders may differ.
        $upload = [Drawing.Bitmap]::new(1920, 2400)
        $uploadGraphics = [Drawing.Graphics]::FromImage($upload)
        try {
            $uploadGraphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $uploadGraphics.DrawImage($scene, 0, 0, 1920, 2400)
            $upload.Save((Join-Path $Destination $sample.File), [Drawing.Imaging.ImageFormat]::Jpeg)
        }
        finally { $uploadGraphics.Dispose(); $upload.Dispose() }
    }
    finally { $font.Dispose(); $large.Dispose(); $ink.Dispose(); $backgroundInk.Dispose(); $g.Dispose(); $scene.Dispose() }
}
