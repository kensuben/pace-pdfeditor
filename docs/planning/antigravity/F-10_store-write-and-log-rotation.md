# [F-10] API: không ghi `store.json` mỗi heartbeat, gộp lần ghi, xoay vòng log ra file lưu trữ (R5)

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: **F-9 đã merge** vào `main` (cùng sửa `server/index.mjs`).
Nhánh: `fix/f10-store-write-log-rotation` (tạo từ `main`) · Commit: `fix(F-10): keep sessions in memory, coalesce store writes, rotate logs to archive files`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/fix/f10-store-write-log-rotation` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.** Bắt buộc chạy **Bước Z** trong `00_RULES.md`.

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f10-store-write-log-rotation
npm ci
```

## Vấn đề (R5 trong `docs/word-anonymizer/01-PLAN.md`)
- `server/index.mjs:74-78` (`POST /api/heartbeat`, 30 giây/user/tab) và `:69` (`/api/auth/session`) ghi `store.sessions` rồi `await save()`. Hàm `save()` (`:26-31`) ghi lại **toàn bộ** `store.json` (gồm toàn bộ log). Với N người online, mỗi phút có 2N lần ghi cả file.
- `store.logs` tăng **vô hạn**. File càng lớn, mỗi lần ghi càng chậm và tốn bộ nhớ. `GET /api/admin/logs` (`:186-200`) lọc trên toàn bộ mảng.
- `store.sessions` không bao giờ dọn mục cũ.

## Quyết định của chủ dự án
- **Q-F10a — không xoá log tự động.** Log cũ được **chuyển ra file lưu trữ** trong cùng volume, không bị xoá. Việc xoá vẫn chỉ do admin làm qua chức năng hiện có (`DELETE /api/admin/logs`).
- **Q-F10b — giá trị mặc định:** giữ tối đa **20.000** log gần nhất trong `store.json` (`LOG_MAX_IN_STORE`). Có thể đổi bằng biến môi trường. *Chủ dự án xác nhận lại con số này trước khi giao task.*

## Logic cần đạt
1. **Phiên online chỉ trong bộ nhớ**:
   - `sessions` chuyển sang `Map` trong bộ nhớ, **không** ghi vào `store.json`.
   - `/api/heartbeat` và `/api/auth/session` không gọi `save()`.
   - Mục quá 10 phút không có heartbeat được dọn định kỳ.
   - Khi khởi động, bỏ qua `store.sessions` cũ trong file (nếu có) và không ghi lại.
   - Server khởi động lại thì danh sách online trống (chấp nhận được).
2. **Gộp lần ghi** (`server/store.mjs`, mới):
   - `scheduleSave()` gộp các yêu cầu ghi trong 500 ms thành 1 lần ghi.
   - Vẫn ghi file tạm rồi `rename` (atomic) như hiện tại.
   - Endpoint cần chắc chắn đã ghi (thêm/xoá log, sửa user/group) vẫn `await` được promise của lần ghi gộp.
   - Bắt `SIGTERM`/`SIGINT`: ghi nốt lần chờ rồi mới thoát (để `docker stop` không mất dữ liệu).
3. **Xoay vòng log ra file lưu trữ**:
   - Khi `store.logs.length > LOG_MAX_IN_STORE`, chuyển các log cũ nhất (phần vượt quá) sang `<thư mục DATA_FILE>/logs-archive-YYYY-MM.jsonl`. Mỗi dòng một JSON; tháng tính theo `timestamp` của log. **Ghi archive thành công rồi mới bỏ khỏi `store.logs`.**
   - Ghi archive bằng `appendFile`; lỗi ghi archive → giữ nguyên log trong store và `console.error`, không mất dữ liệu.
   - `LOG_MAX_IN_STORE`: số nguyên ≥ 1000, mặc định 20000; giá trị sai → mặc định + cảnh báo khi khởi động.
4. `GET /api/admin/overview`: `online` lấy từ `Map` trong bộ nhớ (cutoff 90 giây như cũ); `totalLogs` = số log trong store (ghi chú trong README rằng log cũ nằm ở file archive).
5. README mục "Phân quyền và Administration" và mục backup:
   - Mô tả file `logs-archive-*.jsonl`.
   - Mô tả biến `LOG_MAX_IN_STORE`.
   - Nêu rằng backup volume đã bao gồm các file archive.
6. GIỮ NGUYÊN: route, format response, `DELETE /api/admin/logs` (chỉ tác động log trong store, ghi rõ trong README), xác thực F-6/F-7, logic F-8/F-9, cấu trúc user/group trong `store.json`.

## Ràng buộc
- Chỉ sửa/tạo:
  - `server/index.mjs`
  - `server/store.mjs` (mới)
  - `server/__tests__/store.test.mjs` (mới)
  - `deploy/docker-compose.prod.yml` (chỉ thêm `LOG_MAX_IN_STORE: ${LOG_MAX_IN_STORE:-20000}`)
  - `deploy/.env.production.example` (thêm biến kèm comment)
  - `README.md`
- Không thêm dependency. Test dùng thư mục tạm (`fs.mkdtemp`), không đụng `/data`.

## Tiêu chí hoàn thành
- K1: 100 heartbeat liên tiếp → `store.json` **không** bị ghi lần nào (kiểm qua `mtime` hoặc đếm số lần ghi bằng spy trong test). `GET /api/admin/overview` vẫn trả user online.
- K2: 50 lần `scheduleSave()` trong 100 ms → đúng 1 lần ghi file; nội dung cuối cùng đầy đủ.
- K3: `LOG_MAX_IN_STORE=1000`, thêm 1.500 log → store còn 1.000 log mới nhất; 500 log cũ nằm trong `logs-archive-YYYY-MM.jsonl`, đủ dòng, mỗi dòng parse được; tổng store + archive = 1.500 (không mất log nào).
- K4: Giả lập lỗi ghi archive (thư mục chỉ đọc hoặc mock `appendFile`) → store vẫn giữ đủ 1.500 log.
- K5: Gửi `SIGTERM` khi đang có lần ghi chờ → file chứa dữ liệu mới nhất trước khi tiến trình thoát (test bằng `child_process`).
- K6: `store.json` cũ có trường `sessions` → khởi động bình thường; sau lần ghi tiếp theo, file không còn `sessions`.
- K7: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config` hợp lệ.
- K8: `npm run lint`, `npm test`, `npm run build` xanh; mọi test cũ pass.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path server/index.mjs -Pattern "store.sessions"
npm run lint; npm test; npm run build
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config > $null; $LASTEXITCODE
git add server deploy/docker-compose.prod.yml deploy/.env.production.example README.md
git commit -m "fix(F-10): keep sessions in memory, coalesce store writes, rotate logs to archive files"
git push -u origin fix/f10-store-write-log-rotation
git log --oneline -1 origin/fix/f10-store-write-log-rotation
git fetch origin
git ls-remote --heads origin fix/f10-store-write-log-rotation
git rev-parse --short HEAD
```
Kỳ vọng:
- `git diff --stat` chỉ có file trong Ràng buộc.
- Select-String không có kết quả.
- lint/test/build xanh.
- `$LASTEXITCODE` in `0`.
- `git ls-remote` in đúng 1 dòng, SHA trùng `git rev-parse`.

## Báo cáo
Output Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md` + bảng `K | tên test | pass` + kích thước `store.json` trước/sau trong test K3.
