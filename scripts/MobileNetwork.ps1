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
