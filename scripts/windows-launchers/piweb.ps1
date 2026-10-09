param(
    [Parameter(Position = 0)]
    [string]$Command,

    [switch]$Restart
)

$ErrorActionPreference = 'Stop'

if ($Restart) {
    $Command = 'restart'
}
if ($Command -and $Command -ne 'restart') {
    throw "Unknown command '$Command'. Use 'piweb' or 'piweb restart'."
}
$restartRequested = $Command -eq 'restart'

$logDir = Join-Path $env:LOCALAPPDATA 'PiWeb'
$null = New-Item -ItemType Directory -Path $logDir -Force
$launchLog = Join-Path $logDir 'piweb-launch.log'
$stdoutLog = Join-Path $logDir 'piweb-server.stdout.log'
$stderrLog = Join-Path $logDir 'piweb-server.stderr.log'

trap {
    $entry = "[{0}] {1}" -f (Get-Date -Format o), ($_ | Out-String)
    Add-Content -LiteralPath $launchLog -Value $entry -Encoding UTF8
    exit 1
}

$url = 'http://127.0.0.1:30141/'
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
$sourceRoot = Join-Path $env:USERPROFILE 'OneDrive\文档\daily\pi-web'
$cli = Join-Path $sourceRoot 'bin\pi-web.js'
$sdk = Join-Path $sourceRoot 'node_modules\@earendil-works\pi-coding-agent'
$nextBin = Join-Path $sourceRoot 'node_modules\next\dist\bin\next'

if (-not (Test-Path -LiteralPath $node)) {
    throw "Node.js was not found: $node"
}
if (-not (Test-Path -LiteralPath $nextBin)) { throw "Next.js production entry was not found: $nextBin" }
if (-not (Test-Path -LiteralPath $cli)) {
    throw "Pi Web was not found: $cli"
}
if (-not (Test-Path -LiteralPath (Join-Path $sdk 'package.json'))) {
    throw "Pi host SDK was not found: $sdk"
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot '.next\BUILD_ID'))) {
    throw "Pi Web production build was not found. Run npm run build in $sourceRoot"
}

function Test-PiWeb {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -match '<title>Pi Web</title>'
    } catch {
        return $false
    }
}

$listener = Get-NetTCPConnection -LocalPort 30141 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    if (-not (Test-PiWeb)) {
        throw 'Port 30141 is already used by another service.'
    }
    $server = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if (-not $server -or
        $server.ExecutablePath -ne $node -or
        $server.CommandLine -notmatch [regex]::Escape($nextBin)) {
        throw "Port 30141 runs a different Pi Web build. Stop that service before starting $cli"
    }
} elseif ($restartRequested) {
    throw 'Pi Web is not running, so it cannot be restarted.'
}

if ($restartRequested) {
    & taskkill.exe /PID $server.ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Pi Web restart could not stop the confirmed local server." }
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-NetTCPConnection -LocalPort 30141 -State Listen -ErrorAction SilentlyContinue)) {
            break
        }
    }
    if (Get-NetTCPConnection -LocalPort 30141 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Pi Web did not stop during restart.'
    }
}

if (-not (Get-NetTCPConnection -LocalPort 30141 -State Listen -ErrorAction SilentlyContinue)) {
    # Pi Web is not a standalone Pi host, so pi-subagents cannot discover the
    # host SDK from its argv. Point it at the SDK bundled with Pi Web.
    $env:PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = $sdk
    # Launch the same official Next production entry used by packaged pi-orb.
    # The intermediate Pi Web CLI spawner creates a visible child console.
    $env:PI_WEB_HOSTNAME = '127.0.0.1'
    $process = Start-Process -FilePath $node -ArgumentList ('"{0}" start -p 30141 -H 127.0.0.1' -f $nextBin) -WorkingDirectory $sourceRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        Start-Sleep -Milliseconds 250
        if (Test-PiWeb) {
            $ready = $true
            break
        }
        if ($process.HasExited) {
            break
        }
    }
    if (-not $ready) {
        throw "Pi Web did not become ready. See logs in $logDir"
    }
}

Start-Process $url

