param([string]$Destination = (Join-Path $PSScriptRoot '../.tools/meter-safety'))
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$cases = @()
$profiles = @('MechanicalElectricity', 'DigitalElectricity', 'MechanicalWater', 'DigitalWater')
foreach ($profile in $profiles) {
    $unit = if ($profile.EndsWith('Water')) { 'm3' } else { 'kWh' }
    foreach ($layout in @('single', 'same-displays', 'different-displays', 'wrong-utility')) {
        $image = [Drawing.Bitmap]::new(1200, 600)
        $graphics = [Drawing.Graphics]::FromImage($image)
        $font = [Drawing.Font]::new('Arial', 36)
        try {
            $graphics.Clear([Drawing.Color]::White)
            $graphics.DrawString('S/N: 987654321', $font, [Drawing.Brushes]::Black, 30, 30)
            $reading = "00123.45 $unit"
            if ($layout -eq 'wrong-utility') {
                $wrongUnit = if ($unit -eq 'kWh') { 'm3' } else { 'kWh' }
                $reading = "00123.45 $wrongUnit"
            }
            $graphics.DrawString($reading, $font, [Drawing.Brushes]::Black, 30, 180)
            if ($layout -in @('same-displays', 'different-displays')) {
                $second = if ($layout -eq 'same-displays') { $reading } else { "00456.78 $unit" }
                $graphics.DrawString($second, $font, [Drawing.Brushes]::Black, 30, 380)
            }
            $name = "$profile-$layout.png"
            $image.Save((Join-Path $Destination $name), [Drawing.Imaging.ImageFormat]::Png)
            $expected = if ($layout -eq 'single') { @{ reading = '00123.45' } } else { @{} }
            $cases += @{ file = $name; kind = $profile; expectedFields = $expected;
                expectFallback = ($layout -ne 'single'); decimalPlaces = 2; source = "$profile-$layout" }
        }
        finally { $font.Dispose(); $graphics.Dispose(); $image.Dispose() }
    }
}
@{ dataset = 'synthetic'; cases = $cases } | ConvertTo-Json -Depth 10 |
    Set-Content -LiteralPath (Join-Path $Destination 'manifest.json') -Encoding utf8
Write-Output 'Created 16 synthetic text-layout cases. These are not real meter detection/classification evidence.'
