param([string]$Destination = (Join-Path $PSScriptRoot '../.tools/identity-chip-camera/source'), [ValidateRange(0,5)][int]$Variant = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$names = @('NGƯỜI THỬ NGHIỆM', 'NGƯỜI KIỂM THỬ', 'TRẦN MẪU THỬ', 'ĐẶNG DỮ LIỆU MẪU', 'ĐỖ KIỂM CHỨNG', 'HUỲNH MÔ PHỎNG')
$origins = @('Xã Giả Lập, Huyện Mô Phỏng', 'Phường Mẫu, Tỉnh Kiểm Thử', 'Xã Thử, Huyện Giả Định', 'Phường Giả Lập, Tỉnh Mẫu', 'Xã Kiểm Chứng, Huyện Mẫu', 'Phường Mô Phỏng, Tỉnh Thử')
$tails = @('Xã Kiểm Thử, Tỉnh Giả Lập', 'Phường Mẫu, Tỉnh Mô Phỏng', 'Xã Giả Định, Tỉnh Kiểm Thử', 'Phường Thử, Tỉnh Dữ Liệu', 'Xã Mẫu, Tỉnh Kiểm Chứng', 'Phường Giả Định, Tỉnh Mẫu')
$identity = ('00000000{0:D4}' -f (1234 + $Variant))
$birth = [datetime]::new((2001 + $Variant), 3, 12)
$issue = [datetime]::new((2023 + $Variant % 3), 6, 14)
$expiry = [datetime]::new((2031 + $Variant), 3, 12)
$gender = if ($Variant % 2 -eq 0) { 'Nam' } else { 'Nữ' }
$family = if ($Variant % 2 -eq 0) { 'Arial' } else { 'Tahoma' }
# Synthetic text at the proportions of the chip CCCD layout. No real identity,
# portrait, fingerprints, QR data or government artwork is used.
foreach ($side in @('front', 'back', 'blank-front')) {
    $image = [Drawing.Bitmap]::new(1600, 1000)
    $g = [Drawing.Graphics]::FromImage($image)
    $label = [Drawing.Font]::new($family, 30, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $value = [Drawing.Font]::new($family, 46, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
    $number = [Drawing.Font]::new($family, 60, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
    $pattern = [Drawing.Pen]::new([Drawing.Color]::FromArgb(175, 207, 195), 1)
    try {
        $g.Clear([Drawing.Color]::FromArgb(213, 227, 199))
        $g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        for ($i = -1000; $i -lt 1600; $i += 20) { $g.DrawLine($pattern, $i, 0, ($i + 1000), 1000) }
        if ($side -ne 'back') {
            $g.DrawString('DU LIEU GIA LAP / SYNTHETIC TEST CARD', $label, [Drawing.Brushes]::Black, 450, 65)
            $g.DrawString('KHONG PHAI GIAY TO', $number, [Drawing.Brushes]::DarkRed, 450, 225)
            $g.FillRectangle([Drawing.Brushes]::White, 40, 340, 390, 500)
            $g.DrawString('KHONG CO ANH', $label, [Drawing.Brushes]::Black, 80, 580)
            $g.FillRectangle([Drawing.Brushes]::Gray, 1320, 70, 200, 190)
            $g.DrawString('Số / No.:', $label, [Drawing.Brushes]::Black, 465, 425)
            $g.DrawString('Họ và tên / Full name:', $label, [Drawing.Brushes]::Black, 465, 500)
            $g.DrawString('Ngày sinh / Date of birth:', $label, [Drawing.Brushes]::Black, 465, 620)
            $g.DrawString('Giới tính / Sex:', $label, [Drawing.Brushes]::Black, 465, 690)
            $g.DrawString('Quốc tịch / Nationality:', $label, [Drawing.Brushes]::Black, 900, 690)
            $g.DrawString('Quê quán / Place of origin:', $label, [Drawing.Brushes]::Black, 465, 765)
            $g.DrawString('Nơi thường trú / Place of residence:', $label, [Drawing.Brushes]::Black, 465, 865)
            $g.DrawString('Có giá trị đến:', $label, [Drawing.Brushes]::Black, 40, 865)
            $g.DrawString('Date of expiry:', $label, [Drawing.Brushes]::Black, 40, 900)
            if ($side -eq 'front') {
                $g.DrawString($identity, $number, [Drawing.Brushes]::Black, 650, 405)
                $g.DrawString($names[$Variant], $value, [Drawing.Brushes]::Black, 465, 555)
                $g.DrawString($birth.ToString('dd/MM/yyyy'), $value, [Drawing.Brushes]::Black, 1095, 605)
                $g.DrawString($gender, $value, [Drawing.Brushes]::Black, 745, 675)
                $g.DrawString('Việt Nam', $value, [Drawing.Brushes]::Black, 1330, 675)
                $g.DrawString($origins[$Variant], $value, [Drawing.Brushes]::Black, 465, 805)
                $g.DrawString('Thôn Thử', $value, [Drawing.Brushes]::Black, 1150, 850)
                $g.DrawString($tails[$Variant], $value, [Drawing.Brushes]::Black, 465, 925)
                $g.DrawString($expiry.ToString('dd/MM/yyyy'), $label, [Drawing.Brushes]::Black, 235, 900)
            }
        } else {
            $g.DrawString('Đặc điểm nhân dạng / Personal identification:', $label, [Drawing.Brushes]::Black, 40, 25)
            $g.DrawString('MO TA GIA LAP', $label, [Drawing.Brushes]::Black, 40, 60)
            $g.DrawString('Ngày, tháng, năm / Date, month, year:', $label, [Drawing.Brushes]::Black, 40, 135)
            $g.DrawString($issue.ToString('dd/MM/yyyy'), $label, [Drawing.Brushes]::Black, 720, 135)
            $g.DrawString('CO QUAN THU NGHIEM', $label, [Drawing.Brushes]::Black, 230, 210)
            $g.FillRectangle([Drawing.Brushes]::Gray, 880, 25, 650, 400)
            $g.DrawString('KHONG CO VAN TAY', $label, [Drawing.Brushes]::Black, 1000, 450)
            $g.DrawString('NGUOI KY GIA LAP', $value, [Drawing.Brushes]::Black, 390, 550)
            $g.DrawString('IDVNM000000001234<<<<<<<<<<<<', $number, [Drawing.Brushes]::Black, 75, 690)
            $g.DrawString('SYNTHETIC<<TEST<DATA<<<<<<<<', $number, [Drawing.Brushes]::Black, 75, 775)
            $g.DrawString('NOT<<AN<IDENTITY<<<<<<<<<<<<', $number, [Drawing.Brushes]::Black, 75, 860)
        }
        $image.Save((Join-Path $Destination "$side.png"), [Drawing.Imaging.ImageFormat]::Png)
    }
    finally { $pattern.Dispose(); $label.Dispose(); $value.Dispose(); $number.Dispose(); $g.Dispose(); $image.Dispose() }
}
$expected = @{
    front = @{ citizenIdentityNumber=$identity; fullName=$names[$Variant]; dateOfBirth=$birth.ToString('yyyy-MM-dd'); gender=$gender; nationality='Việt Nam'; placeOfOrigin=$origins[$Variant]; residentialAddress=('Thôn Thử ' + $tails[$Variant]); dateOfExpiry=$expiry.ToString('yyyy-MM-dd') }
    back = @{ dateOfIssue=$issue.ToString('yyyy-MM-dd') }
}
$expected | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $Destination 'expected.json')
