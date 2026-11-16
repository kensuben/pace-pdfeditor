# [F-7] Chuẩn hoá tenant ID về chữ thường, bổ sung biến API vào `.env.example`

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: F-6 đã merge vào `main` (PR #20).
Nhánh: `fix/f7-tenant-lowercase-dev-env` (tạo từ `main`) · Commit: `fix(F-7): normalize tenant and client id to lowercase, add api auth vars to .env.example`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/fix/f7-tenant-lowercase-dev-env` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.** Bắt buộc chạy **Bước Z** trong `00_RULES.md`.

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f7-tenant-lowercase-dev-env
npm ci
```

## Vấn đề
QA F-6 phát hiện:
1. **Tenant ID viết HOA làm hỏng toàn bộ đăng nhập.** `server/auth.mjs:9` chỉ `trim()` tenant ID; `:28` trả nguyên giá trị. `createTokenVerifier` ghép `issuer` = `https://login.microsoftonline.com/<tenantId>/v2.0` và `jose` so `iss` chính xác từng ký tự. Đo thực tế: cấu hình `ABCDEF12-3456-7890-ABCD-EF1234567890`, token có `iss` chữ thường → **mọi token hợp lệ bị từ chối** (401). Người vận hành dán GUID viết hoa là cả hệ thống không đăng nhập được. Client ID cũng nên chuẩn hoá để so `aud` ổn định.
2. **`.env.example` thiếu biến cho API.** Từ F-6, `compose.yaml` (dev local) bắt buộc `MICROSOFT_CLIENT_ID` và `MICROSOFT_TENANT_ID` (trước đây dùng lại `VITE_*`). Nhưng `.env.example` chỉ có `VITE_MICROSOFT_CLIENT_ID`/`VITE_MICROSOFT_TENANT_ID`, và comment ở dòng tenant vẫn gợi ý `"common"`. Làm theo README thì `docker compose up` local sẽ lỗi "required variable".

## Logic cần đạt
1. `validateAuthConfig` trả `clientId` và `tenantId` đã `trim()` + **`toLowerCase()`**. Mọi kiểm tra (GUID, danh sách cấm) chạy trên giá trị đã chuẩn hoá.
2. `createTokenVerifier`: dù được gọi trực tiếp với giá trị viết hoa (ví dụ từ test), vẫn tự chuẩn hoá `tenantId`/`clientId` về chữ thường trước khi ghép `issuer` và `audience`.
3. `.env.example`:
   - Sửa comment tenant: chỉ dùng Directory (tenant) ID dạng GUID của PACE, **không** dùng `common`.
   - Thêm `MICROSOFT_CLIENT_ID` và `MICROSOFT_TENANT_ID` (cho API khi chạy `compose.yaml`) với giá trị GUID giả `00000000-0000-0000-0000-000000000000`, kèm comment "thường bằng giá trị VITE_* tương ứng".
4. README mục "Cấu hình Microsoft Login", bước 4: liệt kê đủ 4 biến (`VITE_MICROSOFT_CLIENT_ID`, `VITE_MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID`), nói rõ biến nào dùng cho frontend, biến nào cho API.
5. GIỮ NGUYÊN: mọi hành vi đã đạt ở F-6 (từ chối `tid`/`iss`/`aud` sai, gắn `oid`, fail-closed khi cấu hình sai).

## Ràng buộc
- Chỉ sửa `server/auth.mjs`, `server/__tests__/auth.test.mjs`, `.env.example`, `README.md` (chỉ mục "Cấu hình Microsoft Login").
- `.env.example` chỉ chứa giá trị giả. KHÔNG đọc, tạo hay sửa file `.env` thật.
- Không thêm dependency.

## Tiêu chí hoàn thành
- K1: Test: `validateAuthConfig({ tenantId: 'ABCDEF12-3456-7890-ABCD-EF1234567890', clientId: <GUID viết hoa> })` trả cả hai giá trị chữ thường. Token có `iss`/`tid`/`aud` chữ thường → **chấp nhận**.
- K2: Test: gọi `createTokenVerifier` trực tiếp với tenant viết hoa → token hợp lệ vẫn được chấp nhận.
- K3: Tenant `COMMON` (viết hoa) vẫn bị từ chối khi khởi động (thoát mã ≠ 0).
- K4: `.env.example` có đủ 4 biến `*_CLIENT_ID`/`*_TENANT_ID`, không còn chữ `common` trong gợi ý giá trị tenant. `docker compose -f compose.yaml --env-file .env.example config` chạy không lỗi.
- K5: `npm run lint`, `npm test`, `npm run build` xanh; mọi test F-6 vẫn pass.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path server/auth.mjs -Pattern "toLowerCase"
Select-String -Path .env.example -Pattern "MICROSOFT_CLIENT_ID|MICROSOFT_TENANT_ID|common"
docker compose -f compose.yaml --env-file .env.example config > $null; $LASTEXITCODE
npm run lint; npm test; npm run build
git add server/auth.mjs server/__tests__/auth.test.mjs .env.example README.md
git commit -m "fix(F-7): normalize tenant and client id to lowercase, add api auth vars to .env.example"
git push -u origin fix/f7-tenant-lowercase-dev-env
git log --oneline -1 origin/fix/f7-tenant-lowercase-dev-env
```
Kỳ vọng:
- `git diff --stat` chỉ có 4 file trên.
- Select-String `toLowerCase` có kết quả cho cả tenant lẫn client ID.
- Select-String trên `.env.example` có 4 dòng biến `*_CLIENT_ID`/`*_TENANT_ID`; chữ `common` chỉ còn trong câu "không dùng common".
- `$LASTEXITCODE` in `0`.
- lint/test/build xanh.
- Dòng cuối in commit vừa push, rồi chạy Bước Z.

## Báo cáo
Output `git rev-parse` của Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md` + bảng `K | tên test | pass`.
