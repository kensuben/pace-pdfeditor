#!/usr/bin/env bash
# Sao lưu dữ liệu volume store.json cho PACE PDF Editor
# Giữ tối đa BACKUP_KEEP bản sao lưu gần nhất trong thư mục backups/
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

DATA_VOLUME="${DATA_VOLUME:-pace-pdfeditor_paperly_data}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"

log() { echo "$(date '+%H:%M:%S') $*"; }

if ! docker volume inspect "$DATA_VOLUME" > /dev/null 2>&1; then
  log "CẢNH BÁO: Volume '$DATA_VOLUME' chưa tồn tại trên hệ thống. Bỏ qua sao lưu."
  exit 0
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
TARGET_DIR="$(cd "$BACKUP_DIR" && pwd)"

TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
ARCHIVE_NAME="pace-pdf_${DATA_VOLUME}_${TIMESTAMP}.tar.gz"

log "Bắt đầu sao lưu volume '$DATA_VOLUME' vào '$BACKUP_DIR/$ARCHIVE_NAME'..."

docker run --rm \
  -v "${DATA_VOLUME}:/data:ro" \
  -v "${TARGET_DIR}:/backup" \
  alpine:3.21.3 \
  tar czf "/backup/${ARCHIVE_NAME}" -C /data .

log "Sao lưu thành công ($ARCHIVE_NAME)."

# Xoá các bản sao lưu cũ quá số lượng BACKUP_KEEP
OLD_FILES="$(find "$TARGET_DIR" -maxdepth 1 -name "pace-pdf_${DATA_VOLUME}_*.tar.gz" -type f | sort -r | tail -n +$((BACKUP_KEEP + 1)) || true)"
if [ -n "$OLD_FILES" ]; then
  echo "$OLD_FILES" | while read -r old_file; do
    if [ -f "$old_file" ]; then
      log "Xoá bản sao lưu cũ: $(basename "$old_file")"
      rm -f "$old_file"
    fi
  done
fi
