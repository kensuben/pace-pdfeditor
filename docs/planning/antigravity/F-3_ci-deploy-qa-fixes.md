# [F-3] CI/deploy: sửa workflow lỗi cú pháp và 5 điểm QA của W-3

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: W-3 đã merge vào `main` (PR #9).
Nhánh: `fix/f3-ci-deploy-qa-fixes` (tạo từ `main`) · Commit: `fix(F-3): valid metadata-action tags, main-only publish, safer deploy docs`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/fix/f3-ci-deploy-qa-fixes` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f3-ci-deploy-qa-fixes
```

## Vấn đề
QA của W-3 phát hiện:
1. **Workflow không chạy được.** `.github/workflows/docker-publish.yml:62` và `:87` khai báo input `tags:` của `docker/metadata-action@v5` dưới dạng **list YAML** (`- type=raw,value=latest` …). Input trong `with:` của GitHub Actions phải là chuỗi, nên workflow lỗi và không build image nào.
2. **Chạy thủ công trên nhánh khác vẫn đẩy `:latest`.** Trigger `workflow_dispatch` (`:7`) chạy được trên mọi nhánh, mà job `publish` (`:39`) không có điều kiện. Chạy thủ công trên nhánh khác `main` vẫn đẩy `:latest` và VPS sẽ deploy bản đó.
3. **Quyền quá rộng.** `permissions: packages: write` khai báo ở cấp workflow (`:9-11`), nên job `verify` (chỉ lint/test/build) cũng có quyền ghi package.
4. **`scripts/deploy.sh` phụ thuộc thư mục đang đứng.** Script gọi `./scripts/backup.sh` (`:114`) và dùng đường dẫn tương đối (`deploy/…`, `.deploy`). Chạy từ thư mục khác, ví dụ `/opt/pace-pdfeditor/scripts/deploy.sh` từ `~`, sẽ lỗi hoặc ghi trạng thái sai chỗ. `scripts/backup.sh` cũng tạo `backups/` theo thư mục đang đứng.
5. **PAT bị lưu vào lịch sử shell.** `README.md:175` hướng dẫn `echo "<GITHUB_PAT>" | docker login …`.
6. **Không backup trước khi khôi phục.** Lệnh khôi phục ở `README.md:251` chạy `rm -rf /data/*` mà không lưu lại trạng thái hiện tại trước.

## Logic cần đạt
1. `tags:` của cả 2 bước `metadata-action` viết dạng chuỗi nhiều dòng (`tags: |`), giữ nguyên 2 tag `type=raw,value=latest` và `type=sha,prefix=sha-,format=short`. `labels:` cũng viết `|` cho thống nhất.
2. Job `publish` chỉ chạy khi `github.ref == 'refs/heads/main'`. Chạy thủ công trên nhánh khác thì chỉ chạy `verify`.
3. Cấp workflow: `permissions: contents: read`. Riêng job `publish`: `contents: read`, `packages: write`.
4. `scripts/deploy.sh` và `scripts/backup.sh`: đầu script chuyển về thư mục gốc repo theo vị trí file script (`cd "$(dirname "${BASH_SOURCE[0]}")/.."` hoặc tương đương), để gọi từ thư mục nào cũng chạy đúng. Biến môi trường override (`PROJECT`, `STATE_DIR`, `BACKUP_DIR`, `DATA_VOLUME`…) giữ nguyên ý nghĩa.
5. README, phần đăng nhập GHCR: dùng `docker login ghcr.io -u <GITHUB_USERNAME>` (lệnh tự hỏi mật khẩu, người vận hành dán PAT vào). Nêu rõ không đưa PAT vào lệnh, vào script hay vào repo.
6. README, phần khôi phục: trước bước xoá phải có bước chạy `./scripts/backup.sh` để lưu trạng thái hiện tại, kèm lưu ý dừng stack (`docker compose -p pace-pdf -f deploy/docker-compose.prod.yml stop`, **không** `down -v`). Giữ lệnh khôi phục, nhưng xoá cả file ẩn (vd. `find /data -mindepth 1 -delete`) thay vì `rm -rf /data/*`.
7. GIỮ NGUYÊN: tên image, tag, label revision, build-arg `vars.*`, compose prod, logic preflight/rollback/status, tên service và alias.

## Ràng buộc
- Chỉ sửa `.github/workflows/docker-publish.yml`, `scripts/deploy.sh`, `scripts/backup.sh`, `README.md`.
- Script giữ line ending LF và mode `100755`.
- Không thêm secret; chỉ dùng `GITHUB_TOKEN`.

## Tiêu chí hoàn thành
- K1: Đọc workflow bằng parser YAML: mọi giá trị trong `with:` đều là chuỗi. Lệnh kiểm ở mục Chứng minh in `OK`.
- K2: Job `publish` có `if:` chỉ cho `refs/heads/main`; `packages: write` chỉ nằm trong job `publish`.
- K3: Từ thư mục khác repo, chạy `bash <repo>/scripts/deploy.sh status` (Git Bash/WSL) → không lỗi đường dẫn; `.deploy/` và `backups/` (nếu tạo) nằm trong repo.
- K4: README không còn `echo "<GITHUB_PAT>"` và không còn `rm -rf /data/*`; phần khôi phục có bước backup trước.
- K5: `bash -n` sạch cho 2 script; `git ls-files --eol scripts/` hiện `lf`; `git ls-files -s scripts/` hiện `100755`.
- K6: Sau khi merge, workflow trên `main` chạy được tới bước publish (người vận hành xem tab Actions; cần khai báo GitHub Variables trước).

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
python -c "import yaml,sys; w=yaml.safe_load(open('.github/workflows/docker-publish.yml',encoding='utf-8')); bad=[(j,s.get('name'),k) for j,job in w['jobs'].items() for s in job['steps'] for k,v in (s.get('with') or {}).items() if not isinstance(v,(str,int,float,bool))]; print('OK' if not bad else bad)"
Select-String -Path .github/workflows/docker-publish.yml -Pattern "refs/heads/main|packages: write"
Select-String -Path README.md -Pattern 'echo "<GITHUB_PAT>"|rm -rf /data/\*'
bash -n scripts/deploy.sh; bash -n scripts/backup.sh
git ls-files --eol scripts/
git ls-files -s scripts/
git add .github/workflows/docker-publish.yml scripts/deploy.sh scripts/backup.sh README.md
git commit -m "fix(F-3): valid metadata-action tags, main-only publish, safer deploy docs"
git push -u origin fix/f3-ci-deploy-qa-fixes
git log --oneline -1 origin/fix/f3-ci-deploy-qa-fixes
```
Kỳ vọng:
- `git diff --stat` chỉ có 4 file trên.
- Lệnh `python` in `OK`. Nếu thiếu PyYAML: `pip install pyyaml` hoặc ghi rõ cách đã kiểm.
- Select-String trên workflow có dòng `refs/heads/main` và đúng 1 dòng `packages: write`.
- Select-String trên README không có kết quả.
- `bash -n` không có output.
- Script là `lf` + `100755`.
- Dòng cuối in commit vừa push.

## Báo cáo
Output `git rev-parse` của Bước A + 2 output git ở đầu, rồi theo `00_RULES.md` + output K3 (chạy `status` từ thư mục khác).
