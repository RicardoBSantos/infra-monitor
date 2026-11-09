#Requires -Version 7.2
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Assert-AbsolutePath([string]$Path) {
    if (-not [IO.Path]::IsPathFullyQualified($Path) -or $Path.StartsWith('\\') -or $Path -match '(^|[\\/])\.\.([\\/]|$)') { throw 'Absolute local path required' }
    $full=[IO.Path]::GetFullPath($Path).TrimEnd([char[]]'\/')
    if ($full -eq [IO.Path]::GetPathRoot($full).TrimEnd([char[]]'\/')) { throw 'Volume root forbidden' }
    $cursor=$full
    while ($cursor -and (Split-Path -Parent $cursor)) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -Force -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected reparse point' }
        $cursor=Split-Path -Parent $cursor
    }
    return $full
}
function Assert-RelativePath([string]$Name) {
    if ($Name -notmatch '^[A-Za-z0-9_@][A-Za-z0-9_@./-]*$' -or $Name -match '(^|/)\.\.?(/|$)' -or $Name.Contains('//')) { throw 'Unsafe package path' }
}
function Test-FreeSpacePolicy {
    param([UInt64]$FreeBytes,[UInt64]$AdditionalBytes,[UInt64]$PeakBytes)
    $projected=[decimal]$FreeBytes-[decimal]$AdditionalBytes-[decimal]$PeakBytes
    if ($projected -lt 22GB) { throw 'Projected free space below 22 GiB; operation blocked' }
    [pscustomobject]@{ ProjectedFreeBytes=$projected; ReserveBytes=20GB; GateBytes=22GB }
}
function Test-PackageIntegrity {
    param([Parameter(Mandatory)][string]$PackagePath)
    $p=Assert-AbsolutePath $PackagePath
    $m=Get-Content -Raw -LiteralPath (Join-Path $p 'package-manifest.json') | ConvertFrom-Json -AsHashtable
    if ($m.format -ne 1 -or $m.commit -notmatch '^[0-9a-f]{40}$' -or $m.version -cne ('r-'+$m.commit) -or $m.schemaVersion -ne 25 -or $m.historyGuard -ne $true) { throw 'Invalid package manifest' }
    if ($m.components.backend.commit -cne $m.commit -or $m.components.frontend.commit -cne $m.commit) { throw 'Divergent commits' }
    $listed=@{}
    foreach ($line in (Get-Content -LiteralPath (Join-Path $p 'SHA256SUMS'))) {
        if ($line -cnotmatch '^([0-9a-f]{64})  (.+)$') { throw 'Invalid checksums' }
        $hash=$Matches[1]; $name=$Matches[2]; Assert-RelativePath $name
        if ($listed.ContainsKey($name)) { throw 'Duplicate checksum' }
        $listed[$name]=$hash
    }
    $actual=@{}
    foreach ($item in (Get-ChildItem -LiteralPath $p -Recurse -Force)) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package reparse point' }
        if (-not $item.PSIsContainer) {
            $name=[IO.Path]::GetRelativePath($p,$item.FullName).Replace('\','/')
            Assert-RelativePath $name
            if ($name -ne 'SHA256SUMS') { $actual[$name]=$item.FullName }
        }
    }
    if ($actual.Count -ne $listed.Count) { throw 'Unexpected or missing file' }
    foreach ($name in $actual.Keys) {
        if (-not $listed.ContainsKey($name) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $actual[$name]).Hash.ToLowerInvariant() -cne $listed[$name]) { throw 'Checksum mismatch' }
    }
    if ($m.files.Count -ne ($actual.Count-1)) { throw 'Manifest inventory mismatch' }
    foreach ($name in $m.files.Keys) {
        if (-not $listed.ContainsKey($name) -or $listed[$name] -cne $m.files[$name]) { throw 'Manifest hash mismatch' }
    }
    foreach ($name in @("releases/$($m.version)/backend/app.jar","releases/$($m.version)/frontend/index.html","releases/$($m.version)/frontend/web.config")) {
        if (-not $m.files.ContainsKey($name)) { throw 'Incomplete release' }
    }
    return $m
}
function Test-ReleaseIntegrity([string]$Path) {
    $path=Assert-AbsolutePath $Path
    $m=Get-Content -Raw -LiteralPath (Join-Path $path 'release-manifest.json') | ConvertFrom-Json -AsHashtable
    if ($m.version -cne (Split-Path -Leaf $path) -or $m.version -cne ('r-'+$m.commit) -or $m.commit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid release identity' }
    $prefix="releases/$($m.version)/"; $expected=@{}
    foreach ($name in $m.files.Keys) {
        if ($name.StartsWith($prefix,[StringComparison]::Ordinal)) {
            $relative=$name.Substring($prefix.Length); Assert-RelativePath $relative
            $expected[$relative]=$m.files[$name]
        }
    }
    $seen=@()
    foreach ($item in Get-ChildItem -LiteralPath $path -Recurse -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Release reparse point' }
        if (-not $item.PSIsContainer -and $item.Name -ne 'release-manifest.json') {
            $name=[IO.Path]::GetRelativePath($path,$item.FullName).Replace('\','/'); $seen+=$name
            if (-not $expected.ContainsKey($name) -or (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -cne $expected[$name]) { throw 'Release integrity failure' }
        }
    }
    if ($seen.Count -ne $expected.Count -or -not $expected.ContainsKey('backend/app.jar') -or -not $expected.ContainsKey('frontend/index.html')) { throw 'Release incomplete' }
    return $m
}
function Test-RollbackCompatibility {
    param([hashtable]$Proof,[hashtable]$Current,[hashtable]$Target,[string]$Component,[int]$SchemaVersion)
    if ($SchemaVersion -ne 25 -or $Target.schemaVersion -ne 25 -or $Target.historyGuard -ne $true -or $Proof.approved -ne $true -or $Proof.schemaVersion -ne $SchemaVersion) { throw 'Schema compatibility not proven' }
    foreach ($key in @('backend','frontend')) {
        $desired=if ($Component -eq 'Both' -or $Component -eq $key) { $Target.version } else { $Current[$key] }
        if ($Proof.current[$key] -cne $Current[$key] -or $Proof.target[$key] -cne $desired) { throw 'Compatibility proof does not match release pair' }
    }
}
function Test-HealthResult([int]$StatusCode,[string]$Status) {
    if ($StatusCode -ne 200 -or $Status -cne 'UP') { throw 'Health check failed' }
    return $true
}
function ConvertFrom-HealthContent($Content) {
    # PowerShell 7 returns Content as byte[] for application/vnd.spring-boot.actuator.v3+json.
    $text=if ($Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($Content) } else { [string]$Content }
    $json=$text | ConvertFrom-Json
    if ($json -isnot [pscustomobject] -or $json.PSObject.Properties.Name -notcontains 'status') { return $null }
    return [string]$json.status
}
function Test-BackendHealth {
    param([ValidateRange(1,65535)][int]$Port=8080)
    $r=Invoke-WebRequest -Uri "http://127.0.0.1:$Port/actuator/health" -TimeoutSec 10 -MaximumRedirection 0
    Test-HealthResult ([int]$r.StatusCode) (ConvertFrom-HealthContent $r.Content)
}
function Test-WindowsPrerequisites {
    param([string]$JavaHome,[string]$Root,[string]$ServiceSid,[string]$WinSWExecutable,[string]$WinSWSha256,[string]$PostgreSQLHome)
    $java=Assert-AbsolutePath $JavaHome
    if ((Get-Content -LiteralPath (Join-Path $java 'release') -Raw) -notmatch 'JAVA_VERSION="21[."]') { throw 'Java 21 required' }
    if (-not (Test-Path -LiteralPath (Join-Path $java 'bin/java.exe'))) { throw 'java.exe missing' }
    if ($ServiceSid -notmatch '^S-1-5-') { throw 'Explicit service SID required' }
    $wrapper=Assert-AbsolutePath $WinSWExecutable
    if ($WinSWSha256 -notmatch '^[0-9a-f]{64}$' -or (Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash.ToLowerInvariant() -cne $WinSWSha256) { throw 'WinSW approved binary hash required' }
    $pg=Assert-AbsolutePath $PostgreSQLHome
    if ((Get-Item -LiteralPath (Join-Path $pg 'bin/postgres.exe')).VersionInfo.FileMajorPart -ne 16) { throw 'PostgreSQL 16 required' }
    Import-Module WebAdministration
    foreach ($module in @('RewriteModule','ApplicationRequestRouting')) {
        if (-not (Get-WebGlobalModule | Where-Object Name -eq $module)) { throw "IIS module missing: $module" }
    }
    $release=Get-ItemPropertyValue -LiteralPath 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' -Name Release
    if ($release -lt 394254) { throw '.NET Framework 4.6.1+ required by WinSW 2.12' }
    foreach ($key in @('DB_NAME','DB_USERNAME','DB_PASSWORD','JWT_SECRET')) {
        $file=Join-Path $Root "config/secrets/$key"
        Assert-AbsolutePath $file | Out-Null
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -eq 0) { throw 'Mandatory protected configuration missing' }
        if ($key -eq 'JWT_SECRET' -and (Get-Item -LiteralPath $file).Length -lt 32) { throw 'JWT key too short' }
        $acl=Get-Acl -LiteralPath $file
        if (-not $acl.AreAccessRulesProtected) { throw 'Secret ACL inheritance must be disabled' }
        foreach ($ace in $acl.Access) {
            $sid=$ace.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if ($ace.AccessControlType -eq 'Allow' -and $sid -notin @('S-1-5-18','S-1-5-32-544',$ServiceSid)) { throw 'Secret ACL grants unexpected identity' }
        }
    }
    [pscustomobject]@{ Java=21; IISModules='present'; SecretACL='checked'; WinSWInstall='not performed' }
}
function Invoke-JunctionTransition([string]$Root,[string]$Version,[string]$Part,[bool]$Rollback) {
    if ($Version -notmatch '^r-[0-9a-f]{40}$' -or $Part -notin @('backend','frontend')) { throw 'Invalid junction identity' }
    $current=Join-Path $Root 'current'
    Assert-AbsolutePath $current | Out-Null
    $link=Join-Path $current $Part
    $previous=Join-Path $current "$Part.previous"
    $temporary=Join-Path $current "$Part.swap"
    $target=Join-Path $Root "releases/$Version/$Part"
    Assert-AbsolutePath $target | Out-Null
    if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw 'Junction target missing' }
    if (Test-Path -LiteralPath $temporary) { throw 'Interrupted transition requires review' }
    if (Test-Path -LiteralPath $previous) {
        $old=Get-Item -LiteralPath $previous -Force
        if (-not $Rollback -or $old.LinkType -ne 'Junction' -or @($old.Target).Count -ne 1 -or [IO.Path]::GetFullPath([string]@($old.Target)[0]) -ine [IO.Path]::GetFullPath($target)) { throw 'Previous junction is not the approved rollback target' }
        # Rename pointers only. Never recursively delete a link or its target.
        Move-Item -LiteralPath $link -Destination $temporary
        Move-Item -LiteralPath $previous -Destination $link
        Move-Item -LiteralPath $temporary -Destination $previous
    } else {
        if (Test-Path -LiteralPath $link) { Move-Item -LiteralPath $link -Destination $previous }
        New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    }
}
function Invoke-ReleaseOperation {
    [CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
    param(
        [ValidateSet('Inspect','Prerequisites','Verify','Space','Stage','Health','Switch','Rollback')][string]$Operation='Inspect',
        [Parameter(Mandatory)][string]$Root,
        [string]$PackagePath,[string]$Version,
        [ValidateSet('Both','backend','frontend')][string]$Component='Both',
        [string]$CompatibilityProof,[int]$SchemaVersion=0,
        [string]$ServiceName,[string]$SiteName,[string]$JavaHome,[string]$ServiceSid,
        [string]$WinSWExecutable,[string]$WinSWSha256,[string]$PostgreSQLHome,
        [UInt64]$OperationalPeakBytes=3GB,
        [switch]$Apply,[string]$ApprovalId
    )
    $rootPath=Assert-AbsolutePath $Root
    $manifest=if ($PackagePath) { Test-PackageIntegrity $PackagePath } else { $null }
    if ($Operation -eq 'Prerequisites') { return Test-WindowsPrerequisites -JavaHome $JavaHome -Root $rootPath -ServiceSid $ServiceSid -WinSWExecutable $WinSWExecutable -WinSWSha256 $WinSWSha256 -PostgreSQLHome $PostgreSQLHome }
    if ($Operation -eq 'Verify') { if (-not $manifest) { throw 'Package required' }; return $manifest }
    if ($Operation -eq 'Health') { return Test-BackendHealth }
    if ($Operation -eq 'Inspect') { return [pscustomobject]@{ Root=$rootPath; Package=$manifest; Apply=$false } }
    if ($Version -and $Version -notmatch '^r-[0-9a-f]{40}$') { throw 'Invalid version' }
    if ($manifest -and $Version -and $Version -cne $manifest.version) { throw 'Version mismatch' }
    if (-not $Version -and $manifest) { $Version=$manifest.version }
    if (-not $Version) { throw 'Explicit version required' }
    if ($Operation -eq 'Stage') {
        if (-not $PackagePath) { throw 'Package required' }
        $packageRoot=Assert-AbsolutePath $PackagePath
        $sep=[IO.Path]::DirectorySeparatorChar
        if ($packageRoot -ieq $rootPath -or $packageRoot.StartsWith($rootPath+$sep,[StringComparison]::OrdinalIgnoreCase) -or $rootPath.StartsWith($packageRoot+$sep,[StringComparison]::OrdinalIgnoreCase)) { throw 'Package and deployment root must not contain one another' }
    }
    $volume=[IO.Path]::GetPathRoot($rootPath)
    $free=([IO.DriveInfo]::new($volume)).AvailableFreeSpace
    $additional=if ($Operation -in @('Stage','Space') -and $manifest) { (Get-ChildItem -LiteralPath $PackagePath -File -Recurse | Measure-Object Length -Sum).Sum + 1MB } else { 1MB }
    $space=Test-FreeSpacePolicy $free $additional $OperationalPeakBytes
    if ($Operation -eq 'Space') { return $space }
    if (-not $Apply) { return [pscustomobject]@{ DryRun=$true; Operation=$Operation; Version=$Version; Space=$space } }
    if ([string]::IsNullOrWhiteSpace($ApprovalId)) { throw 'Explicit approval ID required' }
    if (-not $PSCmdlet.ShouldProcess($rootPath,"$Operation $Version")) { return }
    if (-not $IsWindows) { throw 'Windows required for mutations' }
    $key=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($rootPath.ToLowerInvariant())))
    $mutex=[Threading.Mutex]::new($false,('Global\InfraMonitorDeployment-'+$key))
    $held=$false
    try {
    $held=$mutex.WaitOne(0)
    if (-not $held) { throw 'Another deployment operation is active' }
    foreach ($directory in @('config','logs','current','staging','releases')) { Assert-AbsolutePath (Join-Path $rootPath $directory) | Out-Null }
    $stage=Join-Path $rootPath "staging/$Version"
    $target=Join-Path $rootPath "releases/$Version"
    Assert-AbsolutePath $stage | Out-Null
    Assert-AbsolutePath $target | Out-Null
    if ($Operation -eq 'Stage') {
        if (-not $manifest) { throw 'Package required' }
        if (Test-Path -LiteralPath $stage) { throw 'Staging already exists' }
        $releases=Join-Path $rootPath 'releases'
        if ((Test-Path -LiteralPath $releases) -and @(Get-ChildItem -LiteralPath $releases -Directory).Count -ge 2) { throw 'Previous release must be reviewed manually; no automatic cleanup' }
        New-Item -ItemType Directory -Path $stage | Out-Null
        foreach ($item in Get-ChildItem -LiteralPath $PackagePath -Force) { Copy-Item -LiteralPath $item.FullName -Destination $stage -Recurse }
        Test-PackageIntegrity $stage | Out-Null
        return [pscustomobject]@{ Staged=$Version; Approval=$ApprovalId }
    }
    if ([string]::IsNullOrWhiteSpace($ServiceName) -or [string]::IsNullOrWhiteSpace($SiteName)) { throw 'Service and IIS site names required' }
    if ($ServiceName -notmatch '^[A-Za-z0-9_.-]{1,128}$' -or $SiteName -notmatch '^[A-Za-z0-9_. -]{1,100}$') { throw 'Literal service/site identities required' }
    Import-Module WebAdministration
    $site=Get-Website -Name $SiteName
    $physical=[Environment]::ExpandEnvironmentVariables([string]$site.physicalPath)
    if ([IO.Path]::GetFullPath($physical).TrimEnd('\') -ine [IO.Path]::GetFullPath((Join-Path $rootPath 'current/frontend')).TrimEnd('\')) { throw 'IIS site does not belong to this deployment root' }
    $https=@(Get-WebBinding -Name $SiteName -Protocol https)
    if (-not $https.Count -or @($https | Where-Object { -not $_.certificateHash -or ([string]$_.bindingInformation).Split(':')[-1] -match '^$|\*' }).Count) { throw 'Explicit HTTPS hostname/certificate binding required' }
    if (-not (Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name enabled).Value) { throw 'ARR proxy is not enabled' }
    $service=Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
    if (-not $service -or $service.StartName -in @('LocalSystem','NT AUTHORITY\SYSTEM')) { throw 'Dedicated existing service identity required' }
    $identity=[Security.Principal.NTAccount]::new([string]$service.StartName)
    if ($identity.Translate([Security.Principal.SecurityIdentifier]).Value -ne $ServiceSid) { throw 'Service SID mismatch' }
    $exe=[regex]::Match([string]$service.PathName,'^(?:"([^"]+)"|(\S+))')
    $actualExe=if ($exe.Groups[1].Success) { $exe.Groups[1].Value } else { $exe.Groups[2].Value }
    if ([IO.Path]::GetFullPath($actualExe) -ine [IO.Path]::GetFullPath($WinSWExecutable)) { throw 'Service executable does not match approved WinSW' }
    $proofPath=Assert-AbsolutePath $CompatibilityProof
    $proof=Get-Content -Raw -LiteralPath $proofPath | ConvertFrom-Json -AsHashtable
    $stateFile=Join-Path $rootPath 'config/deployment-state.json'
    $state=Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json -AsHashtable
    if (-not (Test-Path -LiteralPath $target)) {
        if ($Operation -eq 'Rollback') { throw 'Rollback target missing' }
        $package=Test-PackageIntegrity $stage
        Test-RollbackCompatibility $proof $state $package $Component $SchemaVersion
        New-Item -ItemType Directory -Path (Join-Path $rootPath 'releases') -Force | Out-Null
        $source=Join-Path $stage "releases/$Version"
        Assert-AbsolutePath $source | Out-Null
        Move-Item -LiteralPath $source -Destination $target
        Copy-Item -LiteralPath (Join-Path $stage 'package-manifest.json') -Destination (Join-Path $target 'release-manifest.json')
    }
    $release=Test-ReleaseIntegrity $target
    Test-RollbackCompatibility $proof $state $release $Component $SchemaVersion
    Import-Module WebAdministration
    $components=if ($Component -eq 'Both') { @('backend','frontend') } else { @($Component) }
    $current=Join-Path $rootPath 'current'
    Assert-AbsolutePath $current | Out-Null
    foreach ($part in $components) {
        $link=Join-Path $current $part; $previous=Join-Path $current "$part.previous"
        if (Test-Path -LiteralPath (Join-Path $current "$part.swap")) { throw 'Interrupted junction swap requires review' }
        if (Test-Path -LiteralPath $previous) {
            $old=Get-Item -LiteralPath $previous -Force
            if ($Operation -ne 'Rollback' -or $old.LinkType -ne 'Junction' -or @($old.Target).Count -ne 1 -or [IO.Path]::GetFullPath([string]@($old.Target)[0]) -ine [IO.Path]::GetFullPath((Join-Path $target $part))) { throw 'Previous link is not the approved rollback target' }
        }
        if (Test-Path -LiteralPath $link) {
            $item=Get-Item -LiteralPath $link -Force
            $expected=Join-Path $rootPath "releases/$($state[$part])/$part"
            if ($item.LinkType -ne 'Junction' -or @($item.Target).Count -ne 1 -or [IO.Path]::GetFullPath([string]@($item.Target)[0]) -ine [IO.Path]::GetFullPath($expected)) { throw 'Unexpected current link' }
        }
    }
    $logs=Join-Path $rootPath 'logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $evidence=Join-Path $logs 'deployment.ndjson'
    try {
        @{event='START';operation=$Operation;version=$Version;approval=$ApprovalId;utc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress | Add-Content -LiteralPath $evidence
        Stop-Website -Name $SiteName
        if ('backend' -in $components) {
            Stop-Service -Name $ServiceName -ErrorAction Stop
            (Get-Service -Name $ServiceName).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(45))
        }
        New-Item -ItemType Directory -Path $current -Force | Out-Null
        foreach ($part in $components) {
            Invoke-JunctionTransition $rootPath $Version $part ($Operation -eq 'Rollback')
        }
        if ('backend' -in $components) { Start-Service -Name $ServiceName }
        $healthy=$false
        for ($i=0;$i -lt 12;$i++) {
            try { Test-BackendHealth | Out-Null; $healthy=$true; break } catch { Start-Sleep -Seconds 5 }
        }
        if (-not $healthy) { throw 'Health failed; site remains stopped, manual recovery required' }
        foreach ($part in $components) { $state[$part]=$Version }
        $temporary=$stateFile+'.new'
        $state | ConvertTo-Json | Set-Content -LiteralPath $temporary
        Move-Item -LiteralPath $temporary -Destination $stateFile -Force
        Start-Website -Name $SiteName
        @{event='SUCCESS';version=$Version;utc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress | Add-Content -LiteralPath $evidence
    } catch {
        @{event='FAILED';operation=$Operation;errorType=$_.Exception.GetType().Name;utc=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json -Compress | Add-Content -LiteralPath $evidence
        throw 'Release operation failed; preserve stopped site and review evidence. No migration rollback was attempted.'
    }
    } finally {
        if ($held) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
Export-ModuleMember -Function Assert-AbsolutePath,Test-FreeSpacePolicy,Test-PackageIntegrity,Test-ReleaseIntegrity,Test-RollbackCompatibility,Test-HealthResult,ConvertFrom-HealthContent,Test-BackendHealth,Test-WindowsPrerequisites,Invoke-ReleaseOperation
