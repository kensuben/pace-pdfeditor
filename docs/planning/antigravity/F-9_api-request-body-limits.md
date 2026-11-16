# [F-9] API: giới hạn kích thước body, trả 400 khi JSON sai, kiểm dữ liệu activity log (R4)

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: **F-8 đã merge** vào `main` (cùng sửa `server/index.mjs`).
Nhánh: `fix/f9-api-request-body-limits` (tạo từ `main`) · Commit: `fix(F-9): limit request body size, reject invalid json, validate activity payloads`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/fix/f9-api-request-body-limits` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.** Bắt buộc chạy **Bước Z** trong `00_RULES.md`.

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f9-api-request-body-limits
npm ci
```

## Vấn đề (R4 trong `docs/word-anonymizer/01-PLAN.md`)
- `server/index.mjs:41-45` (`body()`): đọc **toàn bộ** request vào bộ nhớ không giới hạn, rồi `JSON.parse`. JSON sai làm ném lỗi và trả **500** (`:216-218`) thay vì 400. nginx đang giới hạn `/api/` ở 256 KB (`nginx.conf:51`), nhưng API không tự bảo vệ nếu bị gọi trực tiếp trong mạng Docker.
- `POST /api/activities` (`server/index.mjs:80-95`): lưu `action`, `description`, `level`, `metadata` gần như nguyên văn từ client. `metadata` là object tuỳ ý (có thể lồng sâu, rất lớn). `level` không giới hạn giá trị. Mỗi bản ghi có thể phình `store.json`.

## Logic cần đạt
1. Tách `readJsonBody(req, { limitBytes })` vào `server/http.mjs` (mới):
   - Mặc định `limitBytes = 256 * 1024` (khớp nginx), đọc theo stream. Vượt giới hạn → dừng đọc, lỗi **413** `Request body too large`.
   - Body rỗng → `{}`. JSON sai hoặc gốc không phải object → **400** `Invalid JSON body`.
   - Có thể override bằng biến môi trường `API_BODY_LIMIT_BYTES` (số nguyên dương; giá trị sai → dùng mặc định và in cảnh báo khi khởi động).
2. Mọi chỗ đang gọi `body(req)` chuyển sang `readJsonBody`.
3. `validateActivityInput(input)` (cùng file hoặc `server/activities.mjs`):
   - `action`: chuỗi 1–100 ký tự, chỉ `[a-z0-9._-]`.
   - `description`: chuỗi ≤ 500 ký tự (cắt bớt nếu dài hơn).
   - `level`: một trong `info | success | warning | security`; khác → `info`.
   - `sessionId`: chuỗi ≤ 100 ký tự.
   - `metadata`: object **phẳng**, ≤ 20 key; key ≤ 50 ký tự; value chỉ `string` (≤ 200 ký tự, cắt bớt) / `number` / `boolean` / `null`. Value lồng (object/array) bị bỏ.
   - `action` sai → **400**. Các field khác được chuẩn hoá như trên, không trả lỗi.
4. Handler lỗi tổng (`server/index.mjs:216-218`): lỗi không có `status` → trả 500 với message chung `Server error` (không trả `error.message` gốc ra client); lỗi có `status` giữ message hiện tại.
5. GIỮ NGUYÊN: route, format response thành công, xác thực F-6/F-7, logic F-8.

## Ràng buộc
- Chỉ sửa/tạo: `server/index.mjs`, `server/http.mjs` (mới), `server/activities.mjs` (mới, tuỳ chọn), `server/__tests__/http.test.mjs` (mới), `README.md` (chỉ thêm `API_BODY_LIMIT_BYTES` vào mục deploy).
- Không sửa frontend, không sửa `nginx.conf`.
- Không thêm dependency.

## Tiêu chí hoàn thành
- K1: Body 300 KB → 413, server không tăng bộ nhớ theo kích thước gửi lên (đọc dừng sớm); body 10 KB hợp lệ → xử lý bình thường.
- K2: Body `{abc` → 400 `Invalid JSON body` (không phải 500). Body `[1,2]` → 400.
- K3: Activity với `metadata` lồng `{ a: { b: 1 }, c: "x" }` → lưu `{ c: "x" }`; 30 key → lưu 20 key; chuỗi 1.000 ký tự → cắt còn 200.
- K4: `action: "DROP TABLE"` → 400; `level: "critical"` → lưu `info`.
- K5: Lỗi không mong đợi (giả lập trong test) → response 500 `{ error: "Server error" }`, không lộ message gốc.
- K6: `npm run lint`, `npm test`, `npm run build` xanh; mọi test cũ pass.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path server/index.mjs -Pattern "const body = async"
npm run lint; npm test; npm run build
git add server README.md
git commit -m "fix(F-9): limit request body size, reject invalid json, validate activity payloads"
git push -u origin fix/f9-api-request-body-limits
git log --oneline -1 origin/fix/f9-api-request-body-limits
git fetch origin
git ls-remote --heads origin fix/f9-api-request-body-limits
git rev-parse --short HEAD
```
Kỳ vọng:
- `git diff --stat` chỉ có file trong Ràng buộc.
- Select-String không có kết quả.
- lint/test/build xanh.
- `git ls-remote` in đúng 1 dòng, SHA trùng `git rev-parse`.

## Báo cáo
Output Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md` + bảng `K | tên test | pass`.
