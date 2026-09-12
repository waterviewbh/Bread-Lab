# build.ps1 — wrapper for gradlew that always tees output to a log file.
# Usage:
# .\build.ps1 → standard assembleDebug
# .\build.ps1 -Info → assembleDebug with --info logging
# .\build.ps1 :some-lib:someTask -Info → any task, optionally verbose

param(
    # First positional arg can be a specific task; defaults to app:assembleDebug
    [string]$Task = "app:assembleDebug",
    # Pass -Info to enable verbose Gradle logging
    [switch]$Info
)

# Base configuration for the log file path
$LogDir = $PSScriptRoot
$BaseName = "build-log"
$Extension = ".txt"

# Get current date in YYYY-MM-DD format
$DateString = Get-Date -Format "yyyy-MM-dd"

# Dynamic logic: adds an increment suffix only if a log for today already exists
$Counter = 1
do {
    if ($Counter -eq 1) {
        # First build of the day: build-log-2026-07-13.txt
        $FileName = "$BaseName-$DateString$Extension"
    } else {
        # Subsequent builds: build-log-2026-07-13-02.txt, -03.txt, etc.
        $PaddedCounter = "{0:D2}" -f $Counter
        $FileName = "$BaseName-$DateString-$PaddedCounter$Extension"
    }
    $LogFile = Join-Path -Path $LogDir -ChildPath $FileName
    $Counter++
} while (Test-Path -Path $LogFile)

$Arch = "-PreactNativeArchitectures=x86_64"
$Port = "-PreactNativeDevServerPort=8081"
$GradleArgs = @($Task, $Arch, $Port)

if ($Info) {
    $GradleArgs += "--info"
}

Write-Host "▶ Running: .\gradlew.bat $GradleArgs" -ForegroundColor Cyan
Write-Host "▶ Logging to: $LogFile`n" -ForegroundColor Cyan

# Tee-Object: output is visible in the terminal AND written to the log file simultaneously
.\gradlew.bat @GradleArgs 2>&1 | Tee-Object -FilePath $LogFile
