param(
  [string]$KeyPath = "C:\Users\jscha\tvt-game-app\TVT_WS_GAME_KEY.pem",
  [string]$Host = "ec2-44-251-123-224.us-west-2.compute.amazonaws.com",
  [string]$RemoteUser = "ubuntu",
  [string]$AppDir = "/home/ubuntu/tvt-game-app",
  [string]$NodeVersion = "20",
  [string]$RepoUrl = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $KeyPath)) {
  throw "Private key not found at: $KeyPath"
}

Write-Host "Hardening key permissions..."
icacls $KeyPath /inheritance:r | Out-Null
icacls $KeyPath /grant:r "$($env:USERNAME):(R)" | Out-Null

$remoteScript = @'
set -euo pipefail

APP_DIR="$1"
NODE_VERSION="$2"
REPO_URL="${3:-}"

echo "[1/8] Installing base packages..."
sudo apt-get update -y
sudo apt-get install -y curl git

echo "[2/8] Installing nvm/node if needed..."
if [ ! -d "$HOME/.nvm" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi

# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh"
nvm install "$NODE_VERSION"
nvm use "$NODE_VERSION"

echo "[3/8] Ensuring app directory exists..."
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

echo "[4/8] Installing dependencies..."
npm ci

echo "[5/8] Building app..."
npm run build

echo "[6/8] Creating systemd unit for websocket runtime..."
NODE_BIN="$(command -v node)"

sudo tee /etc/systemd/system/tvt-game-ws.service > /dev/null <<EOF
[Unit]
Description=TVT Game WebSocket/Next Runtime
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=$NODE_BIN server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "[7/8] Enabling and starting service..."
sudo systemctl daemon-reload
sudo systemctl enable tvt-game-ws
sudo systemctl restart tvt-game-ws

echo "[8/8] Service status:"
systemctl --no-pager --full status tvt-game-ws || true

echo "Done."
'@

$target = "$RemoteUser@$Host"
$sshArgs = @(
  "-i", $KeyPath,
  "-o", "StrictHostKeyChecking=accept-new",
  $target,
  "bash", "-s", "--", $AppDir, $NodeVersion, $RepoUrl
)

Write-Host "Connecting to $target and running one-shot bootstrap..."
$remoteScript | & ssh @sshArgs

Write-Host "Bootstrap complete."
Write-Host "Useful checks:"
Write-Host "  ssh -i \"$KeyPath\" $target 'systemctl status tvt-game-ws --no-pager'"
Write-Host "  ssh -i \"$KeyPath\" $target 'journalctl -u tvt-game-ws -n 200 --no-pager'"
