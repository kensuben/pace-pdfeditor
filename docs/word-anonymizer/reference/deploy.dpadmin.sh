#!/usr/bin/env bash
# Deploy 1 lệnh cho dpadmin trên VPS (không build, không sửa file env).
#
#   ./scripts/deploy.sh            backup → ghi mốc rollback → git pull → kéo latest → khởi động → health check
#   ./scripts/deploy.sh rollback   quay về commit đã chạy trước lần deploy cuối (tag sha-<7>)
#   ./scripts/deploy.sh status     commit đang chạy, origin/main, DB, mốc rollback
#
# CI chỉ đẩy :latest khi build + kiểm tra xanh → latest = commit main mới nhất đã qua kiểm tra.
# Image mang nhãn org.opencontainers.image.revision → script biết đang chạy bản nào.
# APP_TAG truyền qua dòng lệnh (shell env thắng --env-file) → không bao giờ sửa/đọc file env.
# Ứng dụng KHÔNG có migration tự động – không chạy php artisan migrate.
set -euo pipefail

PROJECT="${PROJECT:-dpadmin}"
COMPOSE_FILES="${COMPOSE_FILES:--f deploy/docker-compose.prod.yml --env-file deploy/.env.production}"
STATE_DIR="${STATE_DIR:-.deploy}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
APP_CONTAINER="${PROJECT}-app-1"
WEB_CONTAINER="${PROJECT}-web-1"

# shellcheck disable=SC2086
dc() { docker compose -p "$PROJECT" $COMPOSE_FILES "$@"; }

log() { echo "$(date '+%H:%M:%S') $*"; }
die() { echo "LỖI: $*" >&2; exit 1; }

# Container chưa tồn tại (lần đầu) → trả chuỗi rỗng, KHÔNG làm script dừng (set -e + pipefail).
running_revision() {
  { docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
      "$APP_CONTAINER" 2>/dev/null || true; } | cut -c1-7
}

db_ping() {
  if dc exec -T db sh -c 'mysqladmin ping -h 127.0.0.1 -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --silent' \
      < /dev/null > /dev/null 2>&1; then
    echo "OK"
  else
    echo "KHÔNG phản hồi"
  fi
}

wait_healthy() {
  local waited=0 web app
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    web="$(docker inspect --format '{{.State.Health.Status}}' "$WEB_CONTAINER" 2>/dev/null || echo missing)"
    app="$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null || echo false)"
    if [ "$web" = "healthy" ] && [ "$app" = "true" ]; then
      log "web healthy, app đang chạy sau ${waited}s"
      return 0
    fi
    [ "$web" = "unhealthy" ] && break
    sleep 5
    waited=$((waited + 5))
  done
  log "chưa healthy (web: ${web:-?}, app running: ${app:-?}). 80 dòng log cuối:"
  dc logs app web --tail 80 < /dev/null || true
  return 1
}

# Khởi động trên tag cho trước ("" = latest) và chờ health check.
start_tag() {
  local tag="$1"
  # set -e không áp dụng trong hàm được gọi từ `if !` → phải `|| return 1`.
  APP_TAG="$tag" dc pull app web < /dev/null || { log "không kéo được image (${tag:-latest})"; return 1; }
  APP_TAG="$tag" dc up -d < /dev/null || return 1
  wait_healthy
}

show_status() {
  local rev
  rev="$(running_revision)"
  git fetch -q origin main < /dev/null 2>/dev/null || true
  echo "Commit đang chạy : ${rev:-không rõ (container chưa chạy hoặc image chưa có nhãn)}"
  echo "origin/main      : $(git rev-parse --short=7 origin/main 2>/dev/null || echo '?') (lệch → CI commit mới chưa xong hoặc đỏ)"
  echo "DB               : $(db_ping)"
  if [ -f "$STATE_DIR/previous" ]; then
    echo "Mốc rollback     : $(cat "$STATE_DIR/previous")"
  fi
  return 0
}

cmd_deploy() {
  [ -z "$(git status --porcelain --untracked-files=no)" ] ||
    die "thư mục có file đã sửa (git status). Xử lý xong rồi chạy lại – script không tự xoá thay đổi."

  log "1/5 Backup DB + file"
  ./scripts/backup.sh

  log "2/5 Ghi mốc rollback"
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  local prev older=""
  prev="$(running_revision)"
  if [ -f "$STATE_DIR/previous" ]; then older="$(cat "$STATE_DIR/previous")"; fi
  if [ -n "$prev" ]; then
    echo "$prev" > "$STATE_DIR/previous"
    log "bản đang chạy: $prev"
  else
    log "không đọc được commit đang chạy – rollback sẽ cần nhập tay APP_TAG"
  fi

  log "3/5 Cập nhật compose/script"
  git pull --ff-only < /dev/null

  log "4/5 Kéo latest và khởi động"
  if ! start_tag ""; then
    die "bản mới không lên. Chạy: ./scripts/deploy.sh rollback"
  fi

  local now
  now="$(running_revision)"
  if [ -n "$now" ] && [ "$now" = "$prev" ] && [ -n "$older" ]; then
    echo "$older" > "$STATE_DIR/previous"
    log "latest vẫn là $now (không có bản mới) – giữ mốc rollback $older"
  fi
  echo "$(date -Is) deploy ${prev:-?} -> ${now:-?}" >> "$STATE_DIR/history.log"

  log "5/5 Kiểm tra"
  show_status
  log "Deploy xong. Kiểm tay: đăng nhập, danh sách phiếu, mở 1 phiếu."
}

cmd_rollback() {
  [ -f "$STATE_DIR/previous" ] ||
    die "chưa có $STATE_DIR/previous. Rollback tay: APP_TAG=sha-<7 ký tự> docker compose -p $PROJECT $COMPOSE_FILES up -d"
  local prev now
  prev="$(cat "$STATE_DIR/previous")"
  [[ "$prev" =~ ^[0-9a-f]{7}$ ]] || die "$STATE_DIR/previous không hợp lệ: $prev"
  now="$(running_revision)"
  log "Quay về sha-$prev (đang chạy: ${now:-?})"
  log "Lưu ý: dữ liệu do bản mới ghi vẫn giữ; dữ liệu hỏng → khôi phục backup theo runbook Sprint 1 mục 5.3."
  start_tag "sha-$prev" || die "bản sha-$prev cũng không lên – xem log ở trên."
  echo "$(date -Is) rollback ${now:-?} -> $prev" >> "$STATE_DIR/history.log"
  log "Đã quay về sha-$prev. Lần ./scripts/deploy.sh sau sẽ lên lại latest."
  show_status
}

case "${1:-deploy}" in
  deploy) cmd_deploy ;;
  rollback) cmd_rollback ;;
  status) show_status ;;
  *) die "lệnh không hợp lệ: $1 (deploy | rollback | status)" ;;
esac

