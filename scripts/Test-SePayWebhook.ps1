param([Parameter(Mandatory=$true)][string]$PublicBaseUrl)
$ErrorActionPreference = 'Stop'
$baseUri = $null
if (-not [Uri]::TryCreate($PublicBaseUrl, [UriKind]::Absolute, [ref]$baseUri) -or
    $baseUri.Scheme -ne 'https' -or $baseUri.UserInfo -or $baseUri.Query -or $baseUri.Fragment -or $baseUri.AbsolutePath -ne '/') {
    throw 'Supply only the public HTTPS origin, without credentials, path, query or fragment.'
}
Add-Type -AssemblyName System.Net.Http
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$http = [Net.Http.HttpClient]::new($handler)
$http.Timeout = [TimeSpan]::FromSeconds(15)
$http.MaxResponseContentBufferSize = 32768
try {
    foreach ($route in @('/health/live','/api/v1/integrations/sepay/webhook')) {
        $response = $null
        try {
            if ($route -eq '/health/live') { $response = $http.GetAsync($baseUri.GetLeftPart([UriPartial]::Authority) + $route).GetAwaiter().GetResult() }
            else {
                # Connectivity/authentication probe only; never signs or allocates a payment.
                $payload = [Net.Http.StringContent]::new('{}', [Text.Encoding]::UTF8, 'application/json')
                try { $response = $http.PostAsync($baseUri.GetLeftPart([UriPartial]::Authority) + $route, $payload).GetAwaiter().GetResult() }
                finally { $payload.Dispose() }
            }
            $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            $ngrokCode = [regex]::Match($body, 'ERR_NGROK_[0-9]+').Value
            $backendCode = ''
            if ($route -ne '/health/live' -and $response.Content.Headers.ContentType.MediaType -like '*json*') {
                try { $backendCode = ($body | ConvertFrom-Json).code } catch { $backendCode = '' }
            }
            Write-Output ([pscustomobject]@{ Route=$route; HttpStatus=[int]$response.StatusCode; TunnelError=$ngrokCode; BackendCode=$backendCode } | ConvertTo-Json -Compress)
            if ($ngrokCode) { throw ('Public tunnel is unavailable: ' + $ngrokCode) }
            $expected = if ($route -eq '/health/live') { 200 } else { 401 }
            if ([int]$response.StatusCode -ne $expected) { throw ('Unexpected public status ' + [int]$response.StatusCode + '; expected ' + $expected + '. Check routing and Enabled/Test configuration.') }
            if ($route -ne '/health/live' -and $backendCode -ne 'sepay_authentication_failed') { throw 'The 401 did not come from the SePay HMAC guard. Check proxy authentication and the upstream service.' }
        } finally { if ($response) { $response.Dispose() } }
    }
    Write-Output 'PASS: public route reaches the API and rejects an unsigned webhook. Actual SePay HMAC delivery is still a separate acceptance check.'
} finally { $http.Dispose() }
