#!/usr/bin/env bash
# Owner runs this on the server to save the Anthropic API key in .env (the key never goes through chat).
#   ssh -t root@SERVER bash /opt/zbot/trading/deploy/set-api-key.sh
set -u
ENV=/opt/zbot/trading/.env

echo
echo "Paste the API key from console.anthropic.com (starts with sk-ant-api) and press Enter."
read -r -p "API key: " K
K=$(printf '%s' "$K" | tr -d '[:space:]')
clear

case "$K" in
  sk-ant-api*) ;;
  sk-ant-*) echo "WRONG: this is not an API key (${K:0:11}...). Use console.anthropic.com -> API Keys -> Create Key. Nothing saved."; exit 1 ;;
  *) echo "WRONG: the key must start with sk-ant-api (got ${#K} characters). Nothing saved."; exit 1 ;;
esac

echo "Checking the key with Anthropic..."
CODE=$(curl -s -o /dev/null -w '%{http_code}' https://api.anthropic.com/v1/models \
  -H "x-api-key: $K" -H "anthropic-version: 2023-06-01")
if [ "$CODE" != "200" ]; then
  echo "WRONG: Anthropic did not accept this key (HTTP $CODE). Check it, or add credit in Billing. Nothing saved."
  exit 1
fi

sed -i '/^ANTHROPIC_API_KEY=/d' "$ENV"
printf 'ANTHROPIC_API_KEY=%s\n' "$K" >> "$ENV"
systemctl restart zbot-agent
echo "DONE: key saved (${#K} characters) and the Telegram agent restarted with AI on."
