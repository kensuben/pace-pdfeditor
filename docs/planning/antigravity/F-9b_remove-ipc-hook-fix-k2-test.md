# [F-9b] Sửa F-9: xoá đường tắt IPC trong code production, test SIGTERM thật không treo CI, ghi archive atomic

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
**Ngoại lệ có chủ đích:** task này sửa tiếp **trên chính nhánh** `fix/f9-store-shutdown-413-rotation` (chưa merge), không tạo nhánh mới. Lý do: merge F-9 hiện tại sẽ làm CI treo và đưa cửa hậu vào `main`.
Commit thêm: `fix(F-9b): remove IPC test hook, real SIGTERM test on POSIX, atomic archive rewrite`
KHÔNG push `main`, KHÔNG force-push, KHÔNG rebase lịch sử đã push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
```powershell
git status --porcelain
```
Có dòng nào → **DỪNG**, báo lại; không reset/clean/stash. Không có:
```powershell
git fetch origin
git checkout fix/f9-store-shutdown-413-rotation
git pull --ff-only
npm ci
```

## Vấn đề (QA F-9 trên Linux, dữ liệu giả)
1. 🔴 **Đường tắt test trong code production.**
   - `server/index.mjs` (khối `process.on('message', …)` thêm ở F-9): nhận `{ type: 'test-change', data }` thì `store.users.push(data); save()`. Nhận `'SIGTERM' | 'SIGINT' | 'shutdown'` thì tắt server.
   - Đã tái hiện: chạy server bằng `fork()` (có kênh IPC), gửi user `role: 'admin'` → user được **ghi vào `store.json`**, không qua xác thực.
   - Docker hiện tại không có IPC, nhưng chạy qua PM2 hoặc trình quản lý tiến trình có IPC thì đây là cửa hậu tạo admin.
2. 🔴 **Test K2 treo vô hạn trên Linux.**
   - `server/__tests__/store.test.mjs` (test K2) chỉ mở kênh `'ipc'` khi `win32`. Trên Linux, test gọi `serverProc.send(...)` khi không có IPC, nên lỗi trước khi kịp `kill('SIGTERM')`. Tiến trình `node server/index.mjs` con không bao giờ tắt và vitest chờ mãi.
   - Đo thực tế: `npm test` treo hơn 10 phút. CI chạy trên Ubuntu, nên merge vào sẽ làm job `verify` treo (mặc định tới 6 giờ) và không đẩy được image.
   - Trên Windows, K2 tắt server bằng tin nhắn IPC chứ không phải tín hiệu thật, nên không kiểm được SIGTERM.
3. 🟡 **Ghi đè archive không atomic.** `server/store.mjs` (`rotateLogs`, nhánh gỡ log admin đã xoá) ghi đè file archive bằng `writeFile` trực tiếp. Tiến trình chết giữa chừng → file archive cả tháng có thể bị cắt cụt.

## Logic cần đạt
1. **Xoá hoàn toàn** khối `process.on('message', …)` trong `server/index.mjs`. Code production không được có đường nào thêm/sửa dữ liệu hoặc tắt server ngoài HTTP đã xác thực và tín hiệu hệ điều hành.
2. Tách logic tắt server sang `server/lifecycle.mjs` (mới):
   - Export `createShutdownHandler({ server, storeManager, exit = process.exit, timeoutMs = 10000 })`, trả về `shutdown(signal)`.
   - Gọi nhiều lần thì chỉ chạy một lần.
   - Hành vi giữ như F-9: đóng server → `await storeManager.flush()` → `exit(0)`; quá `timeoutMs` → `exit(1)`.
   - `server/index.mjs` dùng hàm này cho `SIGTERM`/`SIGINT`.
3. **Viết lại test K2:**
   - (a) Unit test `createShutdownHandler` với server giả + `CoalescedStore` thật đang ghi dở. Kiểm: `exit(0)` chỉ được gọi **sau khi** file đã có thay đổi; gọi `shutdown` 2 lần thì `exit` chỉ chạy 1 lần.
   - (b) Test `child_process` dùng **tín hiệu thật**:
     - Tạo `server/__tests__/fixtures/shutdown-harness.mjs` (chỉ dùng trong test). Harness dựng `CoalescedStore` (DATA_FILE tạm) + `createShutdownHandler`, gắn vào `SIGTERM`, ghi một thay đổi, `scheduleSave()`, rồi in `READY`.
     - Test cha chờ `READY`, gửi `kill('SIGTERM')` 2 lần. Kỳ vọng: exit code 0, file có thay đổi, không còn `.tmp`.
     - Dùng `it.skipIf(process.platform === 'win32')` cho (b).
   - **Mọi** test có spawn tiến trình con phải kill con trong `finally` và có timeout, để `npm test` không bao giờ treo.
4. Nhánh gỡ log admin đã xoá ra khỏi archive trong `rotateLogs`: ghi file tạm cùng thư mục rồi `rename` (atomic).
5. `.github/workflows/docker-publish.yml`: thêm `timeout-minutes: 15` cho job `verify` và `timeout-minutes: 20` cho job `publish`. Chỉ thêm 2 dòng này.
6. GIỮ NGUYÊN: kết quả đã đạt ở F-9 (flush chờ ghi xong, 413 tới được client, xoay vòng theo `id`).

## Ràng buộc
- Chỉ sửa/tạo:
  - `server/index.mjs`
  - `server/lifecycle.mjs` (mới)
  - `server/store.mjs`
  - `server/__tests__/*.test.mjs`
  - `server/__tests__/fixtures/shutdown-harness.mjs` (mới)
  - `.github/workflows/docker-publish.yml` (chỉ 2 dòng `timeout-minutes`)
- Không thêm dependency.

## Tiêu chí hoàn thành
- K1: `Select-String -Path server/*.mjs -Pattern "process.on\('message'|test-change"` không có kết quả.
- K2: `npm test` **kết thúc** (không treo) trên Windows; báo cáo ghi thời gian chạy. Test (b) bị skip trên Windows là chấp nhận được; Claude sẽ chạy trên Linux khi QA.
- K3: Unit test (a) pass; test (b) pass trên Linux/WSL nếu có.
- K4: Test gỡ log admin đã xoá ra khỏi archive dùng file tạm + `rename` (kiểm bằng spy, hoặc kiểm không còn file tạm sót lại).
- K5: Workflow có `timeout-minutes` ở cả 2 job; mọi input trong `with:` vẫn là chuỗi.
- K6: `npm run lint`, `npm test`, `npm run build` xanh; mọi test cũ pass.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat origin/fix/f9-store-shutdown-413-rotation
Select-String -Path server/*.mjs -Pattern "process.on\('message'|test-change"
Measure-Command { npm test } | Select-Object TotalSeconds
npm run lint; npm run build
git add server .github/workflows/docker-publish.yml
git commit -m "fix(F-9b): remove IPC test hook, real SIGTERM test on POSIX, atomic archive rewrite"
git push origin fix/f9-store-shutdown-413-rotation
```
Kỳ vọng:
- `git diff --stat` chỉ có file trong Ràng buộc.
- Select-String không có kết quả.
- `npm test` kết thúc, in số giây.
- lint/build xanh.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f9-store-shutdown-413-rotation
git rev-parse --short HEAD
git log --oneline -2 origin/fix/f9-store-shutdown-413-rotation
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`; `git log` phải có commit `F-9b` ngay trên commit F-9 cũ. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng.

## Báo cáo
Output Bước 0, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md` + bảng `K | cách kiểm | kết quả` + thời gian chạy `npm test`.
