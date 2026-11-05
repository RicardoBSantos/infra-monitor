#Requires -Version 7.2
[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param(
 [ValidateSet('Inspect','Prerequisites','Verify','Space','Stage','Health','Switch','Rollback')][string]$Operation='Inspect',
 [Parameter(Mandatory)][string]$Root,[string]$PackagePath,[string]$Version,
 [ValidateSet('Both','backend','frontend')][string]$Component='Both',
 [string]$CompatibilityProof,[int]$SchemaVersion=0,[string]$ServiceName,[string]$SiteName,
 [string]$JavaHome,[string]$ServiceSid,[string]$WinSWExecutable,[string]$WinSWSha256,[string]$PostgreSQLHome,[UInt64]$OperationalPeakBytes=3GB,
 [switch]$Apply,[string]$ApprovalId
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'ReleaseTools.psm1') -Force
Invoke-ReleaseOperation @PSBoundParameters
