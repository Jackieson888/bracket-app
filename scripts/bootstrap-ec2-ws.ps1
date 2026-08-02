param(
  [string]$KeyPath = "C:\Users\jscha\tvt-game-app\TVT_WS_GAME_KEY.pem",
  [Alias("Host")]
  [string]$Ec2Host = "ec2-44-251-123-224.us-west-2.compute.amazonaws.com",
  [string]$RemoteUser = "ubuntu",
  [string]$AppDir = "/home/ubuntu/tvt-game-app",
  [string]$NodeVersion = "20",
  [string]$RepoUrl = "",
  [string]$Branch = "main",
  [string]$LocalEnvFile = ".\realtime-runtime\.env.production"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $KeyPath)) {
  throw "Private key not found at: $KeyPath"
}

if (-not (Test-Path -LiteralPath $LocalEnvFile)) {
  throw "Runtime env file not found at: $LocalEnvFile"
}

Write-Host "Hardening key permissions..."
icacls $KeyPath /inheritance:r | Out-Null
icacls $KeyPath /grant:r "$($env:USERNAME):(R)" | Out-Null

$resolvedEnvFile = (Resolve-Path -LiteralPath $LocalEnvFile).Path
$remoteEnvPath = "/tmp/tvt-game-ws.env"

Write-Host "Uploading runtime env file to $Ec2Host..."
& scp -i $KeyPath -o StrictHostKeyChecking=accept-new $resolvedEnvFile "$($RemoteUser)@$Ec2Host`:$remoteEnvPath"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to upload runtime env file to $Ec2Host"
}

$remoteScript = @'
set -euo pipefail

APP_DIR="$1"
NODE_VERSION="$2"
REPO_URL="${3:-}"
BRANCH="${4:-main}"
REMOTE_ENV_PATH="${5:-/tmp/tvt-game-ws.env}"
SYSTEMD_ENV_PATH="/etc/tvt-game-ws.env"

echo "[1/10] Installing base packages..."
sudo apt-get update -y
sudo apt-get install -y curl git

echo "[2/10] Installing nvm/node if needed..."
if [ ! -d "$HOME/.nvm" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi

# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh"
nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"

echo "[3/10] Ensuring app directory exists..."
if [ ! -d "$APP_DIR" ]; then
  if [ -n "$REPO_URL" ]; then
    git clone "$REPO_URL" "$APP_DIR"
  else
    echo "App directory does not exist and RepoUrl was not provided."
    echo "Either create $APP_DIR first or rerun with -RepoUrl <git_url>."
    exit 1
  fi
fi

cd "$APP_DIR"

if [ -d "$APP_DIR/.git" ]; then
  echo "[4/10] Updating repository checkout..."
  git config --global --add safe.directory "$APP_DIR"
  git fetch --all --prune
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
else
  echo "[4/10] Skipping git update because $APP_DIR is not a git checkout."
fi

echo "[5/10] Installing runtime environment file..."
if [ ! -f "$REMOTE_ENV_PATH" ]; then
  echo "Missing uploaded env file at $REMOTE_ENV_PATH"
  exit 1
fi
sudo install -m 600 -o root -g root "$REMOTE_ENV_PATH" "$SYSTEMD_ENV_PATH"
rm -f "$REMOTE_ENV_PATH"

echo "[6/10] Installing realtime runtime dependencies..."
cd "$APP_DIR/realtime-runtime"
npm ci

echo "[7/10] Realtime runtime ready (no Next.js build required)."

echo "[8/10] Creating systemd unit for websocket runtime..."
NODE_BIN="$(command -v node)"

sudo tee /etc/systemd/system/tvt-game-ws.service > /dev/null <<EOF
[Unit]
Description=TVT Game WebSocket Runtime
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR/realtime-runtime
EnvironmentFile=-$SYSTEMD_ENV_PATH
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=$NODE_BIN $APP_DIR/realtime-runtime/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "[9/10] Enabling and starting service..."
sudo systemctl daemon-reload
sudo systemctl enable tvt-game-ws
sudo systemctl restart tvt-game-ws

echo "[10/10] Validating service health..."
systemctl --no-pager --full status tvt-game-ws || true
for i in {1..10}; do
  if curl --fail --silent http://127.0.0.1:3000/health; then
    echo
    break
  fi

  if [ "$i" -eq 10 ]; then
    echo "Health check failed after retries."
    exit 1
  fi

  sleep 1
done

echo "Done."
'@

$target = "$RemoteUser@$Ec2Host"
$sshArgs = @(
  "-i", $KeyPath,
  "-o", "StrictHostKeyChecking=accept-new",
  $target,
  "bash", "-s", "--", $AppDir, $NodeVersion, $RepoUrl, $Branch, $remoteEnvPath
)

Write-Host "Connecting to $target and running one-shot bootstrap..."
$remoteScriptUnix = $remoteScript -replace "`r", ""
$remoteScriptUnix | & ssh @sshArgs
if ($LASTEXITCODE -ne 0) {
  throw "Remote bootstrap failed with exit code $LASTEXITCODE"
}

Write-Host "Bootstrap complete."
Write-Host "Useful checks:"
Write-Host "  ssh -i \"$KeyPath\" $target 'systemctl status tvt-game-ws --no-pager'"
Write-Host "  ssh -i \"$KeyPath\" $target 'journalctl -u tvt-game-ws -n 200 --no-pager'"
