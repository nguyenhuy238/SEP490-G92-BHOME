param([string]$EnvironmentFile = '.env.sepay.local')

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$configurationPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repository $EnvironmentFile }
if (-not (Test-Path -LiteralPath $configurationPath)) { throw 'Selected private environment file is missing.' }
$settings = @{}
foreach ($line in [IO.File]::ReadAllLines($configurationPath)) {
    if ($line -match '^(SePay__[^=]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim().Trim('"', "'") }
}
# Deliberately read-only and sandbox-only: never follow a redirect carrying credentials.
if ($settings.SePay__Enabled -ne 'true' -or $settings.SePay__Mode -ne 'Test' -or
    ([string]$settings.SePay__ApiBaseUrl).TrimEnd('/') -ne 'https://userapi-sandbox.sepay.vn/v2') {
    throw 'This check requires enabled SePay Test Mode and the official sandbox API host.'
}
$apiToken = if ($env:SePay__ApiToken) { $env:SePay__ApiToken } else { $settings.SePay__ApiToken }
if ([string]::IsNullOrWhiteSpace($apiToken) -or $apiToken -match 'replace|[\r\n]') { throw 'Configure a private sandbox API token first.' }
Add-Type -AssemblyName System.Net.Http
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$http = [Net.Http.HttpClient]::new($handler)
$http.Timeout = [TimeSpan]::FromSeconds(20)
$http.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $apiToken)
$allBindingsMatch = $true
try {
    foreach ($endpoint in @('bank-accounts', 'transactions?per_page=1&transaction_date_sort=asc&timestamp_format=iso8601')) {
        $response = $null
        try {
            $response = $http.GetAsync('https://userapi-sandbox.sepay.vn/v2/' + $endpoint).GetAwaiter().GetResult()
            if (-not $response.IsSuccessStatusCode) { throw ('SePay sandbox returned HTTP ' + [int]$response.StatusCode + '. No response body is printed.') }
            $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
            if ($body.status -ne 'success') { throw 'SePay sandbox returned an unsuccessful response.' }
            Write-Output ([pscustomobject]@{ Endpoint = $endpoint.Split('?')[0]; HttpStatus = [int]$response.StatusCode; Status = $body.status; ItemsOnPage = @($body.data).Count } | ConvertTo-Json -Compress)
            if ($endpoint -eq 'bank-accounts') {
                $bindingKeys = @($settings.Keys | Where-Object { $_ -match '^SePay__ReceivingAccounts__\d+__AccountNumber$' })
                if ($bindingKeys.Count -eq 0) { $allBindingsMatch = $false }
                foreach ($key in $bindingKeys) {
                    $prefix = $key -replace 'AccountNumber$', ''
                    $matchesBinding = @($body.data | Where-Object {
                        $_.account_number -ceq $settings[$key] -and $_.bank_bin -eq $settings[$prefix + 'BankIdentifier'] -and
                        $_.bank_short_name -eq $settings[$prefix + 'Gateway'] -and $_.active
                    }).Count -gt 0
                    Write-Output ([pscustomobject]@{ Binding = $prefix; MatchesActiveSandboxAccount = $matchesBinding } | ConvertTo-Json -Compress)
                    if (-not $matchesBinding) { $allBindingsMatch = $false }
                }
            }
        } catch {
            # Never print provider payload, Authorization headers or exception request objects.
            if ($response -and -not $response.IsSuccessStatusCode) { throw ('SePay sandbox returned HTTP ' + [int]$response.StatusCode + '.') }
            throw 'SePay sandbox connectivity or response validation failed. Credentials and payload were omitted.'
        } finally { if ($response) { $response.Dispose() } }
    }
    if (-not $allBindingsMatch) { throw 'A receiving binding is missing or does not match an active Sandbox account.' }
} finally { $http.Dispose(); $apiToken = $null }
