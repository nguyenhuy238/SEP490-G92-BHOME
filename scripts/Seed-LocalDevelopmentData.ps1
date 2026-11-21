param(
    [string]$EnvironmentFile = '.env',
    [switch]$SetSamplePasswords,
    [switch]$UseRandomPasswords
)

$ErrorActionPreference = 'Stop'
if ($SetSamplePasswords -and $UseRandomPasswords) { throw 'Choose SetSamplePasswords or UseRandomPasswords.' }
. (Join-Path $PSScriptRoot 'Use-LocalTools.ps1')
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$configPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repositoryRoot $EnvironmentFile }
$connectionLine = Get-Content -LiteralPath $configPath -Encoding UTF8 | Where-Object { $_ -like 'ConnectionStrings__Database=*' } | Select-Object -First 1
if (-not $connectionLine) { throw 'Missing ConnectionStrings__Database in the selected environment file.' }
$previousConnection = $env:ConnectionStrings__Database
$previousEnvironment = $env:DOTNET_ENVIRONMENT
$previousPassword = $env:BHOME_DEV_TEST_PASSWORD
$passwordPointer = [IntPtr]::Zero
$securePassword = $null
try {
    $env:ConnectionStrings__Database = $connectionLine.Substring('ConnectionStrings__Database='.Length).Trim().Trim('"').Trim("'")
    $env:DOTNET_ENVIRONMENT = 'Development'
    $env:BHOME_DEV_TEST_PASSWORD = $null
    if (-not $UseRandomPasswords) {
        $securePassword = Read-Host 'Password for sample accounts (12+ characters, upper/lower/digit/symbol)' -AsSecureString
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
        $env:BHOME_DEV_TEST_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    }
    $arguments = @('run', '--project', (Join-Path $repositoryRoot 'tools/BHome.LocalDevelopment/BHome.LocalDevelopment.csproj'), '--', 'seed-development-data')
    if ($SetSamplePasswords) { $arguments += '--set-sample-passwords' }
    & dotnet @arguments
    $result = $LASTEXITCODE
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
    if ($securePassword) { $securePassword.Dispose() }
    $env:ConnectionStrings__Database = $previousConnection
    $env:DOTNET_ENVIRONMENT = $previousEnvironment
    $env:BHOME_DEV_TEST_PASSWORD = $previousPassword
}
exit $result
