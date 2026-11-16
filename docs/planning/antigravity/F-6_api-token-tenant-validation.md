# [F-6] API: chỉ nhận token của tenant PACE (kiểm `iss`/`tid`), gắn user theo `oid`, fail-closed khi cấu hình sai

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: F-4 đã merge vào `main` (PR #18).
Nhánh: `fix/f6-api-token-tenant-validation` (tạo từ `main`) · Commit: `fix(F-6): validate issuer and tenant of id tokens, bind users to oid, fail closed on bad auth config`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/fix/f6-api-token-tenant-validation` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.** Bắt buộc chạy **Bước Z** trong `00_RULES.md`.

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f6-api-token-tenant-validation
npm ci
```

## Vấn đề (R1 trong `docs/word-anonymizer/01-PLAN.md`)
Quyết định của chủ dự án (Q-F6a): App Registration là **single-tenant**, chỉ tài khoản trong tenant PACE được dùng.

- `server/index.mjs:7`: `MICROSOFT_TENANT_ID` mặc định `'common'`. `:9-10`: khi là `common` thì JWKS lấy từ `organizations`.
- `server/index.mjs:20`: `jwtVerify(token, jwks, { audience: clientId })` **chỉ kiểm `aud`**, không kiểm `iss` và `tid`. Khoá ký của Microsoft Entra dùng chung giữa các tenant, nên chỉ kiểm chữ ký + `aud` là chưa đủ để chắc token do tenant PACE cấp.
- `server/index.mjs:21-24`: user được xác định bằng `preferred_username`/`email` (claim hiển thị, Microsoft khuyến cáo không dùng để phân quyền). `oid` chỉ được trả về (`:25`), không được lưu hay đối chiếu. Nếu một tài khoản bị xoá rồi tài khoản khác được tạo lại cùng UPN, tài khoản mới sẽ thừa hưởng quyền cũ (kể cả admin).
- `clientId` rỗng (`:7`) vẫn khởi động server.
- `deploy/docker-compose.prod.yml:44` và `deploy/.env.production.example:6` mặc định `common`.

Repo đang **public** nên mô tả lỗ hổng này ai cũng đọc được → ưu tiên cao.

## Logic cần đạt
1. **Fail-closed khi cấu hình sai**: lúc khởi động, nếu `MICROSOFT_CLIENT_ID` không phải GUID, hoặc `MICROSOFT_TENANT_ID` không phải GUID (gồm rỗng, `common`, `organizations`, `consumers`) → in lỗi rõ ràng (không in giá trị secret, client ID chỉ in 8 ký tự đầu) và `process.exit(1)`. Không có giá trị mặc định cho 2 biến này.
2. **Xác thực token** (tách thành module `server/auth.mjs`, export hàm tạo verifier nhận `{ clientId, tenantId, jwks }` để test được với JWKS local):
   - JWKS: `https://login.microsoftonline.com/<tenantId>/discovery/v2.0/keys`.
   - `jwtVerify` với `audience: clientId`, `issuer: https://login.microsoftonline.com/<tenantId>/v2.0`, `algorithms: ['RS256']`. Ghi `// TODO(verify)` cho định dạng `iss` của id_token v2.0 kèm tài liệu đối chiếu (Microsoft identity platform: "ID token claims reference", "Validate tokens").
   - Kiểm thêm `payload.tid === tenantId` (so chữ thường). Thiếu `oid` hoặc `tid` → 401.
   - Lỗi xác thực token trả **401** với message chung `Invalid token`; không trả chi tiết lỗi của `jose` ra client (chỉ `console.error` phía server, không log token).
3. **Gắn user theo `oid`**:
   - User đã có `oid` → bắt buộc `payload.oid` khớp. Khác `oid` → **403** và ghi 1 log `level: 'security'`, `action: 'auth.identity_mismatch'`, metadata `{ userId }` (không ghi token, không ghi email).
   - User chưa có `oid` (dữ liệu cũ, hoặc mới được admin thêm theo email) → ở lần đăng nhập hợp lệ đầu tiên, lưu `oid` và `tid` vào user rồi `save()`.
   - Bootstrap admin (`ADMIN_EMAILS`) tạo mới thì lưu luôn `oid`/`tid`.
   - Email (`preferred_username`) vẫn dùng để khớp allowlist lần đầu và hiển thị.
4. **Không cho sửa `oid`/`tid` qua API admin**: `POST`/`PATCH /api/admin/users` bỏ qua hai trường này (và `id`, `createdAt`) trong body.
5. **Cấu hình deploy**:
   - `deploy/docker-compose.prod.yml`: `MICROSOFT_CLIENT_ID: ${MICROSOFT_CLIENT_ID:?…}` và `MICROSOFT_TENANT_ID: ${MICROSOFT_TENANT_ID:?…}`, bắt buộc có, kèm thông báo lỗi tiếng Việt ngắn.
   - `deploy/.env.production.example`: tenant là GUID giả `00000000-0000-0000-0000-000000000000` kèm comment "Directory (tenant) ID của PACE — không dùng common/organizations".
   - `compose.yaml` (dev local): đổi mặc định `common` của API thành bắt buộc có giá trị, tương tự như trên.
6. **README** (mục "Cấu hình Microsoft Login" và "Deploy production (VPS)"):
   - App là single-tenant.
   - `VITE_MICROSOFT_TENANT_ID` (GitHub Variables) và `MICROSOFT_TENANT_ID` (VPS) đều phải là **Directory (tenant) ID dạng GUID**.
   - API sẽ không khởi động nếu sai.
   - Lần đăng nhập đầu sau khi cập nhật, user cũ được gắn `oid` tự động.
7. GIỮ NGUYÊN: route và response format của API (trừ mã lỗi 401/403 như trên), cơ chế allowlist theo email, frontend (`src/auth.ts`, `src/api.ts`), cấu trúc `store.json` (chỉ thêm 2 trường vào user).

## Ràng buộc
- Chỉ sửa / tạo:
  - `server/index.mjs`
  - `server/auth.mjs` (mới)
  - `server/__tests__/auth.test.mjs` (mới; agent được chọn đuôi `.ts`, ghi rõ)
  - `deploy/docker-compose.prod.yml`, `deploy/.env.production.example`, `compose.yaml`
  - `README.md`
  - `vitest.config.ts`, chỉ khi bắt buộc để chạy test server (vd. thêm `include`); ưu tiên dùng `// @vitest-environment node` trong file test.
- Không thêm dependency (dùng `jose` sẵn có: `generateKeyPair`, `exportJWK`, `createLocalJWKSet`, `SignJWT`).
- Test dùng tenant/client GUID giả (`11111111-1111-1111-1111-111111111111`, `22222222-2222-2222-2222-222222222222`), email `@example.com`. Không gọi mạng tới Microsoft.
- `Dockerfile.api` copy cả thư mục `server/` → không cần sửa; xác nhận lại trong báo cáo. Thư mục test trong image chấp nhận được; nếu muốn loại thì ghi lý do.

## Tiêu chí hoàn thành
Mỗi K có test tự động (JWKS local, ký token bằng `SignJWT`):
- K1: Token hợp lệ (đúng `aud`, `iss`, `tid`, có `oid`, email trong allowlist) → xác thực thành công.
- K2: Token đúng chữ ký nhưng `tid` là tenant khác → bị từ chối (401).
- K3: Sai `iss` (vd. `.../<tenant khác>/v2.0` hoặc thiếu `/v2.0`) → 401. Sai `aud` → 401. Token hết hạn → 401.
- K4: User cũ chưa có `oid` đăng nhập hợp lệ → `oid`/`tid` được lưu; lần sau dùng `oid` khác cùng email → 403 và có log `auth.identity_mismatch` (không chứa token/email).
- K5: Khởi động với `MICROSOFT_TENANT_ID` = `common` / `organizations` / rỗng, hoặc `MICROSOFT_CLIENT_ID` rỗng → tiến trình thoát mã ≠ 0 với thông báo rõ (test bằng `child_process` chạy `node server/index.mjs` với env tương ứng và `DATA_FILE` trỏ thư mục tạm).
- K6: `PATCH /api/admin/users/:id` với body `{ "oid": "x", "tid": "y", "id": "z" }` → không đổi các trường này (test ở mức hàm lọc dữ liệu hoặc HTTP, agent chọn và ghi rõ).
- K7: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config` hợp lệ; bỏ `MICROSOFT_TENANT_ID` khỏi env → `config` báo lỗi bắt buộc.
- K8: `npm run lint`, `npm test`, `npm run build` xanh; mọi test cũ vẫn pass.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path server/index.mjs,server/auth.mjs -Pattern "'common'|organizations"
Select-String -Path server/auth.mjs -Pattern "issuer|tid|algorithms"
Select-String -Path deploy/docker-compose.prod.yml,compose.yaml -Pattern "MICROSOFT_TENANT_ID"
npm run lint; npm test; npm run build
git add server deploy/docker-compose.prod.yml deploy/.env.production.example compose.yaml README.md
if (git diff --name-only -- vitest.config.ts) { git add vitest.config.ts }
git commit -m "fix(F-6): validate issuer and tenant of id tokens, bind users to oid, fail closed on bad auth config"
git push -u origin fix/f6-api-token-tenant-validation
git log --oneline -1 origin/fix/f6-api-token-tenant-validation
```
Kỳ vọng:
- `git diff --stat` chỉ có các file trong Ràng buộc.
- Select-String thứ 1 chỉ được còn kết quả trong thông báo lỗi hoặc danh sách giá trị bị từ chối (giải thích từng dòng).
- Select-String thứ 2 có kết quả cho cả `issuer`, `tid`, `algorithms`.
- Select-String thứ 3 cho thấy cả 2 file dùng dạng `${MICROSOFT_TENANT_ID:?…}`.
- lint/test/build xanh.
- Dòng cuối in commit vừa push, rồi chạy Bước Z.

## Báo cáo
Output `git rev-parse` của Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md`, thêm:
- Bảng `K | tên test | pass`.
- Định dạng `iss` đã dùng và nguồn đối chiếu (hoặc "chưa xác minh").
- Danh sách việc người vận hành phải làm trên VPS trước khi deploy bản này (đặt `MICROSOFT_TENANT_ID` là GUID trong `deploy/.env.production`; kiểm GitHub Variable `VITE_MICROSOFT_TENANT_ID`).
