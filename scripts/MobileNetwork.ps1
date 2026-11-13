# Shared Windows LAN selection. No configuration writes or network probes.
function Test-MobilePrivateIpv4([string]$Address) {
    $parsed = $null
    return [Net.IPAddress]::TryParse($Address, [ref]$parsed) -and
        $parsed.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and
        ($Address -match '^192\.168\.' -or $Address -match '^10\.' -or $Address -match '^172\.(1[6-9]|2[0-9]|3[01])\.')
}

function Select-MobileLanIp($Configurations, $Routes) {
    $candidates = @(foreach ($configuration in $Configurations) {
        if (-not $configuration.IPv4DefaultGateway -or $configuration.NetAdapter.Status -ne 'Up' -or
            $configuration.NetAdapter.InterfaceDescription -match 'Virtual|Hyper-V|Docker|VPN|WireGuard|Tailscale|TAP|TUN|ZeroTier|WSL|Bluetooth') { continue }
        $route = $Routes | Where-Object { $_.InterfaceIndex -eq $configuration.InterfaceIndex } |
            Sort-Object RouteMetric | Select-Object -First 1
        if (-not $route) { continue }
        foreach ($address in $configuration.IPv4Address) {
            if (-not (Test-MobilePrivateIpv4 $address.IPAddress) -or $address.SkipAsSource) { continue }
            [pscustomobject]@{
                Address = $address.IPAddress
                Metric = [int]$route.RouteMetric + [int]$configuration.NetIPv4Interface.InterfaceMetric
                InterfaceIndex = $configuration.InterfaceIndex
            }
        }
    })
    return ($candidates | Sort-Object Metric,InterfaceIndex,Address | Select-Object -First 1).Address
}

function Get-MobileLanIp {
    $address = Select-MobileLanIp (Get-NetIPConfiguration) (Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue)
    if (-not $address) { throw 'No active private IPv4 LAN with a default gateway. Connect this computer and the phone to the same Wi-Fi/LAN.' }
    return $address
}

function Get-MobileDevelopmentServerId([string]$CertificatePath) {
    $certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($CertificatePath)
    try { return $certificate.Thumbprint } finally { $certificate.Dispose() }
}

function Get-MobileDevelopmentHost([string]$ComputerName = [Net.Dns]::GetHostName()) {
    $name = $ComputerName.ToLowerInvariant()
    if ($name -notmatch '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$') { return $null }
    return "$name.local"
}

# Parse only backend configuration already supported by the local API launcher.
# This returns data; never evaluate .env contents or print the returned values.
function Get-MobileBackendSettings([string]$ConfigurationText) {
    $settings = @{}
    foreach ($line in ($ConfigurationText -split '\r?\n')) {
        if ($line -match '^((?:ConnectionStrings|Jwt|Sessions|AuthRateLimit|AuthWeb|AuthenticationEmail|Email|ObjectStorage|Jobs|Cors|BankIntegration|SePay|NotificationIntegration|NotificationChannels|OwnerSetup|ElectronicContractIntegration|Ocr|IdentityProtection|Capture|Kestrel|MobileDevelopment|Api|MainDraft|DevelopmentDatabase|DigitalSigning|AnonymousSigning)__[^=]+|AllowedHosts)=(.*)$') {
            $settings[$Matches[1].Replace('__', ':')] = $Matches[2]
        }
    }
    return $settings
}

# Keep native LAN clients on the mobile CA, including clients that send no SNI.
# localhost can use an already-trusted ASP.NET development certificate on this PC.
function Get-MobileHttpsSniSettings([string]$MobilePfxPath, [string]$Password, [string]$LocalhostPfxPath) {
    if (-not $LocalhostPfxPath) { $LocalhostPfxPath = $MobilePfxPath }
    return @{
        'Kestrel:Endpoints:MobileHttps:Sni:*:Certificate:Path' = $MobilePfxPath
        'Kestrel:Endpoints:MobileHttps:Sni:*:Certificate:Password' = $Password
        'Kestrel:Endpoints:MobileHttps:Sni:localhost:Certificate:Path' = $LocalhostPfxPath
        'Kestrel:Endpoints:MobileHttps:Sni:localhost:Certificate:Password' = $Password
    }
}
