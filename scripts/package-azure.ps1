param(
  [string]$OutputPath = (Join-Path $env:TEMP 'sicklecare-azure.zip')
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$zipPath = [System.IO.Path]::GetFullPath($OutputPath)
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stageRoot = Join-Path $tempRoot ("sicklecare-azure-" + [guid]::NewGuid().ToString('N'))
$excludedDirectories = @('node_modules', '.next', '.git', '.vercel', '.temp', 'coverage')

New-Item -ItemType Directory -Path $stageRoot | Out-Null

function Copy-SourceFiles {
  param(
    [string]$SourceDirectory,
    [string]$RelativeDirectory
  )

  foreach ($item in Get-ChildItem -LiteralPath $SourceDirectory -Force) {
    $relativePath = if ($RelativeDirectory) {
      Join-Path $RelativeDirectory $item.Name
    } else {
      $item.Name
    }

    if ($item.PSIsContainer) {
      if ($excludedDirectories -contains $item.Name -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        continue
      }

      Copy-SourceFiles -SourceDirectory $item.FullName -RelativeDirectory $relativePath
      continue
    }

    $isEnvironmentFile = $item.Name -like '.env*' -and $relativePath -ne '.env.example'
    $isDeviceSecret = $relativePath -match '^firmware[\\/]sicklecare_device[\\/]secrets\.h$'
    if ($isEnvironmentFile -or $isDeviceSecret -or $item.Name -like '*.tsbuildinfo') {
      continue
    }

    $destination = Join-Path $stageRoot $relativePath
    $destinationDirectory = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
    Copy-Item -LiteralPath $item.FullName -Destination $destination
  }
}

try {
  Copy-SourceFiles -SourceDirectory $repoRoot -RelativeDirectory ''

  $outputDirectory = Split-Path -Parent $zipPath
  if ($outputDirectory -and -not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
  }
  Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $zipPath -Force
  Write-Output "Azure source package created: $zipPath"
} finally {
  if ($stageRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
}
