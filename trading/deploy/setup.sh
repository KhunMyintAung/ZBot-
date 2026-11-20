#!/usr/bin/env bash
# zBOT VPS setup — Ubuntu 22.04 / 24.04, run as root.
#   bash setup.sh [domain]
# Without a domain it uses <your-ip>.sslip.io so HTTPS still works.
# Safe to run again for updates: keeps .env, state/ (positions, journal) and data/.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # the uploaded trading/ folder
APP=/opt/zbot/trading
DOMAIN="${1:-}"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mXX  %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (or with sudo)."
[ -f "$SRC/src/index.js" ] || die "Run this from the uploaded trading/deploy folder."
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || warn "Tested on Ubuntu only (this is ${PRETTY_NAME:-unknown})."

say "0/8 Safety checks (nothing is installed yet)"
# Binance must answer from this server's country (US servers get HTTP 451).
for url in https://api.binance.com/api/v3/ping https://fapi.binance.com/fapi/v1/ping; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)
  if [ "$code" = "200" ]; then echo "OK  $url"
  elif [ "${FORCE:-}" = "1" ]; then warn "$url answered HTTP $code (FORCE=1, continuing)"
  else die "Binance answered HTTP $code from this server ($url). Binance blocks this server's country/region.
    Create the VPS in another region (not the US) and run setup again."; fi
done
# Don't take over a server that already serves websites on 80/443 (nginx, apache, docker...).
busy=$(ss -tlnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v caddy || true)
if [ -n "$busy" ] && [ "${FORCE:-}" != "1" ]; then
  echo "$busy"
  die "Ports 80/443 are already used by another program (above). This server already hosts something.
    Installing here would break it. Use a fresh VPS for zBOT."
fi

if [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 1500000 ] && ! swapon --show | grep -q .; then
  say "Small server: adding 1 GB swap so installs and Node don't run out of memory"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "1/8 System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg ufw rsync debian-keyring debian-archive-keyring apt-transport-https >/dev/null

say "2/8 Node.js 22"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node --version

say "3/8 Caddy (HTTPS web server)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
caddy version

say "4/8 (Binance already checked)"

say "5/8 Copy the bot to $APP"
id zbot >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/zbot --shell /usr/sbin/nologin zbot
mkdir -p "$APP"
rsync -a --delete \
  --exclude 'state/' --exclude 'data/' --exclude 'node_modules/' --exclude '.env' --exclude '.env.*' --exclude 'deploy/zbot-upload.tgz' \
  "$SRC/" "$APP/"
cp -n "$SRC/.env.example" "$APP/.env.example" 2>/dev/null || true
if [ ! -f "$APP/.env" ]; then
  if [ -f "$SRC/.env" ]; then cp "$SRC/.env" "$APP/.env"; else cp "$APP/.env.example" "$APP/.env"; fi
  # Never start a fresh server with real money by accident.
  sed -i 's/^MODE=.*/MODE=paper/; s/^LIVE_CONFIRM=.*/LIVE_CONFIRM=/' "$APP/.env"
  echo "Created $APP/.env (MODE=paper)."
else
  echo "Kept existing $APP/.env"
fi
sed -i 's/\r$//' "$APP/.env"   # Windows line endings
mkdir -p "$APP/state" "$APP/data"
chown -R zbot:zbot /opt/zbot
chmod 600 "$APP/.env"
echo "Installing Node packages (Claude SDK for the Telegram agent)..."
sudo -u zbot -H bash -c "cd $APP && npm ci --omit=dev --no-audit --no-fund --loglevel=error"

say "6/8 Web address"
if [ -z "$DOMAIN" ]; then
  IP=$(curl -4 -s --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')
  DOMAIN="${IP//./-}.sslip.io"
fi
DOMAIN=$(echo "$DOMAIN" | tr 'A-Z' 'a-z')
echo "Dashboard address: https://$DOMAIN"
if grep -q '^DASHBOARD_PUBLIC_HOST=' "$APP/.env"; then
  sed -i "s/^DASHBOARD_PUBLIC_HOST=.*/DASHBOARD_PUBLIC_HOST=$DOMAIN/" "$APP/.env"
else
  printf '\n# Public web address (set by deploy/setup.sh)\nDASHBOARD_PUBLIC_HOST=%s\n' "$DOMAIN" >> "$APP/.env"
fi

say "7/8 Dashboard password"
if ! grep -q '^DASHBOARD_PASSWORD_HASH=scrypt' "$APP/.env"; then
  echo "Choose the password you will type in the browser (8+ characters, not your Binance password)."
  until sudo -u zbot -H bash -c "cd $APP && node src/index.js set-password"; do echo "Try again."; done
else
  echo "Password already set. To change it: sudo -u zbot -H bash -c 'cd $APP && node src/index.js set-password' && systemctl restart zbot-dashboard"
fi

say "8/8 Services, HTTPS and firewall"
cat > /etc/systemd/system/zbot-dashboard.service <<EOF
[Unit]
Description=zBOT dashboard (starts the trading bot again after a reboot)
After=network-online.target
Wants=network-online.target

[Service]
User=zbot
WorkingDirectory=$APP
ExecStart=$(command -v node) src/index.js dashboard
Restart=always
RestartSec=5
# The bot runs as a child of the dashboard. Keep it alive when only the dashboard restarts.
KillMode=process
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/zbot-agent.service <<EOF
[Unit]
Description=zBOT Telegram AI agent
After=network-online.target
Wants=network-online.target

[Service]
User=zbot
WorkingDirectory=$APP
ExecStart=$(command -v node) src/index.js agent
Restart=always
RestartSec=10
# A bot started from Telegram must survive an agent restart.
KillMode=process
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8787
	header {
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}
EOF

systemctl daemon-reload
systemctl enable --now zbot-dashboard >/dev/null
systemctl restart zbot-dashboard
systemctl reload caddy || systemctl restart caddy
# Always on: without a bot token it just waits until one is added in the dashboard (API Keys).
systemctl enable zbot-agent >/dev/null 2>&1
systemctl restart zbot-agent
if grep -qE '^TELEGRAM_BOT_TOKEN=.+' "$APP/.env"; then
  AGENT_MSG="Telegram agent: running (journalctl -u zbot-agent -f)"
else
  AGENT_MSG="Telegram agent: waiting for a bot token (dashboard > API Keys)"
fi

ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
# Only switch the firewall on when nothing else listens publicly (it would cut off other services).
others=$(ss -tlnH 2>/dev/null | awk '{print $4}' | grep -vE '^(127\.|\[::1\]|\[::ffff:127)' | grep -vE ':(22|80|443)$' || true)
if ufw status | grep -q 'Status: active'; then echo "Firewall already on; added 22/80/443."
elif [ -z "$others" ]; then ufw --force enable >/dev/null; echo "Firewall on (22, 80, 443)."
else warn "Other programs listen on public ports, so the firewall was NOT switched on:"; echo "$others"; fi

sleep 3
systemctl is-active --quiet zbot-dashboard || { journalctl -u zbot-dashboard -n 30 --no-pager; die "Dashboard did not start (log above)."; }

cat <<EOF

=====================================================================
 zBOT is installed.

 Open:      https://$DOMAIN     (first visit can take ~30s for the HTTPS certificate)
 Login:     the password you just chose
 Then:      press "Start bot" in the Control panel.

 Mode is PAPER (fake money). For testnet/live, edit the settings file:
   nano $APP/.env      then: systemctl restart zbot-dashboard

 $AGENT_MSG

 Logs:      journalctl -u zbot-dashboard -f
            tail -f $APP/state/bot.log
 Binance API key IP whitelist: $(curl -4 -s --max-time 10 https://api.ipify.org || echo 'this server IP')
=====================================================================
EOF
