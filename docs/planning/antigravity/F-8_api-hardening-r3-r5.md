# [F-8] Gia cố API: kiểm dữ liệu quản trị user (R3), giới hạn request (R4), giảm ghi file và xoay vòng log (R5)

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: F-7 đã merge vào `main` (PR #22).
Nhánh: `fix/f8-api-hardening` (tạo từ `main`) · **3 commit theo thứ tự** (quyết định của chủ dự án: gộp 3 phần vào một task, mỗi phần một commit):
1. `fix(F-8a): whitelist admin user fields, protect last active admin`
2. `fix(F-8b): limit request body size, reject invalid json, validate activity payloads`
3. `fix(F-8c): keep sessions in memory, coalesce store writes, rotate logs to archive files`

Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push, KHÔNG gộp 3 phần vào 1 commit.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f8-api-hardening
npm ci
```

Làm **lần lượt phần A → B → C**. Sau mỗi phần: chạy `npm run lint; npm test; npm run build`, xanh thì commit đúng message của phần đó rồi mới sang phần sau.

---

## Phần A — API quản trị user (R3) · commit `F-8a`

### Vấn đề
- `server/index.mjs:114-143` (`POST /api/admin/users`) và `:144-157` (`PATCH /api/admin/users/:id`) dùng `sanitizeUserInput` (`server/auth.mjs:71`). Hàm này chỉ bỏ `id`/`createdAt`/`oid`/`tid`, rồi `Object.assign(item, input, …)`. Hệ quả: admin vẫn ghi được **field tuỳ ý** (`foo`, `role: "superadmin"`, `active: "yes"`, `groupIds: "x"`). Chỉ khi POST tạo user mới mới có kiểm `role`/`active`.
- Không có gì chặn admin **tự hạ quyền / tự khoá** hoặc hạ/khoá **admin active cuối cùng**. Khi đó không ai vào được Administration; phải sửa tay `store.json` trên VPS.
- `groupIds` không được kiểm là group có thật.

### Logic cần đạt
1. `server/users.mjs` (mới), hàm thuần:
   - `normalizeUserPatch(input, { groups })`: chỉ giữ `name` (trim, 1–100 ký tự), `role` (`'admin' | 'user'`), `active` (boolean thật), `groupIds` (mảng chuỗi, chỉ giữ id có trong `groups`, bỏ trùng). Field khác bị bỏ qua. Sai kiểu → lỗi **400** message tiếng Việt (vd. `role không hợp lệ`).
   - `assertAdminInvariant({ users, targetId, patch, actorId })`:
     - Lỗi **409** nếu sau khi áp patch không còn admin `active` nào.
     - Lỗi **409** nếu `actorId === targetId` và patch hạ `role` khỏi `admin` hoặc đặt `active: false`.
2. `POST /api/admin/users`: email phải đúng định dạng cơ bản (có `@`, có tên miền), viết thường. Email đã tồn tại thì cập nhật bằng `normalizeUserPatch` + `assertAdminInvariant`.
3. `PATCH /api/admin/users/:id`: dùng `normalizeUserPatch` + `assertAdminInvariant`. `id`, `email`, `createdAt`, `oid`, `tid` không bao giờ đổi qua API.
4. Đổi `role`/`active` → ghi log `level: 'security'`, `action: 'admin.user_updated'`, metadata `{ targetUserId, changedFields }` (chỉ tên field, không ghi email).

### Tiêu chí
- A1: PATCH `{ "foo": 1, "role": "superadmin" }` → 400; PATCH `{ "foo": 1, "name": "Học viên Test 01" }` → 200, user không có `foo`.
- A2: `active: "yes"` → 400. `groupIds` gồm 1 id không tồn tại + 1 id có thật → chỉ giữ id có thật.
- A3: Chỉ còn 1 admin active → hạ thành `user` hoặc `active: false` → 409, store không đổi.
- A4: Admin tự PATCH chính mình `role: "user"` → 409, kể cả khi còn admin khác.
- A5: 2 admin active → admin A hạ admin B → 200; có log `admin.user_updated` với `changedFields: ["role"]`, không chứa email.
- A6: POST email `abc` → 400.

---

## Phần B — Request body và activity log (R4) · commit `F-8b`

### Vấn đề
- `server/index.mjs:41-45` (`body()`): đọc **toàn bộ** request vào bộ nhớ không giới hạn rồi `JSON.parse`. JSON sai → ném lỗi → handler tổng (`:216-218`) trả **500** kèm `error.message` gốc, thay vì 400. nginx giới hạn `/api/` 256 KB (`nginx.conf:51`), nhưng API không tự bảo vệ khi bị gọi trực tiếp trong mạng Docker.
- `POST /api/activities` (`:80-95`): lưu `action`/`description`/`level`/`metadata` gần như nguyên văn. `metadata` là object tuỳ ý (lồng sâu, rất lớn); `level` không giới hạn giá trị.

### Logic cần đạt
1. `server/http.mjs` (mới), hàm `readJsonBody(req, { limitBytes })`:
   - Mặc định 256 KB, đọc theo stream. Vượt giới hạn → dừng đọc, **413** `Request body too large`.
   - Body rỗng → `{}`. JSON sai hoặc gốc không phải object → **400** `Invalid JSON body`.
   - Override bằng `API_BODY_LIMIT_BYTES` (số nguyên dương; sai → mặc định + cảnh báo khi khởi động).
   - Mọi chỗ gọi `body(req)` chuyển sang hàm này.
2. `validateActivityInput(input)` (trong `server/http.mjs` hoặc `server/activities.mjs` mới):
   - `action`: 1–100 ký tự, chỉ `[a-z0-9._-]`; sai → **400**.
   - `description`: cắt còn ≤ 500 ký tự.
   - `level`: `info | success | warning | security`; khác → `info`.
   - `sessionId`: ≤ 100 ký tự.
   - `metadata`: object **phẳng**, ≤ 20 key, key ≤ 50 ký tự, value chỉ `string` (cắt ≤ 200 ký tự) / `number` / `boolean` / `null`; value lồng bị bỏ.
3. Handler lỗi tổng: lỗi **không có** `status` → 500 `{ error: "Server error" }` (không lộ message gốc). Lỗi có `status` → giữ message.

### Tiêu chí
- B1: Body 300 KB → 413, đọc dừng sớm; body 10 KB hợp lệ → bình thường.
- B2: Body `{abc` → 400 `Invalid JSON body`; body `[1,2]` → 400.
- B3: `metadata` = `{ a: { b: 1 }, c: "x" }` → lưu `{ c: "x" }`; 30 key → lưu 20 key; chuỗi 1.000 ký tự → cắt còn 200.
- B4: `action: "DROP TABLE"` → 400; `level: "critical"` → lưu `info`.
- B5: Lỗi không mong đợi (giả lập trong test) → 500 `{ "error": "Server error" }`.

---

## Phần C — Ghi file và xoay vòng log (R5) · commit `F-8c`

### Vấn đề
- `server/index.mjs:74-78` (`POST /api/heartbeat`, 30 giây/user/tab) và `:69` (`/api/auth/session`) ghi `store.sessions` rồi `await save()`. `save()` (`:26-31`) ghi lại **toàn bộ** `store.json`, kể cả toàn bộ log.
- `store.logs` tăng **vô hạn**; `GET /api/admin/logs` (`:186-200`) lọc trên toàn bộ mảng.
- `store.sessions` không bao giờ được dọn.

### Quyết định của chủ dự án
- **Q-F8a — không xoá log tự động.** Log cũ **chuyển ra file lưu trữ** trong cùng volume. Xoá log vẫn chỉ do admin làm qua `DELETE /api/admin/logs`.
- **Q-F8b — `LOG_MAX_IN_STORE` mặc định 20.000** (giá trị đề xuất; chủ dự án có thể đổi bằng biến môi trường khi deploy).

### Logic cần đạt
1. **Phiên online chỉ trong bộ nhớ**:
   - `sessions` thành `Map` trong bộ nhớ, **không** ghi vào `store.json`.
   - `/api/heartbeat` và `/api/auth/session` không gọi `save()`.
   - Dọn định kỳ các mục quá 10 phút không có heartbeat.
   - Khi khởi động, bỏ qua `store.sessions` cũ trong file.
2. **Gộp lần ghi** — `server/store.mjs` (mới):
   - `scheduleSave()` gộp các yêu cầu trong 500 ms thành 1 lần ghi; vẫn ghi file tạm rồi `rename`.
   - Endpoint cần chắc chắn đã ghi (thêm/xoá log, sửa user/group) `await` được promise của lần ghi gộp.
   - Bắt `SIGTERM`/`SIGINT`: ghi nốt lần chờ rồi mới thoát.
3. **Xoay vòng log**:
   - Khi `store.logs.length > LOG_MAX_IN_STORE`, chuyển các log cũ nhất (phần vượt) sang `<thư mục DATA_FILE>/logs-archive-YYYY-MM.jsonl`.
   - Mỗi dòng một JSON; tháng tính theo `timestamp` của log; ghi bằng `appendFile`.
   - **Ghi archive thành công rồi mới bỏ log khỏi store.** Lỗi ghi archive → giữ nguyên log trong store và `console.error`.
   - `LOG_MAX_IN_STORE`: số nguyên ≥ 1000, mặc định 20000; sai → mặc định + cảnh báo khi khởi động.
4. `GET /api/admin/overview`: `online` lấy từ `Map` (cutoff 90 giây như cũ).
5. Cấu hình:
   - `deploy/docker-compose.prod.yml` thêm `LOG_MAX_IN_STORE: ${LOG_MAX_IN_STORE:-20000}` cho service `app`.
   - `deploy/.env.production.example` thêm biến này kèm comment.

### Tiêu chí
- C1: 100 heartbeat liên tiếp → `store.json` **không** bị ghi (spy hoặc `mtime`); `GET /api/admin/overview` vẫn trả user online.
- C2: 50 lần `scheduleSave()` trong 100 ms → đúng 1 lần ghi; nội dung cuối đầy đủ.
- C3: `LOG_MAX_IN_STORE=1000`, thêm 1.500 log → store còn 1.000 log mới nhất; 500 log trong file archive, mỗi dòng parse được; **tổng = 1.500**.
- C4: Giả lập lỗi ghi archive → store vẫn giữ đủ 1.500 log.
- C5: Gửi `SIGTERM` khi đang có lần ghi chờ → file có dữ liệu mới nhất trước khi tiến trình thoát (`child_process`).
- C6: `store.json` cũ có `sessions` → khởi động bình thường; sau lần ghi kế tiếp, file không còn `sessions`.
- C7: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config` hợp lệ.

---

## GIỮ NGUYÊN (cả 3 phần)
- Route và format response thành công.
- Xác thực F-6/F-7 (tenant, `iss`, `oid`).
- Cơ chế allowlist/bootstrap admin.
- `DELETE /api/admin/logs`: chỉ tác động log trong store; ghi rõ trong README.
- Cấu trúc user/group trong `store.json`.
- Frontend: không sửa. Nếu `src/AdminPage.tsx` cần hiện lỗi 409/400 rõ hơn, ghi vào báo cáo, không tự sửa.

## Ràng buộc
- Chỉ sửa/tạo:
  - `server/index.mjs`
  - `server/users.mjs`, `server/http.mjs`, `server/store.mjs` (mới); `server/activities.mjs` (mới, tuỳ chọn)
  - `server/__tests__/*.test.mjs` (mới)
  - `server/auth.mjs` (chỉ nếu bỏ `sanitizeUserInput`; ghi lý do)
  - `deploy/docker-compose.prod.yml`, `deploy/.env.production.example`
  - `README.md`: mục "Phân quyền và Administration" và mục deploy. Ghi: `API_BODY_LIMIT_BYTES`, `LOG_MAX_IN_STORE`, file `logs-archive-*.jsonl`, và việc backup volume đã gồm archive.
- Không thêm dependency. Test dùng thư mục tạm (`fs.mkdtemp`), dữ liệu giả `@example.com`, không đụng `/data`.
- Tất cả test cũ phải pass sau **mỗi** commit.

## Chứng minh + commit + push (PowerShell)
Sau phần A, B, C (mỗi lần):
```powershell
npm run lint; npm test; npm run build
git add server deploy README.md
git commit -m "<message của phần tương ứng>"
```
Sau khi xong cả 3 phần:
```powershell
git log --oneline -4
git diff --stat main...HEAD
Select-String -Path server/index.mjs -Pattern "Object.assign\(item, input|const body = async|store.sessions"
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config > $null; $LASTEXITCODE
git push -u origin fix/f8-api-hardening
```
Kỳ vọng:
- `git log` có đúng 3 commit `F-8a`, `F-8b`, `F-8c` trên `main`.
- `git diff --stat` chỉ có file trong Ràng buộc.
- Select-String không có kết quả.
- `$LASTEXITCODE` in `0`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f8-api-hardening
git rev-parse --short HEAD
git log --oneline -1 origin/fix/f8-api-hardening
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Output Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md`, thêm:
- Bảng `Phần | K | tên test | pass` cho A1–A6, B1–B5, C1–C7.
- Kích thước `store.json` trước/sau trong test C3.
- Ghi chú cho frontend (nếu có).
