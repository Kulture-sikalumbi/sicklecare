[CmdletBinding()]
param(
  [string]$Port
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$firmwareDir = Join-Path $projectRoot 'firmware/sicklecare_device'
$secretsPath = Join-Path $firmwareDir 'secrets.h'
$provisionPath = Join-Path $firmwareDir 'provision_device.sql'
$fqbn = 'esp32:esp32:esp32'

function Get-QuotedDefine {
  param([string]$Content, [string]$Name)
  $pattern = '(?m)^\s*#define\s+' + [regex]::Escape($Name) + '\s+"((?:\\.|[^"\\])*)"'
  $match = [regex]::Match($Content, $pattern)
  if (-not $match.Success) { throw "Missing #define $Name in local secrets.h." }
  return $match.Groups[1].Value.Replace('\"', '"').Replace('\\', '\')
}

function ConvertTo-CStringContents {
  param([string]$Value)
  if ($Value.Contains("`r") -or $Value.Contains("`n")) {
    throw 'Wi-Fi values cannot contain line breaks.'
  }
  return $Value.Replace('\', '\\').Replace('"', '\"')
}

function Set-QuotedDefine {
  param([string]$Content, [string]$Name, [string]$Value)
  $escaped = ConvertTo-CStringContents $Value
  $pattern = '^\s*#define\s+' + [regex]::Escape($Name) + '\s+'
  $lines = [System.Collections.Generic.List[string]]::new()
  $matches = 0
  foreach ($line in ($Content -split "`r?`n")) {
    if ($line -match $pattern) {
      $lines.Add('#define ' + $Name + ' "' + $escaped + '"')
      $matches++
    } else {
      $lines.Add($line)
    }
  }
  if ($matches -ne 1) { throw "Expected exactly one #define $Name in local secrets.h." }
  return ($lines -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine
}

foreach ($command in @('arduino-cli', 'supabase')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "$command is required but was not found on PATH."
  }
}
if (-not (Test-Path -LiteralPath $secretsPath)) {
  throw 'Local firmware/sicklecare_device/secrets.h is missing.'
}

if (-not $Port) {
  $Port = Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match 'CP210|Silicon Labs' } |
    Select-Object -First 1 -ExpandProperty DeviceID
}
if (-not $Port) { throw 'ESP32 serial port not found. Reconnect its USB cable or pass -Port COMx.' }

$secrets = [System.IO.File]::ReadAllText($secretsPath)
$provisionSql = [System.IO.File]::ReadAllText($provisionPath)
$deviceId = Get-QuotedDefine $secrets 'DEVICE_ID'
$deviceToken = Get-QuotedDefine $secrets 'DEVICE_TOKEN'
$sqlDeviceId = [regex]::Match($provisionSql, "(?s)insert into public\.devices.*?values\s*\(\s*'([0-9a-fA-F-]{36})'::uuid").Groups[1].Value
$sqlTokenHash = [regex]::Match($provisionSql, "select id, '([0-9a-f]{64})', null from provisioned_device").Groups[1].Value
if (-not $sqlDeviceId -or $deviceId -ne $sqlDeviceId) { throw 'Device ID in secrets.h does not match the provisioning SQL.' }
if (-not $sqlTokenHash) { throw 'The provisioning SQL does not contain the expected token hash.' }
$sha = [System.Security.Cryptography.SHA256]::Create()
try {
  $actualTokenHash = ([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($deviceToken)))).Replace('-', '').ToLowerInvariant()
} finally {
  $sha.Dispose()
}
if ($actualTokenHash -ne $sqlTokenHash) { throw 'Device token in secrets.h does not match the provisioning SQL hash.' }
if (([regex]::Matches($provisionSql, 'REPLACE-WITH-PATIENT-AUTH-USER-UUID')).Count -ne 2) {
  throw 'Provisioning SQL must contain exactly two patient UUID placeholders.'
}

$wifiSsid = Read-Host '2.4 GHz Wi-Fi network name (SSID)'
if ([string]::IsNullOrWhiteSpace($wifiSsid)) { throw 'Wi-Fi SSID cannot be empty.' }
$securePassword = Read-Host 'Wi-Fi password (input is hidden)' -AsSecureString
if ($securePassword.Length -eq 0) { throw 'Wi-Fi password cannot be empty.' }
$wifiPassword = [System.Net.NetworkCredential]::new('', $securePassword).Password
$patientInput = Read-Host 'Patient Supabase Auth user UUID'
$patientGuid = [Guid]::Empty
if (-not [Guid]::TryParse($patientInput, [ref]$patientGuid)) { throw 'Enter the patient account UUID from Supabase Authentication > Users.' }
$patientId = $patientGuid.ToString()

$userSql = "select count(*) as user_count from auth.users where id = '$patientId'::uuid"
$userCheck = (& supabase db query --remote --read-only $userSql 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Could not verify the patient account in Supabase. Check that the Supabase CLI is linked and signed in.' }
$userCountMatch = [regex]::Match($userCheck, '"user_count"\s*:\s*(\d+)')
if (-not $userCountMatch.Success -or [int]$userCountMatch.Groups[1].Value -lt 1) {
  throw 'That UUID is not present in Supabase Auth. Check the patient UUID and try again.'
}

$secrets = Set-QuotedDefine $secrets 'WIFI_SSID' $wifiSsid
$secrets = Set-QuotedDefine $secrets 'WIFI_PASSWORD' $wifiPassword
[System.IO.File]::WriteAllText($secretsPath, $secrets, [System.Text.UTF8Encoding]::new($false))
Write-Host 'Local Wi-Fi settings saved in the ignored secrets.h file.'

$temporarySql = Join-Path $env:TEMP ('sicklecare-provision-' + [Guid]::NewGuid().ToString('N') + '.sql')
$buildPath = Join-Path $env:TEMP ('sicklecare-esp32-build-' + [Guid]::NewGuid().ToString('N'))
try {
  $readySql = $provisionSql.Replace('REPLACE-WITH-PATIENT-AUTH-USER-UUID', $patientId)
  [System.IO.File]::WriteAllText($temporarySql, $readySql, [System.Text.UTF8Encoding]::new($false))
  & supabase db query --remote --file $temporarySql --yes | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Supabase device provisioning failed; the device has not been flashed.' }
  Write-Host 'Supabase device record provisioned.'

  & arduino-cli compile --quiet --fqbn $fqbn --output-dir $buildPath $firmwareDir | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Firmware compilation failed; review the Arduino CLI error above.' }
  Write-Host 'Firmware compiled for the classic ESP32.'

  & arduino-cli upload --fqbn $fqbn --port $Port --input-dir $buildPath --verify
  if ($LASTEXITCODE -ne 0) { throw "Upload failed on $Port. If the board times out, hold BOOT while upload starts, then release it." }
  Write-Host "Firmware uploaded to $Port. Keep a finger still on the pulse sensor and wait at least 60 seconds for the first upload."
  Write-Host "Serial monitor: arduino-cli monitor --port $Port --config 115200"
} finally {
  Remove-Item -LiteralPath $temporarySql -Force -ErrorAction SilentlyContinue
  $wifiPassword = $null
  $securePassword.Dispose()
}
