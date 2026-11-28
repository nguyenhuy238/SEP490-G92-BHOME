param([string]$Destination = (Join-Path $PSScriptRoot '../.tools/identity-desk/source/identity-desk-layout'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
# A second dense synthetic layout. No government artwork or real identity/biometrics.
foreach ($side in @('front', 'back', 'blank-front')) {
    $image = [Drawing.Bitmap]::new(1600, 1000)
    $g = [Drawing.Graphics]::FromImage($image)
    $label = [Drawing.Font]::new('Arial', 28, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $value = [Drawing.Font]::new('Arial', 45, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $number = [Drawing.Font]::new('Arial', 52, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $pattern = [Drawing.Pen]::new([Drawing.Color]::FromArgb(170, 206, 193), 1)
    try {
        $g.Clear([Drawing.Color]::FromArgb(213, 227, 199))
        $g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        for ($i = -1000; $i -lt 1600; $i += 25) { $g.DrawLine($pattern, $i, 0, ($i + 1000), 1000) }
        $g.DrawString('DU LIEU GIA LAP / SYNTHETIC TEST CARD', $number, [Drawing.Brushes]::DarkRed, 260, 100)
        $g.DrawString('KHONG PHAI GIAY TO - KHONG DUNG XAC MINH', $label, [Drawing.Brushes]::Black, 320, 170)
        if ($side -ne 'back') {
            $g.FillRectangle([Drawing.Brushes]::White, 50, 320, 350, 480)
            $g.DrawString('KHONG CO ANH', $label, [Drawing.Brushes]::Black, 90, 540)
            $g.DrawString('Số / No.:', $label, [Drawing.Brushes]::Black, 450, 390)
            $g.DrawString('Họ và tên / Full name:', $label, [Drawing.Brushes]::Black, 450, 465)
            $g.DrawString('Ngày sinh / Date of birth:', $label, [Drawing.Brushes]::Black, 450, 595)
            $g.DrawString('Giới tính / Sex:', $label, [Drawing.Brushes]::Black, 450, 670)
            $g.DrawString('Quốc tịch / Nationality:', $label, [Drawing.Brushes]::Black, 870, 670)
            $g.DrawString('Quê quán / Place of origin:', $label, [Drawing.Brushes]::Black, 450, 740)
            $g.DrawString('Nơi thường trú / Place of residence:', $label, [Drawing.Brushes]::Black, 450, 840)
            if ($side -eq 'front') {
                $g.DrawString('000000001234', $number, [Drawing.Brushes]::Black, 630, 375)
                $g.DrawString('NGƯỜI THỬ NGHIỆM', $value, [Drawing.Brushes]::Black, 450, 520)
                $g.DrawString('12/03/2001', $value, [Drawing.Brushes]::Black, 950, 580)
                $g.DrawString('Nam', $label, [Drawing.Brushes]::Black, 675, 670)
                $g.DrawString('Việt Nam', $label, [Drawing.Brushes]::Black, 1190, 670)
                $g.DrawString('TỈNH KIỂM THỬ', $value, [Drawing.Brushes]::Black, 450, 780)
                $g.DrawString('ĐỊA CHỈ GIẢ LẬP', $value, [Drawing.Brushes]::Black, 450, 890)
            }
        } else {
            $g.DrawString('Đặc điểm nhân dạng / Personal identification:', $label, [Drawing.Brushes]::Black, 50, 280)
            $g.DrawString('MO TA GIA LAP', $value, [Drawing.Brushes]::Black, 50, 325)
            $g.DrawString('Ngày, tháng, năm / Date, month, year:', $label, [Drawing.Brushes]::Black, 50, 405)
            $g.DrawString('14/06/2023', $value, [Drawing.Brushes]::Black, 720, 390)
            $g.DrawString('CO QUAN THU NGHIEM', $label, [Drawing.Brushes]::Black, 200, 495)
            $g.FillRectangle([Drawing.Brushes]::White, 1020, 280, 530, 350)
            $g.DrawString('KHONG CO VAN TAY', $label, [Drawing.Brushes]::Black, 1100, 435)
            $g.DrawString('NGUOI KY GIA LAP', $value, [Drawing.Brushes]::Black, 280, 640)
            $g.DrawString('IDVNM000000001234<<<<<<<<<<<<', $number, [Drawing.Brushes]::Black, 70, 775)
            $g.DrawString('SYNTHETIC<<TEST<DATA<<<<<<<<', $number, [Drawing.Brushes]::Black, 70, 850)
        }
        $image.Save((Join-Path $Destination "$side.png"), [Drawing.Imaging.ImageFormat]::Png)
    }
    finally { $pattern.Dispose(); $label.Dispose(); $value.Dispose(); $number.Dispose(); $g.Dispose(); $image.Dispose() }
}
