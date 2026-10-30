param([string]$EnvironmentFile = '.env')

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$configPath = if ([System.IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile }
else { Join-Path $repositoryRoot $EnvironmentFile }
$connectionLine = Get-Content -LiteralPath $configPath -Encoding UTF8 | Where-Object { $_ -like 'ConnectionStrings__Database=*' } | Select-Object -First 1
if (-not $connectionLine) { throw 'Thiếu ConnectionStrings__Database trong file môi trường đã chọn.' }
$previousConnection = $env:ConnectionStrings__Database
$previousEnvironment = $env:DOTNET_ENVIRONMENT
$previousTestPassword = $env:BHOME_DEV_TEST_PASSWORD
$securePassword = Read-Host 'Mật khẩu chung cho 3 tài khoản test local (ít nhất 12 ký tự, hoa/thường/số/ký tự đặc biệt)' -AsSecureString
$passwordPointer = [IntPtr]::Zero
try {
    $env:ConnectionStrings__Database = $connectionLine.Substring('ConnectionStrings__Database='.Length)
    $env:DOTNET_ENVIRONMENT = 'Development'
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $env:BHOME_DEV_TEST_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    dotnet run --project (Join-Path $repositoryRoot 'tools/BHome.LocalDevelopment/BHome.LocalDevelopment.csproj')
    $result = $LASTEXITCODE
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
    $securePassword.Dispose()
    $env:BHOME_DEV_TEST_PASSWORD = $previousTestPassword
    $env:ConnectionStrings__Database = $previousConnection
    $env:DOTNET_ENVIRONMENT = $previousEnvironment
}
exit $result
