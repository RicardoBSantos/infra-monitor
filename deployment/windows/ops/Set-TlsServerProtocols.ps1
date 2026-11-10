# D-01: disables TLS 1.0/1.1 (and SSL 2/3) on the SERVER side of SCHANNEL, keeping TLS 1.2/1.3.
# Inspect is the default and changes nothing. Apply and Rollback change machine-wide SCHANNEL
# settings and only take effect after a Windows restart, which this script never performs.
# Client-side keys are left untouched, so outbound connections (updates, agents) are unaffected.
[CmdletBinding()]
param(
    [ValidateSet('Inspect','Apply','Rollback')][string]$Mode='Inspect',
    [string]$BackupDirectory='C:\InfraMonitor\backups\schannel',
    [string]$BackupFile
)
$ErrorActionPreference='Stop'
$base='HKLM:\SYSTEM\CurrentControlSet\Control\SecurityProviders\SCHANNEL\Protocols'
$disable='SSL 2.0','SSL 3.0','TLS 1.0','TLS 1.1'
$keep='TLS 1.2','TLS 1.3'

function Get-ProtocolState {
    foreach ($p in $disable + $keep) {
        $k="$base\$p\Server"
        $v=if (Test-Path $k) { Get-ItemProperty $k } else { $null }
        [pscustomobject]@{ Protocol=$p; KeyExists=[bool]$v; Enabled=$v.Enabled; DisabledByDefault=$v.DisabledByDefault }
    }
}

function Assert-Admin {
    if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as administrator.' }
}

switch ($Mode) {
    'Inspect' {
        Get-ProtocolState | Format-Table -AutoSize
        'No key = Windows default (on this build TLS 1.0/1.1 were observed as accepted by IIS).'
    }
    'Apply' {
        Assert-Admin
        New-Item -ItemType Directory -Force -Path $BackupDirectory | Out-Null
        $file=Join-Path $BackupDirectory ("schannel-protocols-{0:yyyyMMdd-HHmmss}.reg" -f (Get-Date))
        & reg.exe export 'HKLM\SYSTEM\CurrentControlSet\Control\SecurityProviders\SCHANNEL\Protocols' $file /y | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Registry backup failed; nothing was changed.' }
        $created=@(foreach ($p in $disable + $keep) { if (-not (Test-Path "$base\$p\Server")) { $p } })
        Set-Content -LiteralPath "$file.created.txt" -Value $created -Encoding utf8
        foreach ($p in $disable) {
            New-Item -Path "$base\$p\Server" -Force | Out-Null
            New-ItemProperty -Path "$base\$p\Server" -Name Enabled -PropertyType DWord -Value 0 -Force | Out-Null
            New-ItemProperty -Path "$base\$p\Server" -Name DisabledByDefault -PropertyType DWord -Value 1 -Force | Out-Null
        }
        foreach ($p in $keep) {
            New-Item -Path "$base\$p\Server" -Force | Out-Null
            New-ItemProperty -Path "$base\$p\Server" -Name Enabled -PropertyType DWord -Value 1 -Force | Out-Null
            New-ItemProperty -Path "$base\$p\Server" -Name DisabledByDefault -PropertyType DWord -Value 0 -Force | Out-Null
        }
        Get-ProtocolState | Format-Table -AutoSize
        "Backup: $file"
        'APPLIED. Takes effect only after a Windows restart (not performed by this script).'
    }
    'Rollback' {
        Assert-Admin
        if (-not $BackupFile -or -not (Test-Path -LiteralPath $BackupFile)) { throw 'Pass -BackupFile with the .reg exported by Apply.' }
        $created=if (Test-Path -LiteralPath "$BackupFile.created.txt") { Get-Content -LiteralPath "$BackupFile.created.txt" } else { @() }
        # Keys that did not exist before Apply are removed so Windows defaults apply again.
        foreach ($p in $created) { if ($p -and (Test-Path "$base\$p\Server")) { Remove-Item -Path "$base\$p\Server" -Recurse -Force } }
        & reg.exe import $BackupFile | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Registry import failed.' }
        Get-ProtocolState | Format-Table -AutoSize
        'ROLLED BACK. Takes effect only after a Windows restart (not performed by this script).'
    }
}
