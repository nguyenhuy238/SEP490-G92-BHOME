$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $repositoryRoot 'scripts/MobileNetwork.ps1')
$checks = 0
function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -ne $Expected) { throw "FAIL: $Message" }
    $script:checks++
}
function New-Network([string]$Address, [int]$Index, [int]$Metric = 10, [string]$Description = 'Wi-Fi', [string]$Status = 'Up') {
    [pscustomobject]@{
        InterfaceIndex = $Index
        IPv4DefaultGateway = 'gateway'
        NetAdapter = [pscustomobject]@{ Status = $Status; InterfaceDescription = $Description }
        NetIPv4Interface = [pscustomobject]@{ InterfaceMetric = $Metric }
        IPv4Address = @([pscustomobject]@{ IPAddress = $Address; SkipAsSource = $false })
    }
}
$routes = @(
    [pscustomobject]@{ InterfaceIndex = 1; RouteMetric = 20 },
    [pscustomobject]@{ InterfaceIndex = 2; RouteMetric = 1 }
)
Assert-Equal (Select-MobileLanIp @((New-Network '192.168.1.8' 1), (New-Network '10.0.0.8' 2)) $routes) '10.0.0.8' 'lowest combined route/interface metric'
Assert-Equal (Select-MobileLanIp @((New-Network '192.168.1.8' 1 1), (New-Network '10.0.0.8' 2 100)) $routes) '192.168.1.8' 'interface metric participates in route selection'
foreach ($description in @('WireGuard VPN', 'Hyper-V Virtual Ethernet', 'Docker', 'Tailscale', 'WSL')) {
    Assert-Equal (Select-MobileLanIp @((New-Network '192.168.1.8' 1), (New-Network '10.0.0.8' 2 1 $description)) $routes) '192.168.1.8' "exclude $description"
}
Assert-Equal (Select-MobileLanIp @((New-Network '10.0.0.8' 2 1 'Wi-Fi' 'Down')) $routes) $null 'disconnected adapter'
Assert-Equal (Select-MobileLanIp @((New-Network '169.254.1.8' 2)) $routes) $null 'link-local excluded'
Assert-Equal (Select-MobileLanIp @((New-Network '8.8.8.8' 2)) $routes) $null 'public address excluded'
Assert-Equal (Select-MobileLanIp @((New-Network '10.0.0.8' 2)) @()) $null 'no default route'
Assert-Equal (Select-MobileLanIp @((New-Network '192.168.1.8' 1), (New-Network '10.0.0.8' 2 1 'VPN')) $routes) '192.168.1.8' 'old network'
Assert-Equal (Select-MobileLanIp @((New-Network '10.33.59.31' 1)) $routes) '10.33.59.31' 'new Wi-Fi selected automatically'
foreach ($address in @('127.0.0.1', '::1', '192.168.999.1', '172.32.1.1', '8.8.8.8')) {
    Assert-Equal (Test-MobilePrivateIpv4 $address) $false "invalid/private boundary $address"
}

# Exercise the actual supervisor with fake OS/process boundaries in an isolated checkout.
# It must update TLS/restart only its own Metro on IP change and preserve the user's debugger.
$testRoot = Join-Path $repositoryRoot ('.tools/mobile-launcher-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $testRoot 'scripts'),(Join-Path $testRoot 'node_modules/expo/bin'),(Join-Path $testRoot 'src/mobile') -Force | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'scripts/Start-OcrMobileApp.ps1') -Destination (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1')
    [IO.File]::WriteAllText((Join-Path $testRoot '.env'), '')
    [IO.File]::WriteAllText((Join-Path $testRoot 'node_modules/expo/bin/cli'), '')
    [IO.File]::WriteAllText((Join-Path $testRoot 'scripts/Use-LocalTools.ps1'), '')
    [IO.File]::WriteAllText((Join-Path $testRoot 'scripts/MobileNetwork.ps1'), @'
function Get-MobileLanIp {
    $global:addressCalls++
    if ($global:addressCalls -eq 1) { return '192.168.1.8' }
    if ($global:addressCalls -eq 2) { throw 'temporary disconnect' }
    return '10.33.59.31'
}
function Get-MobileDevelopmentServerId { param($CertificatePath) 'SYNTHETIC-CA' }
'@)
    [IO.File]::WriteAllText((Join-Path $testRoot 'scripts/Prepare-OcrMobile.ps1'), @'
param($LanIp, [switch]$SkipDatabase)
if (-not $SkipDatabase) { throw 'Launcher must not migrate a user database.' }
$global:prepared += $LanIp
'@)
    function node {
        $global:LASTEXITCODE = if ($global:failReadiness) { 1 } else { 0 }
        if ($args.Count -eq 2 -and $args[0] -eq '-p') { $global:LASTEXITCODE = 0; '22.23.4' }
    }
    function Get-NetTCPConnection {
        param($State, $LocalPort, $ErrorAction)
        if (@($LocalPort) -contains 8081) {
            if ($global:occupiedMetro) { [pscustomobject]@{ OwningProcess = 456; LocalPort = 8081 } }
            return
        }
        if ($global:noApi) { return }
        [pscustomobject]@{ OwningProcess = 123; LocalAddress = '0.0.0.0'; LocalPort = 7240 }
    }
    function Get-CimInstance {
        param($ClassName, $Filter)
        [pscustomobject]@{ CommandLine = $(if ($global:foreignApi) { 'C:\another-checkout\BHome.Api.exe' } else { Join-Path $testRoot 'src/backend/BHome.Api.exe' }) }
    }
    function Get-Command { param($Name) [pscustomobject]@{ Source = 'node.exe' } }
    function Start-Process {
        param($FilePath, [switch]$NoNewWindow, [switch]$PassThru, $WorkingDirectory, $ArgumentList, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError)
        if ($WindowStyle -eq 'Hidden') {
            $global:apiStarts++
            return [pscustomobject]@{ Id = 990; HasExited = [bool]$global:failReadiness }
        }
        $global:started++
        if ($ArgumentList[0] -notlike '*Start-ExpoMobile.cjs*') { throw 'Metro must use the checked Expo launcher.' }
        if ($env:EXPO_PUBLIC_DEV_SERVER_ID -ne 'SYNTHETIC-CA') { throw 'Missing developer server binding.' }
        if ($env:EXPO_PACKAGER_PROXY_URL -ne @('http://192.168.1.8:8081', 'http://10.33.59.31:8081')[$global:started - 1]) { throw 'Incorrect Expo advertised IP.' }
        $process = [pscustomobject]@{ Id = 900 + $global:started; HasExited = $false; ExitCode = 0; Generation = $global:started }
        $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {
            param($Timeout)
            if ($this.Generation -eq 1) { return $false }
            $this.HasExited = $true
            return $true
        }
        return $process
    }
    function taskkill.exe {
        $global:stopped += [int]$args[1]
        $global:LASTEXITCODE = 0
    }
    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @()
    & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null
    Assert-Equal ($global:prepared -join ',') '192.168.1.8,10.33.59.31' 'prepare initial and changed IP automatically'
    Assert-Equal $global:started 2 'restart Metro after network change, tolerate temporary disconnect'
    Assert-Equal ($global:stopped -join ',') '901' 'stop only owned old Metro, preserve debugger API'

    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @(); $global:apiStarts = 0; $global:noApi = $true
    & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null
    Assert-Equal $global:apiStarts 1 'start API when absent'
    Assert-Equal ($global:stopped -join ',') '901,990' 'cleanup only launcher-owned API and old Metro'

    $global:occupiedMetro = $true
    try { & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null; throw 'Occupied Metro was accepted.' }
    catch { if ($_.Exception.Message -notlike 'Metro port * is already in use*') { throw } }
    Assert-Equal $global:apiStarts 1 'duplicate Metro rejected without starting another API'
    $global:occupiedMetro = $false; $global:noApi = $false; $global:foreignApi = $true
    $global:prepared = @()
    try { & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null; throw 'Foreign API was accepted.' }
    catch { if ($_.Exception.Message -notlike 'API ports belong to a different process*') { throw } }
    Assert-Equal $global:prepared.Count 0 'foreign API rejected before configuration changes'
    $global:foreignApi = $false; $global:noApi = $true; $global:failReadiness = $true
    $global:started = 0; $global:addressCalls = 0
    try { & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null; throw 'Failed API readiness was accepted.' }
    catch { if ($_.Exception.Message -notlike 'API HTTPS readiness failed*') { throw } }
    Assert-Equal $global:started 0 'never start Metro after failed verified HTTPS readiness'
    Write-Output "PASS $checks mobile network/launcher assertions."
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $allowedRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot '.tools')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedTestRoot.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup target.' }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
}
