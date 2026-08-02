param(
  [string]$KeyPath = "C:\Users\jscha\tvt-game-app\TVT_WS_GAME_KEY.pem",
  [Alias("Host")]
  [string]$Ec2Host = "ec2-44-251-123-224.us-west-2.compute.amazonaws.com",
  [string]$RemoteUser = "ubuntu",
  [string]$ServerName = "ec2-44-251-123-224.us-west-2.compute.amazonaws.com",
  [int]$AppPort = 3000,
  [switch]$EnableTls,
  [string]$CertEmail = ""
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $KeyPath)) {
  throw "Private key not found at: $KeyPath"
}

if ($EnableTls -and [string]::IsNullOrWhiteSpace($CertEmail)) {
  throw "When -EnableTls is set, provide -CertEmail for certbot registration."
}

Write-Host "Hardening key permissions..."
icacls $KeyPath /inheritance:r | Out-Null
icacls $KeyPath /grant:r "$($env:USERNAME):(R)" | Out-Null

$enableTlsFlag = if ($EnableTls) { "1" } else { "0" }

$remoteScript = @'
set -euo pipefail

SERVER_NAME="$1"
APP_PORT="$2"
ENABLE_TLS="$3"
CERT_EMAIL="${4:-}"

echo "[1/6] Installing nginx and snapd..."
sudo apt-get update -y
sudo apt-get install -y nginx snapd

echo "[2/6] Writing nginx reverse-proxy config..."
sudo tee /etc/nginx/sites-available/tvt-game > /dev/null <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name ${SERVER_NAME};

  location /ws {
    proxy_pass http://127.0.0.1:${APP_PORT}/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 3600;
  }

  location / {
    proxy_pass http://127.0.0.1:${APP_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
EOF

echo "[3/6] Enabling site and restarting nginx..."
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sfn /etc/nginx/sites-available/tvt-game /etc/nginx/sites-enabled/tvt-game
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

if [ "$ENABLE_TLS" = "1" ]; then
  echo "[4/6] Installing certbot and requesting TLS cert..."
  sudo snap install core
  sudo snap refresh core
  sudo snap install --classic certbot
  sudo ln -sfn /snap/bin/certbot /usr/bin/certbot

  sudo certbot --nginx \
    -d "$SERVER_NAME" \
    -m "$CERT_EMAIL" \
    --agree-tos \
    --no-eff-email \
    --non-interactive \
    --redirect

  echo "[5/6] Verifying TLS config and reloading nginx..."
  sudo nginx -t
  sudo systemctl reload nginx
else
  echo "[4/6] TLS skipped (-EnableTls not set)."
  echo "[5/6] nginx is running over HTTP only."
fi

echo "[6/6] Nginx status and test endpoint:"
systemctl --no-pager --full status nginx || true
curl -I "http://127.0.0.1/" || true

echo "Done."
'@

$target = "$RemoteUser@$Ec2Host"
$sshArgs = @(
  "-i", $KeyPath,
  "-o", "StrictHostKeyChecking=accept-new",
  $target,
  "bash", "-s", "--", $ServerName, "$AppPort", $enableTlsFlag, $CertEmail
)

Write-Host "Connecting to $target and configuring nginx proxy..."
$remoteScriptUnix = $remoteScript -replace "`r", ""
$remoteScriptUnix | & ssh @sshArgs
if ($LASTEXITCODE -ne 0) {
  throw "Remote bootstrap failed with exit code $LASTEXITCODE"
}

Write-Host "Proxy bootstrap complete."
if ($EnableTls) {
  Write-Host "TLS is enabled. Use wss://$ServerName/ws"
} else {
  Write-Host "TLS was skipped. Use ws://$ServerName/ws"
}
