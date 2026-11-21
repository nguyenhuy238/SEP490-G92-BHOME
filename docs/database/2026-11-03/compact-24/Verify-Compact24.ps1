param(
    [string]$PsqlPath,
    [string]$MetadataOutputPath
)

# Creates and removes only a uniquely named synthetic database. Never migrates bhome.
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
if (-not $PsqlPath) {
    $command = Get-Command psql -ErrorAction SilentlyContinue
    if ($command) { $PsqlPath = $command.Source }
    else {
        foreach ($version in @('16', '18', '17')) {
            $candidate = "C:/Program Files/PostgreSQL/$version/bin/psql.exe"
            if (Test-Path -LiteralPath $candidate) { $PsqlPath = $candidate; break }
        }
    }
}
if (-not $PsqlPath -or -not (Test-Path -LiteralPath $PsqlPath)) { throw 'Specify -PsqlPath.' }
$connection = [Environment]::GetEnvironmentVariable('ConnectionStrings__Database')
if (-not $connection) {
    $line = Get-Content -LiteralPath (Join-Path $repo '.env') |
        Where-Object { $_ -match '^ConnectionStrings__Database=' } | Select-Object -First 1
    if (-not $line) { throw 'Set ConnectionStrings__Database or the local .env entry.' }
    $connection = $line.Substring($line.IndexOf('=') + 1)
}
$settings = [System.Data.Common.DbConnectionStringBuilder]::new()
$settings.set_ConnectionString($connection)
if ([string]$settings['Host'] -notin @('localhost', '127.0.0.1', '::1')) {
    throw 'Only a loopback PostgreSQL test server is supported.'
}
$saved = @{}
foreach ($name in @('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGCONNECT_TIMEOUT', 'PGCLIENTENCODING', 'PGOPTIONS')) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name)
}
$scratch = 'bhome_compact24_' + [Guid]::NewGuid().ToString('N')
$created = $false
function Invoke-ReviewSql([string]$Database, [string]$Sql) {
    $result = @($Sql | & $PsqlPath -X -w -q -t -A -d $Database -v ON_ERROR_STOP=1 2>&1)
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL verification failed. No connection or business data printed.' }
    return $result | ForEach-Object { "$_" } | Where-Object { $_ -ne '' }
}
function Invoke-ReviewFile([string]$Database, [string]$Path) {
    # psql errors are assessed by exit code; never echo connection details.
    $ErrorActionPreference = 'Continue'
    & $PsqlPath -X -w -q -d $Database -v ON_ERROR_STOP=1 -f $Path *> $null
    return $LASTEXITCODE
}

try {
    $env:PGHOST = [string]$settings['Host']
    $env:PGPORT = if ($settings.ContainsKey('Port')) { [string]$settings['Port'] } else { '5432' }
    $env:PGUSER = [string]$settings['Username']
    $env:PGPASSWORD = [string]$settings['Password']
    $env:PGCONNECT_TIMEOUT = '5'
    $env:PGCLIENTENCODING = 'UTF8'
    $env:PGOPTIONS = '-c client_min_messages=error'
    Invoke-ReviewSql 'postgres' "CREATE DATABASE `"$scratch`";" | Out-Null
    $created = $true
    $schema = Join-Path $PSScriptRoot 'BHOME_24_TABLES.sql'
    $checks = Join-Path $PSScriptRoot 'SCHEMA_CHECKS.sql'
    Write-Output ('PostgreSQL ' + (Invoke-ReviewSql $scratch "SELECT current_setting('server_version');"))
    if ((Invoke-ReviewFile $scratch $schema) -ne 0) { throw 'Compact schema creation failed.' }
    $count = Invoke-ReviewSql $scratch "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
    if ($count -ne '24') { throw 'Expected exactly 24 tables.' }
    Write-Output 'PASS: SQL creates exactly 24 physical tables.'
    if ((Invoke-ReviewFile $scratch $checks) -ne 0) { throw 'Compact schema assertions failed.' }
    $checkText = Get-Content -LiteralPath $checks -Raw -Encoding UTF8
    $assertions = [regex]::Matches($checkText,'(?m)^SELECT pg_temp\.(assert_true|expect_error)\(').Count
    Write-Output "PASS: $assertions synthetic database assertions; fixtures rolled back."
    if ((Invoke-ReviewFile $scratch $schema) -eq 0) { throw 'DDL unexpectedly accepted a populated schema.' }
    Write-Output 'PASS: DDL rejects an existing schema instead of replacing it.'
    $metadataSql = @'
SELECT json_build_object(
 'Tables',(SELECT json_agg(json_build_object('Name',c.relname,'Columns',
   (SELECT json_agg(json_build_object('Name',a.attname,'Type',format_type(a.atttypid,a.atttypmod),'Nullable',NOT a.attnotnull,'PrimaryKey',
       EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p' AND a.attnum=ANY(k.conkey)),
       'DefaultSql',(SELECT pg_get_expr(d.adbin,d.adrelid) FROM pg_attrdef d WHERE d.adrelid=c.oid AND d.adnum=a.attnum)) ORDER BY a.attnum)
    FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
 'ForeignKeys',(SELECT json_agg(json_build_object('Table',c.relname,'Columns',
      (SELECT json_agg(a.attname ORDER BY v.ord) FROM unnest(k.conkey) WITH ORDINALITY v(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=v.attnum),
    'Target',p.relname,'TargetColumns',
      (SELECT json_agg(a.attname ORDER BY v.ord) FROM unnest(k.confkey) WITH ORDINALITY v(attnum,ord) JOIN pg_attribute a ON a.attrelid=p.oid AND a.attnum=v.attnum)) ORDER BY c.relname,k.conname)
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class p ON p.oid=k.confrelid WHERE k.contype='f' AND k.connamespace='public'::regnamespace),
 'Indexes',(SELECT json_agg(json_build_object('Table',tablename,'Name',indexname,'Sql',indexdef) ORDER BY tablename,indexname) FROM pg_indexes WHERE schemaname='public'),
 'Constraints',(SELECT json_agg(json_build_object('Table',c.relname,'Name',k.conname,'Kind',k.contype,'Sql',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname)
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE k.connamespace='public'::regnamespace)
);
'@
    $metadata = (Invoke-ReviewSql $scratch $metadataSql) | ConvertFrom-Json
    if ($MetadataOutputPath) {
        # Optional schema-only export for regenerating design artifacts; no business data.
        $metadataJson = $metadata | ConvertTo-Json -Depth 30
        [IO.File]::WriteAllText([IO.Path]::GetFullPath($MetadataOutputPath),$metadataJson,[Text.UTF8Encoding]::new($false))
    }
    $diagram = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'BHOME_24_TABLES.dbml') -Raw -Encoding UTF8
    $diagramTables = [regex]::Matches($diagram,'(?ms)^Table (\w+) \{\r?\n(.*?)^\}')
    if ($diagramTables.Count -ne 24) { throw 'Diagram must contain exactly 24 tables.' }
    foreach ($table in $metadata.Tables) {
        $block = @($diagramTables | Where-Object { $_.Groups[1].Value -eq $table.Name })
        if ($block.Count -ne 1) { throw 'SQL/diagram table names differ.' }
        $diagramColumns = @([regex]::Matches($block[0].Groups[2].Value,'(?m)^  (\w+) "') | ForEach-Object { $_.Groups[1].Value }) | Sort-Object
        $actualColumns = @($table.Columns | ForEach-Object { $_.Name }) | Sort-Object
        if (Compare-Object $actualColumns $diagramColumns) { throw 'SQL/diagram column names differ.' }
    }
    if ([regex]::Matches($diagram,'(?m)^Ref:').Count -ne @($metadata.ForeignKeys).Count) { throw 'SQL/diagram FK counts differ.' }
    Write-Output 'PASS: SQL/DBML table names, column names and FK counts match.'
    $jsonDiagram = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'BHOME_Database_Design.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $designPages = @($jsonDiagram.pages | Where-Object { @($_.cells | Where-Object type -eq 'node').Count -eq 24 })
    if ($designPages.Count -ne 1) { throw 'Expected exactly one 24-table JSON design page.' }
    $cells = @($designPages[0].cells)
    if (@($cells.id | Select-Object -Unique).Count -ne $cells.Count) { throw 'Duplicate JSON cell IDs.' }
    $jsonNodes = @{}
    foreach ($cell in $cells | Where-Object type -eq 'node') {
        $nodeRows = @([regex]::Matches($cell.html,'(?is)<tr\b[^>]*>(.*?)</tr>'))
        $parsedRows = @()
        foreach ($row in $nodeRows) {
            $parts = @([regex]::Matches($row.Groups[1].Value,'(?is)<td\b[^>]*>(.*?)</td>') | ForEach-Object {
                [Net.WebUtility]::HtmlDecode([regex]::Replace($_.Groups[1].Value,'<[^>]+>','')).Trim()
            })
            $parsedRows += ,$parts
        }
        $name = $parsedRows[0][0]
        if ($jsonNodes.ContainsKey($name)) { throw 'Duplicate JSON table names.' }
        $jsonNodes[$name] = $cell
        $table = @($metadata.Tables | Where-Object Name -eq $name)
        if ($table.Count -ne 1) { throw 'Unexpected JSON table.' }
        $columnRows = @($parsedRows | Where-Object Count -eq 3)
        if ($columnRows.Count -ne $table[0].Columns.Count) { throw "JSON column count differs for $name." }
        for ($index = 0; $index -lt $columnRows.Count; $index++) {
            $column = $table[0].Columns[$index]
            $expectedType = ($column.Type -replace '^character varying','varchar' -replace '^timestamp with time zone$','timestamptz').ToUpperInvariant()
            if ($columnRows[$index][0] -cne $column.Name -or $columnRows[$index][1] -cne $expectedType) { throw "JSON column name/type differs for $name." }
            $notNull = $columnRows[$index][2] -match '(^|, )NOT NULL(,|$)'
            $isPk = $columnRows[$index][2] -match '(^|, )PK(,|$)'
            if ($notNull -eq $column.Nullable -or $isPk -ne $column.PrimaryKey) { throw "JSON nullability/primary key differs for $name." }
        }
    }
    $actualRelations = @($cells | Where-Object type -eq 'edge' | ForEach-Object { "$($_.source)|$($_.target)|$($_.label)" }) | Sort-Object
    $expectedRelations = @($metadata.ForeignKeys | ForEach-Object {
        $left = $jsonNodes[$_.Table].id
        $right = $jsonNodes[$_.Target].id
        # Unicode arrow is constructed explicitly for Windows PowerShell UTF-8 compatibility.
        $label = ($_.Columns -join ', ') + ' ' + [char]0x2192 + ' ' + ($_.TargetColumns -join ', ')
        "$left|$right|$label"
    }) | Sort-Object
    if (Compare-Object $expectedRelations $actualRelations) { throw 'JSON FK endpoints or column labels differ from SQL.' }
    Write-Output "PASS: SQL/JSON match: 24 tables, column names/types/nullability/PK and $($expectedRelations.Count) exact FK relations; unique cell IDs."
}
finally {
    try {
        if ($created -and $scratch -match '^bhome_compact24_[a-f0-9]{32}$') {
            Invoke-ReviewSql 'postgres' "DROP DATABASE `"$scratch`";" | Out-Null
            Write-Output 'Synthetic database removed; bhome unchanged.'
        }
    }
    finally {
        foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
    }
}
