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
$tlsSettings = Get-MobileHttpsSniSettings 'synthetic-mobile.pfx' 'synthetic-password' 'synthetic-localhost.pfx'
Assert-Equal $tlsSettings['Kestrel:Endpoints:MobileHttps:Sni:*:Certificate:Path'] 'synthetic-mobile.pfx' 'LAN and no-SNI clients retain mobile certificate'
Assert-Equal $tlsSettings['Kestrel:Endpoints:MobileHttps:Sni:localhost:Certificate:Path'] 'synthetic-localhost.pfx' 'localhost uses the trusted development certificate'
Assert-Equal $tlsSettings['Kestrel:Endpoints:MobileHttps:Sni:localhost:Certificate:Password'] 'synthetic-password' 'certificate password is carried as configuration data'
$fallbackTlsSettings = Get-MobileHttpsSniSettings 'synthetic-mobile.pfx' 'synthetic-password' $null
Assert-Equal $fallbackTlsSettings['Kestrel:Endpoints:MobileHttps:Sni:localhost:Certificate:Path'] 'synthetic-mobile.pfx' 'missing trusted certificate clears any stale localhost mapping'
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
Assert-Equal (Get-MobileDevelopmentHost 'TEAM-PC-A') 'team-pc-a.local' 'derive hostname from workstation A'
Assert-Equal (Get-MobileDevelopmentHost 'TEAM-PC-B') 'team-pc-b.local' 'derive hostname from workstation B'
foreach ($name in @('bad.name', 'bad/name', '-bad', 'bad-', 'bad name', 'TEAM_PC')) {
    Assert-Equal (Get-MobileDevelopmentHost $name) $null 'invalid DNS computer names allow LAN fallback'
}
$syntheticSettings = Get-MobileBackendSettings @'
ConnectionStrings__Database=synthetic-db
Jwt__SigningKey=synthetic-key
Sessions__RefreshTokenDays=7
ObjectStorage__Endpoint=synthetic-storage
IdentityProtection__EncryptionKeys__local-v1=synthetic-identity-key
EXPO_PUBLIC_API_BASE_URL=https://other-machine.local:7240
UNRELATED_SECRET=synthetic-unrelated
# Jwt__SigningKey=ignored-comment
Api__PublicBaseUrl=$(throw 'must-not-evaluate')
'@
Assert-Equal $syntheticSettings['ConnectionStrings:Database'] 'synthetic-db' 'sync local database to Visual Studio'
Assert-Equal $syntheticSettings['Jwt:SigningKey'] 'synthetic-key' 'sync local JWT settings to Visual Studio'
Assert-Equal $syntheticSettings['ObjectStorage:Endpoint'] 'synthetic-storage' 'sync local storage settings'
Assert-Equal $syntheticSettings['IdentityProtection:EncryptionKeys:local-v1'] 'synthetic-identity-key' 'preserve identity settings'
Assert-Equal $syntheticSettings.ContainsKey('UNRELATED_SECRET') $false 'do not import unknown settings'
Assert-Equal $syntheticSettings.ContainsKey('EXPO_PUBLIC_API_BASE_URL') $false 'do not import client workstation configuration'
Assert-Equal $syntheticSettings['Api:PublicBaseUrl'] '$(throw ''must-not-evaluate'')' 'parse env values as data without shell evaluation'

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
function Get-MobileDevelopmentServerId { param($CertificatePath) $global:serverId }
function Get-MobileDevelopmentHost { $global:computerName }
'@)
    [IO.File]::WriteAllText((Join-Path $testRoot 'scripts/Get-OcrModels.ps1'), @'
$global:modelDownloads++
if ($global:failModels) { throw 'Synthetic model download failure.' }
$modelRoot = Join-Path (Split-Path -Parent $PSScriptRoot) '.tools/ocr-models'
New-Item -ItemType Directory -Path $modelRoot -Force | Out-Null
foreach ($name in @('detection.onnx', 'recognition.onnx', 'charset.txt')) { [IO.File]::WriteAllText((Join-Path $modelRoot $name), 'synthetic-model') }
'@)
    [IO.File]::WriteAllText((Join-Path $testRoot 'scripts/Prepare-OcrMobile.ps1'), @'
param($LanIp, [switch]$SkipDatabase)
if (-not $SkipDatabase) { throw 'Launcher must not migrate a user database.' }
$global:prepared += $LanIp
'@)
    function node {
        $global:LASTEXITCODE = if ($global:failReadiness) { 1 } else { 0 }
        if ($args.Count -eq 2 -and $args[0] -eq '-p') { $global:LASTEXITCODE = 0; '22.23.4' }
        elseif ($args[0] -like '*Diagnose-MobileApi.cjs') { $global:apiDiagnoses++ }
        elseif ($args[0] -like '*Test-ExpoMobile.cjs') {
            $global:metroChecks++
            $global:LASTEXITCODE = if ($global:failMetro) { 1 } else { 0 }
        }
        elseif ($args.Count -eq 4) {
            $global:hostnameChecks++
            $global:LASTEXITCODE = if ($global:noHostname) { 1 } else { 0 }
        }
    }
    function Get-NetTCPConnection {
        param($State, $LocalPort, $ErrorAction)
        if ($State -eq 'Established') {
            if ($global:peerSource) { [pscustomobject]@{ RemoteAddress = $global:peerSource } }
            return
        }
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
        if ($ArgumentList -notcontains '--metro-only') { throw 'Supervisor must not recursively launch another supervisor.' }
        if ($env:EXPO_PUBLIC_DEV_SERVER_ID -ne $global:serverId) { throw 'Missing developer server binding.' }
        $expectedIp = @('192.168.1.8', '10.33.59.31')[$global:started - 1]
        $expectedHost = if (-not $global:hostnameMode -or $global:noHostname -or -not $global:computerName) { $expectedIp } else { $global:computerName }
        if ($env:EXPO_PUBLIC_DEV_API_BASE_URL -ne "https://${expectedHost}:7240") { throw 'Incorrect API address for this workstation/network.' }
        if ($env:EXPO_PACKAGER_PROXY_URL -ne @('http://192.168.1.8:8081', 'http://10.33.59.31:8081')[$global:started - 1]) { throw 'Incorrect Expo advertised IP.' }
        $process = [pscustomobject]@{ Id = 900 + $global:started; HasExited = [bool]$global:failMetro; ExitCode = 0; Generation = $global:started }
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
    function Get-Date {
        if ($global:failReadiness) {
            $global:readinessClock++
            return (Microsoft.PowerShell.Utility\Get-Date).AddMinutes($global:readinessClock)
        }
        Microsoft.PowerShell.Utility\Get-Date
    }
    function Start-Sleep { param($Seconds) }
    $global:computerName = 'synthetic-pc.local'; $global:serverId = 'SYNTHETIC-CA-A'; $global:modelDownloads = 0; $global:hostnameChecks = 0; $global:metroChecks = 0
    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @()
    & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null
    Assert-Equal ($global:prepared -join ',') '192.168.1.8,10.33.59.31' 'prepare initial and changed IP automatically'
    Assert-Equal $global:started 2 'restart Metro after network change, tolerate temporary disconnect'
    Assert-Equal ($global:stopped -join ',') '901' 'stop only owned old Metro, preserve debugger API'
    Assert-Equal $global:modelDownloads 1 'prepare missing model artifacts once on a fresh clone'
    Assert-Equal $global:hostnameChecks 0 'default startup never substitutes a Windows-only hostname for LAN IP'
    Assert-Equal $global:metroChecks 2 'verify Metro status and iOS manifest on each network'

    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @(); $global:apiStarts = 0; $global:noApi = $true
    & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null
    Assert-Equal $global:apiStarts 1 'start API when absent'
    Assert-Equal ($global:stopped -join ',') '901,990' 'cleanup only launcher-owned API and old Metro'
    Assert-Equal $global:modelDownloads 1 'reuse existing models on subsequent startup'

    $global:computerName = 'teammate-b.local'; $global:serverId = 'SYNTHETIC-CA-B'
    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @(); $global:noApi = $false
    $global:hostnameMode = $true
    & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') -HostnameApi | Out-Null
    Assert-Equal $global:started 2 'explicit hostname mode uses the second workstation own hostname and CA'
    $global:noHostname = $true
    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @()
    & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') -HostnameApi -WarningAction SilentlyContinue | Out-Null
    Assert-Equal $global:started 2 'failed hostname probe falls back to the current LAN IP on both networks'
    $global:noHostname = $false; $global:hostnameMode = $false; $global:hostnameChecks = 0
    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @()
    & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') -LanApi | Out-Null
    Assert-Equal $global:hostnameChecks 0 'explicit LAN API mode skips hostname discovery'
    Assert-Equal $global:started 2 'explicit LAN API mode still adapts to network changes'
    $global:computerName = $null; $global:hostnameChecks = 0
    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @()
    & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null
    Assert-Equal $global:hostnameChecks 0 'a non-DNS computer name skips hostname probing'
    Assert-Equal $global:started 2 'a non-DNS computer name still supports the local API via LAN'

    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @(); $global:peerSource = '192.168.1.8'
    $selfProbeOutput = @(& (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1'))
    Assert-Equal @($selfProbeOutput | Where-Object { $_ -like 'Metro received a TCP connection*' }).Count 0 'desktop self-probe is not reported as a connected device'
    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @(); $global:peerSource = '192.168.1.50'
    $peerOutput = @(& (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1'))
    Assert-Equal @($peerOutput | Where-Object { $_ -like 'Metro received a TCP connection*' }).Count 1 'report an observed peer TCP connection once per Metro instance'
    $global:peerSource = $null
    $global:addressCalls = 0; $global:prepared = @(); $global:started = 0; $global:stopped = @(); $global:failMetro = $true
    try { & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null; throw 'Failed Metro was accepted.' }
    catch { if ($_.Exception.Message -notlike 'Metro status/iOS manifest failed*') { throw } }
    Assert-Equal $global:started 1 'surface a Metro startup/manifest failure after successful API readiness'
    $global:failMetro = $false

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
    $global:started = 0; $global:addressCalls = 0; $global:apiDiagnoses = 0; $global:readinessClock = 0
    try { & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null; throw 'Failed API readiness was accepted.' }
    catch {
        if ($_.Exception.Message -notlike 'API HTTPS readiness failed*') { throw }
        Assert-Equal $_.Exception.Message.Contains('Check .tools/mobile-dev-api.stdout.log and .tools/mobile-dev-api.stderr.log.') $true 'owned API diagnostics point to both build output and stderr'
    }
    Assert-Equal $global:started 0 'never start Metro after failed verified HTTPS readiness'
    Assert-Equal $global:apiDiagnoses 1 'diagnose actual HTTPS endpoint on readiness failure'
    $global:noApi = $false; $global:readinessClock = 0; $global:addressCalls = 0
    try { & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null; throw 'Unhealthy existing API was accepted.' }
    catch {
        if ($_.Exception.Message -notlike 'API HTTPS readiness failed*') { throw }
        Assert-Equal $_.Exception.Message.Contains('Check the running API/Visual Studio output') $true 'reused API failure does not direct users to stale standalone logs'
        Assert-Equal $_.Exception.Message.Contains('scripts/Update-LocalDatabase.ps1 -Check') $true 'provide read-only database diagnosis before suggesting migration'
    }
    Assert-Equal $global:apiDiagnoses 2 'diagnose existing API without launching a duplicate'
    Assert-Equal $global:stopped.Contains(123) $false 'unhealthy debugger API remains owned by user'
    $global:failReadiness = $false; $global:failModels = $true; $global:noApi = $false
    $global:prepared = @(); $global:started = 0; $global:addressCalls = 0
    Remove-Item -LiteralPath (Join-Path $testRoot '.tools/ocr-models/charset.txt')
    try { & (Join-Path $testRoot 'scripts/Start-OcrMobileApp.ps1') | Out-Null; throw 'Failed model download was accepted.' }
    catch { if ($_.Exception.Message -ne 'Synthetic model download failure.') { throw } }
    Assert-Equal $global:started 0 'never open Metro after model download failure'
    Assert-Equal $global:prepared.Count 0 'model download failure is visible before modifying API configuration'

    # The upgrade wrapper must execute the freshly built DLL, never stale `dotnet run`
    # output. Mock only the process boundary; no test connects to a user database.
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'scripts/Update-LocalDatabase.ps1') -Destination (Join-Path $testRoot 'scripts/Update-LocalDatabase.ps1')
    [IO.File]::WriteAllText((Join-Path $testRoot '.env'), 'ConnectionStrings__Database=Host=127.0.0.1;Database=bhome;Username=synthetic;Password=synthetic')
    $global:databaseCalls = @(); $global:failDatabaseBuild = $false
    function dotnet {
        $global:databaseCalls += ,@($args)
        if ($args[0] -eq 'build') { $global:LASTEXITCODE = if ($global:failDatabaseBuild) { 1 } else { 0 }; return }
        if ($args[0] -notlike '*BHome.DatabaseUpgrade.dll') { throw 'Must execute the isolated DLL directly.' }
        $global:LASTEXITCODE = if ($args -contains '--check') { 2 } else { 0 }
    }
    $savedConnection = $env:ConnectionStrings__Database
    try {
        $env:ConnectionStrings__Database = 'synthetic-original'
        & (Join-Path $testRoot 'scripts/Update-LocalDatabase.ps1') -EnvironmentFile (Join-Path $testRoot '.env') -Check
        Assert-Equal $global:databaseCalls.Count 2 'pending read-only inspection builds then executes exactly once'
        Assert-Equal ($global:databaseCalls[0] -contains '--artifacts-path') $true 'build isolated from running API DLLs'
        Assert-Equal $global:databaseCalls[1][0] (Join-Path $testRoot '.tools/database-upgrade/bin/BHome.DatabaseUpgrade/debug/BHome.DatabaseUpgrade.dll') 'execute the current isolated migration assembly'
        Assert-Equal ($global:databaseCalls[1] -contains '--check') $true 'forward read-only mode to runner'
        Assert-Equal $env:ConnectionStrings__Database 'synthetic-original' 'restore caller connection after inspection'
        $global:databaseCalls = @()
        & (Join-Path $testRoot 'scripts/Update-LocalDatabase.ps1') -EnvironmentFile (Join-Path $testRoot '.env')
        Assert-Equal ($global:databaseCalls[1] -contains '--check') $false 'explicit upgrade retains migration mode'
        $global:databaseCalls = @(); $global:failDatabaseBuild = $true
        try { & (Join-Path $testRoot 'scripts/Update-LocalDatabase.ps1') -EnvironmentFile (Join-Path $testRoot '.env') -Check; throw 'Failed database build was accepted.' }
        catch { if ($_.Exception.Message -ne 'Local database tool build failed.') { throw } }
        Assert-Equal $global:databaseCalls.Count 1 'never execute a stale runner after build failure'
        Assert-Equal $env:ConnectionStrings__Database 'synthetic-original' 'restore caller connection after build failure'
        $global:databaseCalls = @()
        [IO.File]::WriteAllText((Join-Path $testRoot '.env'), 'ConnectionStrings__Database=Host=remote.invalid;Database=bhome')
        try { & (Join-Path $testRoot 'scripts/Update-LocalDatabase.ps1') -EnvironmentFile (Join-Path $testRoot '.env') -Check; throw 'Remote database was accepted.' }
        catch { if ($_.Exception.Message -notlike 'Refusing migration:*') { throw } }
        Assert-Equal $global:databaseCalls.Count 0 'remote database rejected before build or inspection'
    } finally { $env:ConnectionStrings__Database = $savedConnection }
    Write-Output "PASS $checks mobile network/launcher assertions."
} finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    $allowedRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot '.tools')) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedTestRoot.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup target.' }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
}
