#!/usr/bin/env bash
set -euo pipefail

# Сертификат TURNS (coturn :5349) из хранилища Caddy (2026-10-11, домен).
#
# Caddy выпускает и продлевает Let's Encrypt на TURN_DOMAIN (сайт в
# Caddyfile.prod), но coturn напрямую из тома caddy_data читать не может:
# Caddy хранит ключ 0600 root, а coturn работает под nobody (uid 65534).
# Скрипт копирует пару в turn-certs/ с владельцем 65534 и просит coturn
# перечитать сертификаты (SIGUSR2). Ничего не меняется — выходит молча.
# Запускается таймером scripts/systemd/matis-turn-cert-sync.timer.
#
# ВАЖНО: turn_cert.pem/turn_key.pem смонтированы в coturn ПОФАЙЛОВО
# (docker-compose.yml). Подмена через mv создаёт новый inode, а контейнер
# продолжает видеть старый — поэтому пишем содержимое в существующий файл.

cd "$(dirname "$0")/.."

TURN_DOMAIN=$(grep -E '^TURN_DOMAIN=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')
[[ -n "$TURN_DOMAIN" ]] || { echo "TURN_DOMAIN не задан в .env" >&2; exit 1; }

DATA=$(docker volume inspect znat_caddy_data --format '{{ .Mountpoint }}')
# Обычно acme-v02.api.letsencrypt.org-directory; если Caddy ушёл на запасной
# issuer (ZeroSSL) — берём самый свежий из найденных.
CRT=$(ls -t "$DATA"/caddy/certificates/*/"$TURN_DOMAIN"/"$TURN_DOMAIN".crt 2>/dev/null | head -1 || true)
[[ -n "$CRT" ]] || { echo "Сертификат $TURN_DOMAIN в хранилище Caddy ещё не выпущен" >&2; exit 1; }
KEY="${CRT%.crt}.key"

install -d -m 755 turn-certs
if cmp -s "$CRT" turn-certs/turn_cert.pem && cmp -s "$KEY" turn-certs/turn_key.pem; then
  exit 0
fi

# Проверка до записи: битая пара уронила бы TLS-листенер coturn.
openssl x509 -in "$CRT" -noout -checkend 0 >/dev/null
[[ "$(openssl x509 -in "$CRT" -noout -pubkey)" == "$(openssl pkey -in "$KEY" -pubout)" ]] \
  || { echo "Ключ не подходит к сертификату" >&2; exit 1; }

for f in turn_cert.pem turn_key.pem; do
  [[ -f "turn-certs/$f" ]] || install -m 600 -o 65534 -g 65534 /dev/null "turn-certs/$f"
done
cat "$CRT" > turn-certs/turn_cert.pem
cat "$KEY" > turn-certs/turn_key.pem
chown 65534:65534 turn-certs/turn_cert.pem turn-certs/turn_key.pem
chmod 644 turn-certs/turn_cert.pem
chmod 600 turn-certs/turn_key.pem
echo "turn-certs обновлены: $(openssl x509 -in turn-certs/turn_cert.pem -noout -subject -enddate | tr '\n' ' ')"

# coturn перечитывает сертификаты по SIGUSR2 без обрыва идущих сессий.
COTURN=$(docker ps -q --filter label=com.docker.compose.service=coturn | head -1)
if [[ -n "$COTURN" ]]; then
  docker kill --signal USR2 "$COTURN" >/dev/null
  echo "coturn: отправлен SIGUSR2"
fi
