#!/usr/bin/env sh
# Возврат стенда к предыдущему рабочему состоянию.
#
# Реестр багов 09.07.2026, PLAUSIBLE «нет отката: образы только :latest,
# деплой затирает единственный known-good». Выкат (.github/workflows/ci.yml,
# шаг «Deploy over VPS») перед каждой сборкой помечает работающие образы
# меткой :previous и записывает слепок кода в deploy/.last-known-good.
# Этот скрипт разворачивает то и другое обратно.
#
# Запуск на сервере:  sh /home/aemr/dash/deploy/rollback.sh
#
# Что делает и чего НЕ делает:
#   • возвращает образы предыдущей сборки и поднимает их БЕЗ пересборки —
#     иначе откат собрал бы тот же сломанный код заново;
#   • возвращает рабочее дерево на запомненный слепок кода, чтобы следующий
#     выкат не сравнивал новое со сломанным;
#   • базу данных НЕ трогает: она живёт в томе server_data и переживает и
#     выкат, и откат. Испорченные данные откатом не лечатся — для них снимки
#     (services/snapshot-retention.ts).
set -eu

DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(dirname -- "$DEPLOY_DIR")
MARK="$DEPLOY_DIR/.last-known-good"

missing=0
for img in aemr-server aemr-web; do
  if ! docker image inspect "$img:previous" >/dev/null 2>&1; then
    echo "Образа $img:previous нет — откатываться не к чему." >&2
    missing=1
  fi
done
if [ "$missing" -eq 1 ]; then
  echo "Первый выкат ещё не создал точку возврата; сначала должен пройти хотя бы один." >&2
  exit 1
fi

echo "=== возвращаем образы предыдущей сборки ==="
for img in aemr-server aemr-web; do
  # Текущие образы не выбрасываем: помечаем :failed, чтобы было что смотреть
  # при разборе — что именно выкатили и почему оно не взлетело.
  if docker image inspect "$img:latest" >/dev/null 2>&1; then
    docker tag "$img:latest" "$img:failed"
  fi
  docker tag "$img:previous" "$img:latest"
done

if [ -f "$MARK" ]; then
  sha=$(cat "$MARK")
  echo "=== возвращаем код на слепок $sha ==="
  git -C "$REPO_DIR" reset --hard "$sha"
else
  echo "Слепок кода не записан ($MARK) — вернулись только образы." >&2
fi

echo "=== поднимаем без пересборки ==="
cd "$DEPLOY_DIR"
docker compose --env-file .env.production up -d --no-build

sleep 8
docker compose --env-file .env.production exec -T server \
  curl -fsS -m 15 http://127.0.0.1:3000/api/health && echo " — откат прошёл"
