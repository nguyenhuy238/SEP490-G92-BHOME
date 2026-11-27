param([string]$Destination = (Join-Path $PSScriptRoot '../tests/fixtures/ocr/identity-chip'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
# Layout stress fixtures only: no government emblem, portrait, fingerprints or real identity.
foreach ($side in @('front', 'back', 'blank-front')) {
    $image = [Drawing.Bitmap]::new(1600, 1000)
    $g = [Drawing.Graphics]::FromImage($image)
    $label = [Drawing.Font]::new('Arial', 24, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $value = [Drawing.Font]::new('Arial', 36, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $large = [Drawing.Font]::new('Consolas', 52, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $pattern = [Drawing.Pen]::new([Drawing.Color]::FromArgb(207, 224, 217), 1)
    try {
        $g.Clear([Drawing.Color]::FromArgb(234, 241, 223))
        $g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        for ($i = -1000; $i -lt 1600; $i += 35) { $g.DrawLine($pattern, $i, 0, ($i + 1000), 1000) }
        $g.DrawString('THE THU NGHIEM / SYNTHETIC LAYOUT', $label, [Drawing.Brushes]::DarkSlateGray, 430, 25)
        if ($side -ne 'back') {
            $g.DrawString('DU LIEU GIA LAP - KHONG PHAI GIAY TO', $value, [Drawing.Brushes]::DarkRed, 420, 100)
            $g.FillRectangle([Drawing.Brushes]::White, 60, 290, 330, 430)
            $g.DrawString('Số / No.:', $label, [Drawing.Brushes]::Black, 470, 280)
            $g.DrawString('Họ và tên / Full name:', $label, [Drawing.Brushes]::Black, 470, 400)
            $g.DrawString('Ngày sinh / Date of birth:', $label, [Drawing.Brushes]::Black, 470, 535)
            $g.DrawString('Giới tính / Sex:', $label, [Drawing.Brushes]::Black, 470, 670)
            $g.DrawString('Quốc tịch / Nationality:', $label, [Drawing.Brushes]::Black, 880, 670)
            $g.DrawString('Quê quán / Place of origin:', $label, [Drawing.Brushes]::Black, 470, 745)
            $g.DrawString('Nơi thường trú / Place of residence:', $label, [Drawing.Brushes]::Black, 470, 845)
            if ($side -eq 'front') {
                $g.DrawString('000000000000', $value, [Drawing.Brushes]::Black, 470, 325)
                $g.DrawString('NGƯỜI KIỂM THỬ', $value, [Drawing.Brushes]::Black, 470, 445)
                $g.DrawString('01/01/2000', $value, [Drawing.Brushes]::Black, 470, 580)
                $g.DrawString('Nữ', $label, [Drawing.Brushes]::Black, 660, 670)
                $g.DrawString('Việt Nam', $label, [Drawing.Brushes]::Black, 1150, 670)
                $g.DrawString('TỈNH MÔ PHỎNG', $label, [Drawing.Brushes]::Black, 470, 790)
                $g.DrawString('ĐỊA CHỈ GIẢ LẬP', $label, [Drawing.Brushes]::Black, 470, 890)
            }
        } else {
            $g.DrawString('Đặc điểm nhân dạng / Personal identification:', $label, [Drawing.Brushes]::Black, 65, 110)
            $g.DrawString('DAC DIEM GIA LAP', $value, [Drawing.Brushes]::Black, 65, 155)
            $g.DrawString('Ngày, tháng, năm / Date, month, year:', $label, [Drawing.Brushes]::Black, 65, 270)
            $g.DrawString('01/07/2024', $value, [Drawing.Brushes]::Black, 650, 265)
            $g.DrawString('CO QUAN THU NGHIEM', $value, [Drawing.Brushes]::Black, 150, 355)
            $g.DrawString('TEST AUTHORITY - SYNTHETIC DATA', $label, [Drawing.Brushes]::Black, 100, 410)
            $g.FillRectangle([Drawing.Brushes]::White, 900, 100, 640, 480)
            $g.DrawString('KHONG CO VAN TAY', $label, [Drawing.Brushes]::Black, 1010, 325)
            $g.FillRectangle([Drawing.Brushes]::Goldenrod, 100, 485, 230, 185)
            $g.DrawString('NGUOI KY GIA LAP', $large, [Drawing.Brushes]::Black, 440, 655)
            $g.DrawString('IDVNM000000000000<<<<<<<<<<<<<', $large, [Drawing.Brushes]::Black, 65, 770)
            $g.DrawString('0001010F4001010VNM<<<<<<<<<<<<', $large, [Drawing.Brushes]::Black, 65, 840)
            $g.DrawString('NGUOI<<KIEM<THU<<<<<<<<<<<<<<', $large, [Drawing.Brushes]::Black, 65, 910)
        }
        $image.Save((Join-Path $Destination "$side.jpg"), [Drawing.Imaging.ImageFormat]::Jpeg)
    }
    finally { $pattern.Dispose(); $label.Dispose(); $value.Dispose(); $large.Dispose(); $g.Dispose(); $image.Dispose() }
}
