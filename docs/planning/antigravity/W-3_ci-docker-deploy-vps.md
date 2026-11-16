# [W-3] CI build image GHCR + Compose production + script deploy/rollback cho VPS

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Script mẫu để chuyển thể: `docs/word-anonymizer/reference/deploy.dpadmin.sh`.
Tiền điều kiện: W-0 đã merge vào `main` (CI cần `npm test`). Có thể làm song song W-1/W-2.
Nhánh: `ops/w3-ci-ghcr-deploy-vps` (tạo từ `main`) · Commit: `ops(W-3): ghcr images, production compose and vps deploy/rollback scripts`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/ops/w3-ci-ghcr-deploy-vps` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b ops/w3-ci-ghcr-deploy-vps
```

## Vấn đề
- Hiện deploy bằng `compose.yaml` build tại chỗ (service `paperly` + `api`). Không có CI, không có cách biết VPS đang chạy commit nào, không có rollback.
- Script mẫu `deploy.dpadmin.sh` thuộc dự án Laravel + MySQL. Triết lý cần giữ: CI chỉ đẩy `:latest` khi build + test xanh; VPS không build; rollback theo tag `sha-<7>`; đọc commit đang chạy từ label `org.opencontainers.image.revision` của container `<PROJECT>-app-1`; health check `<PROJECT>-web-1`; `APP_TAG` truyền qua dòng lệnh, không sửa/đọc file env.
- Khác biệt: không có DB (dữ liệu là `/data/store.json` trong volume `paperly_data`); `VITE_MICROSOFT_*` là biến **build-time**; nginx gọi `http://api:3001`.

## Logic cần đạt
1. **`.github/workflows/docker-publish.yml`**
   - Trigger: push `main` + `workflow_dispatch`.
   - Job `verify`: `npm ci` → `npm run lint` → `npm test` → `npm run build`.
   - Job `publish` (`needs: verify`): build + push `ghcr.io/<owner viết thường>/pace-pdfeditor-web` (Dockerfile) và `…/pace-pdfeditor-api` (Dockerfile.api). Tag `latest` + `sha-<7 ký tự>`, label `org.opencontainers.image.revision=${{ github.sha }}`.
   - Build arg `VITE_*` lấy từ `${{ vars.* }}` (GitHub **Variables**). `permissions: contents: read, packages: write`, đăng nhập bằng `GITHUB_TOKEN`.
   - Action chính thức (`actions/checkout`, `actions/setup-node`, `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, `docker/build-push-action`), pin major version hiện hành (kiểm tra trên Marketplace, ghi vào báo cáo).
2. **`deploy/docker-compose.prod.yml`** (chỉ `image:`, không `build:`)
   - `web`: image web `:${APP_TAG:-latest}`. Port `${APP_BIND:-127.0.0.1}:${APP_PORT:-8080}:8080`. Healthcheck `/healthz`. `read_only` + tmpfs + `cap_drop` + `cap_add` như `compose.yaml`. `depends_on: app: condition: service_healthy`.
   - `app`: image api `:${APP_TAG:-latest}`. **Network alias `api`** (để `nginx.conf` giữ nguyên). Healthcheck `wget -qO- http://127.0.0.1:3001/healthz`. `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`. Env `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID`, `ADMIN_EMAILS`, `DATA_FILE=/data/store.json`. Volume `/data`.
   - Volume `paperly_data` khai báo **`external: true`** + `name: ${DATA_VOLUME:-pace-pdfeditor_paperly_data}` để **dùng lại volume cũ** trên VPS (đã xác nhận tên `pace-pdfeditor_paperly_data` bằng `docker volume ls`). Lý do dùng `external`: sai tên → compose báo lỗi và dừng, thay vì lặng lẽ tạo volume mới rỗng (mất user/log). Compose prod **không bao giờ** tự tạo hay xoá volume này.
   - `DATA_VOLUME` chỉ override qua **biến shell** (không đặt trong `deploy/.env.production`), để `scripts/deploy.sh` và `scripts/backup.sh` dùng cùng giá trị mà không cần đọc file env.
3. **`deploy/.env.production.example`**: chỉ tên biến + giá trị giả (`00000000-0000-0000-0000-000000000000`, `admin.test@example.com`). `.gitignore` thêm `deploy/.env.production`, `.deploy/`, `backups/`.
4. **`scripts/deploy.sh`**: chuyển thể từ file mẫu, giữ `deploy | rollback | status`, các hàm `running_revision`, `wait_healthy`, `start_tag`, mốc `.deploy/previous`, `.deploy/history.log`.
   - `PROJECT` mặc định `pace-pdf`. `COMPOSE_FILES` mặc định `-f deploy/docker-compose.prod.yml --env-file deploy/.env.production`.
   - `db_ping` → `api_ping` (`dc exec -T app wget -qO- http://127.0.0.1:3001/healthz`).
   - Kiểm tra đầu vào: có `docker`, `docker compose`, file env tồn tại (chỉ `[ -f ]`, **không đọc nội dung**).
   - Biến `DATA_VOLUME="${DATA_VOLUME:-pace-pdfeditor_paperly_data}"`, cùng mặc định với compose.
   - Hàm `preflight_volume` chạy đầu `deploy` và `rollback`, trước backup:
     - (a) `docker volume inspect "$DATA_VOLUME"` thất bại → `die` kèm hướng dẫn: kiểm tra `docker volume ls`, hoặc lần đầu cài mới thì tự `docker volume create <tên>`. Script **không tự tạo** volume.
     - (b) Liệt kê container đang gắn volume: `docker ps -a --filter "volume=$DATA_VOLUME" --format '{{.Names}}\t{{.Label "com.docker.compose.project"}}'`. Container nào có project khác `$PROJECT` → `die` kèm tên container và hướng dẫn dừng stack cũ (mục README). Mục đích: không để 2 API cùng ghi `store.json`, không tranh port 8080.
   - `status` in thêm `DATA_VOLUME` và danh sách container đang gắn volume.
   - Bỏ ghi chú Laravel/migrate. Dòng "Kiểm tay" cuối: *đăng nhập Microsoft, mở 1 PDF, ẩn danh 1 file .docx mẫu, mở Administration (admin)*.
5. **`scripts/backup.sh`**: `docker run --rm -v <volume>:/data:ro -v <dir>:/backup alpine:<tag pin> tar czf …`. Thư mục `backups/` `chmod 700`. Giữ `BACKUP_KEEP` bản (mặc định 14). Volume chưa tồn tại → cảnh báo, exit 0.
6. **README**: mục "Deploy production (VPS)":
   - Chuẩn bị lần đầu: clone repo; `docker login ghcr.io` bằng PAT `read:packages` (người vận hành tự tạo); tạo `deploy/.env.production` từ example; chạy `docker volume ls` để xác nhận volume `pace-pdfeditor_paperly_data` (khác tên thì `export DATA_VOLUME=<tên>` trước khi chạy script).
   - **Chuyển từ stack cũ sang stack mới (chỉ làm 1 lần)**, theo đúng thứ tự:
     1. Backup: `./scripts/backup.sh`.
     2. Vào thư mục đang chạy stack cũ, `docker compose down` — **TUYỆT ĐỐI KHÔNG thêm `-v`** (sẽ xoá volume dữ liệu).
     3. Kiểm tra `docker ps -a --filter volume=pace-pdfeditor_paperly_data` không còn container nào và port 8080 đã trống.
     4. `./scripts/deploy.sh`.
     5. Có lỗi thì quay lại stack cũ: `./scripts/deploy.sh` không xoá gì; chạy lại `docker compose up -d` ở thư mục cũ sau khi `docker compose -p pace-pdf -f deploy/docker-compose.prod.yml down` (không `-v`).
   - Lệnh `deploy` / `rollback` / `status`.
   - Khôi phục từ backup.
   - Khai báo GitHub Variables cho CI.

## Ràng buộc
- Chỉ tạo/sửa: `.github/workflows/docker-publish.yml`, `deploy/docker-compose.prod.yml`, `deploy/.env.production.example`, `scripts/deploy.sh`, `scripts/backup.sh`, `.gitignore`, `README.md`. Thêm `LABEL` vào Dockerfile chỉ khi metadata-action không gắn được (ghi lý do).
- **Giữ nguyên** `compose.yaml` (dev local) và `nginx.conf`.
- Script bash phải chạy trên Linux VPS: line ending **LF** (thêm `.gitattributes` `*.sh text eol=lf` nếu cần) và bit thực thi (`git update-index --chmod=+x`).
- Không có secret/PAT/client ID thật trong bất kỳ file nào.

## Tiêu chí hoàn thành
- K1: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config` hợp lệ; cả `APP_TAG` rỗng và `APP_TAG=sha-abc1234` đều ra image đúng tag.
- K2: `bash -n` sạch cho 2 script (chạy qua Git Bash hoặc WSL); `shellcheck` sạch nếu có.
- K3: Tên service `app`/`web` khớp `APP_CONTAINER`/`WEB_CONTAINER` trong script; alias `api` khớp `nginx.conf`.
- K4: Workflow: `publish` có `needs: verify`; tag `latest` + `sha-<7>`; có label revision; không dùng secret ngoài `GITHUB_TOKEN`.
- K5: `docker build` 2 Dockerfile thành công local; `docker inspect` image thấy label revision khi build qua metadata-action (hoặc ghi rõ cách đã kiểm).
- K6: `git ls-files --eol scripts/` hiện `lf`; `git ls-files -s scripts/` hiện mode `100755`.
- K7: `docker compose … config` cho thấy volume `paperly_data` có `external: true` và `name: pace-pdfeditor_paperly_data`; với `$env:DATA_VOLUME="vol-test"` thì `name: vol-test`.
- K8: Không có `down -v`, `docker volume rm`, `docker volume prune`, `docker volume create` trong `scripts/` và `deploy/` (README chỉ được nhắc `-v` trong câu cảnh báo).
- K9: Thử local: tạo volume giả `pace-pdf-qa-vol`, chạy 1 container `alpine sleep 300` gắn volume đó (không thuộc project), rồi `$env:DATA_VOLUME="pace-pdf-qa-vol"` + `bash scripts/deploy.sh deploy` → script **dừng ở preflight** với thông báo nêu tên container; xoá container/volume giả sau khi thử. Volume không tồn tại → dừng với hướng dẫn, không tạo volume.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
$env:APP_TAG=""; docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config | Select-String 'image:'
$env:APP_TAG="sha-abc1234"; docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config | Select-String 'image:'
Remove-Item Env:APP_TAG
bash -n scripts/deploy.sh; bash -n scripts/backup.sh
git update-index --chmod=+x scripts/deploy.sh scripts/backup.sh
git ls-files --eol scripts/
git ls-files -s scripts/
Select-String -Path deploy/*,scripts/*,.github/workflows/* -Pattern 'ghp_|github_pat_|@pace\.edu\.vn'
Select-String -Path deploy/*,scripts/* -Pattern 'down -v|volume rm|volume prune|volume create'
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config | Select-String -Context 0,3 'paperly_data:'
git add .github deploy scripts .gitignore README.md
if (Test-Path .gitattributes) { git add .gitattributes }
git commit -m "ops(W-3): ghcr images, production compose and vps deploy/rollback scripts"
git push -u origin ops/w3-ci-ghcr-deploy-vps
git log --oneline -1 origin/ops/w3-ci-ghcr-deploy-vps
```
Kỳ vọng:
- Lệnh `config` đầu in `:latest`, lệnh thứ hai in `:sha-abc1234`.
- `bash -n` không có output.
- Script là `lf` + `100755`.
- Select-String tìm secret không có kết quả.
- Select-String `down -v|volume rm|…` không có kết quả; lệnh `config` cuối hiện `external: true` và `name: pace-pdfeditor_paperly_data`.
- Dòng cuối in commit vừa push.

## Báo cáo
2 output `git push` + `git log origin/...` ở đầu, rồi theo `00_RULES.md` + bảng so sánh `deploy.dpadmin.sh → scripts/deploy.sh` (giữ / đổi / bỏ) + danh sách việc người vận hành phải làm tay trên VPS và GitHub (Variables, PAT, `DATA_VOLUME`) + output thử K9.
