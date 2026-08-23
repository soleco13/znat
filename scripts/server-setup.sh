#!/usr/bin/env bash
set -euo pipefail

# Однократная настройка чистого Ubuntu 24.04 LTS сервера (Э0.8 ТЗ).
# Запускать от root по SSH ДО того, как отключён пароль. Порт SSH и ключ
# передаются параметрами — не хардкодить их в этом файле.
#
# Использование:
#   ./scripts/server-setup.sh <новый_SSH_порт> </путь/к/публичному_ключу.pub>
#
# Firewall открывает только 80/443/SSH — LiveKit/TURN/coturn добавятся
# отдельно на Э2 (§10.5 ТЗ), не здесь.

SSH_PORT="${1:?Укажи новый SSH-порт, например: ./server-setup.sh 2222 ~/.ssh/id_ed25519.pub}"
PUBKEY_PATH="${2:?Укажи путь к публичному SSH-ключу}"

if [[ ! -f "$PUBKEY_PATH" ]]; then
  echo "Файл ключа не найден: $PUBKEY_PATH" >&2
  exit 1
fi

echo "==> Обновление системы"
apt-get update -y
apt-get upgrade -y

echo "==> Docker Engine + docker compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Пользователь deploy (без root, но с доступом к docker)"
if ! id deploy >/dev/null 2>&1; then
  useradd -m -s /bin/bash -G docker deploy
fi
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -m 600 -o deploy -g deploy "$PUBKEY_PATH" /home/deploy/.ssh/authorized_keys

echo "==> SSH: только по ключу, нестандартный порт, root запрещён"
SSHD_CONFIG=/etc/ssh/sshd_config.d/99-school-platform.conf
cat > "$SSHD_CONFIG" <<EOF
Port ${SSH_PORT}
PasswordAuthentication no
PermitRootLogin no
AllowUsers deploy
EOF
systemctl restart ssh

echo "==> ufw: только 80, 443 и SSH-порт наружу"
ufw default deny incoming
ufw default allow outgoing
ufw allow "${SSH_PORT}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> Готово."
echo "Дальше:"
echo "  1. Проверить вход по SSH на новом порту в ОТДЕЛЬНОЙ сессии, не закрывая эту."
echo "  2. Только после успешной проверки закрыть текущую root-сессию."
echo "  3. git clone репозиторий в /home/deploy/school-platform, создать .env из .env.example."
echo "  4. ./deploy.sh для первого запуска."
