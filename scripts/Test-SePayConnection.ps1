param([string]$EnvironmentFile = '.env.sepay.local', [ValidateSet('Test','Live')][string]$Mode = 'Test')

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$configurationPath = if ([IO.Path]::IsPathRooted($EnvironmentFile)) { $EnvironmentFile } else { Join-Path $repository $EnvironmentFile }
if (-not (Test-Path -LiteralPath $configurationPath)) { throw 'Selected private environment file is missing.' }
$settings = @{}
foreach ($line in [IO.File]::ReadAllLines($configurationPath)) {
    if ($line -match '^(SePay__[^=]+)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim().Trim('"', "'") }
}
# Read-only for either profile: never follow a redirect carrying credentials.
$profilePrefix = 'SePay__' + $Mode + '__'
$dualProfile = $settings.ContainsKey($profilePrefix + 'Enabled')
if ($dualProfile) {
    if ($settings.SePay__Enabled -ne 'true') { throw 'SePay integration is disabled.' }
    # A selected profile never inherits the old flat token or extra bank bindings.
    foreach ($key in @($settings.Keys)) {
        if ($key -in @('SePay__ApiToken', 'SePay__ApiBaseUrl') -or $key.StartsWith('SePay__ReceivingAccounts__')) {
            $settings.Remove($key)
        }
    }
    foreach ($key in @($settings.Keys)) {
        if ($key.StartsWith($profilePrefix)) { $settings['SePay__' + $key.Substring($profilePrefix.Length)] = $settings[$key] }
    }
    $settings.SePay__Mode = $Mode
}
$expectedApi = if ($Mode -eq 'Test') { 'https://userapi-sandbox.sepay.vn/v2' } else { 'https://userapi.sepay.vn/v2' }
if ($settings.SePay__Enabled -ne 'true' -or $settings.SePay__Mode -ne $Mode -or
    ([string]$settings.SePay__ApiBaseUrl).TrimEnd('/') -ne $expectedApi) {
    throw 'This check requires the selected enabled SePay profile and its official API host.'
}
$overrideToken = [Environment]::GetEnvironmentVariable($(if ($dualProfile) { $profilePrefix + 'ApiToken' } else { 'SePay__ApiToken' }))
$apiToken = if ($overrideToken) { $overrideToken } else { $settings.SePay__ApiToken }
if ([string]::IsNullOrWhiteSpace($apiToken) -or $apiToken -match 'replace|[\r\n]') { throw 'Configure a private selected-profile API token first.' }
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
            $response = $http.GetAsync($expectedApi + '/' + $endpoint).GetAwaiter().GetResult()
            if (-not $response.IsSuccessStatusCode) { throw ('SePay provider returned HTTP ' + [int]$response.StatusCode + '. No response body is printed.') }
            $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
            if ($body.status -ne 'success') { throw 'SePay provider returned an unsuccessful response.' }
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
                    Write-Output ([pscustomobject]@{ Binding = $prefix; Mode = $Mode; MatchesActiveAccount = $matchesBinding } | ConvertTo-Json -Compress)
                    if (-not $matchesBinding) { $allBindingsMatch = $false }
                }
            }
        } catch {
            # Never print provider payload, Authorization headers or exception request objects.
            if ($response -and -not $response.IsSuccessStatusCode) { throw ('SePay provider returned HTTP ' + [int]$response.StatusCode + '.') }
            throw 'SePay provider connectivity or response validation failed. Credentials and payload were omitted.'
        } finally { if ($response) { $response.Dispose() } }
    }
    if (-not $allBindingsMatch) { throw 'A receiving binding is missing or does not match an active provider account.' }
} finally { $http.Dispose(); $apiToken = $null }
