# [F-8] API quản trị user: chỉ nhận field hợp lệ, không cho mất admin cuối cùng (R3)

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: F-7 đã merge vào `main` (PR #22). F-8 → F-9 → F-10 cùng sửa `server/index.mjs`, **làm tuần tự**.
Nhánh: `fix/f8-admin-user-api-validation` (tạo từ `main`) · Commit: `fix(F-8): whitelist admin user fields, protect last active admin`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/fix/f8-admin-user-api-validation` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.** Bắt buộc chạy **Bước Z** trong `00_RULES.md`.

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f8-admin-user-api-validation
npm ci
```

## Vấn đề (R3 trong `docs/word-anonymizer/01-PLAN.md`)
- `server/index.mjs:114-143` (`POST /api/admin/users`) và `:144-157` (`PATCH /api/admin/users/:id`) dùng `sanitizeUserInput` (`server/auth.mjs:71`). Hàm này chỉ loại `id`/`createdAt`/`oid`/`tid`, rồi `Object.assign(item, input, …)`. Hệ quả: admin vẫn ghi được **field tuỳ ý** vào user (vd. `foo`, `__proto__`-like keys, `role: "superadmin"`, `active: "yes"`, `groupIds: "x"`). Riêng POST tạo mới có kiểm `role`/`active`; nhánh cập nhật user đã có và PATCH thì không.
- Không có gì chặn admin **tự hạ quyền / tự khoá chính mình** hoặc hạ/khoá **admin active cuối cùng**. Khi đó không ai vào được Administration; muốn khôi phục phải sửa tay `store.json` trên VPS.
- `groupIds` không được kiểm là group có thật.

## Logic cần đạt
1. Tách logic vào `server/users.mjs` (mới), gồm hàm thuần, dễ test:
   - `normalizeUserPatch(input, { groups })`: chỉ giữ `name` (chuỗi trim, 1–100 ký tự), `role` (`'admin' | 'user'`), `active` (boolean thật), `groupIds` (mảng chuỗi, chỉ giữ id có trong `groups`, bỏ trùng). Field khác bị bỏ qua. Sai kiểu thì trả lỗi 400 có message tiếng Việt (vd. `role không hợp lệ`).
   - `assertAdminInvariant({ users, targetId, patch, actorId })`: ném lỗi 409 nếu sau khi áp `patch` **không còn admin nào `active`**. Ném lỗi 409 nếu `actorId === targetId` và patch hạ `role` của chính mình khỏi `admin` hoặc đặt `active: false`.
2. `POST /api/admin/users`: email phải đúng định dạng email cơ bản (có `@`, có tên miền), viết thường; trùng email thì cập nhật bằng `normalizeUserPatch` + `assertAdminInvariant`, không `Object.assign` input thô.
3. `PATCH /api/admin/users/:id`: dùng `normalizeUserPatch` + `assertAdminInvariant`. `id`, `email`, `createdAt`, `oid`, `tid` không bao giờ đổi qua API.
4. Mỗi thay đổi `role`/`active` của user ghi 1 log `level: 'security'`, `action: 'admin.user_updated'`, metadata `{ targetUserId, changedFields }` (chỉ tên field, không ghi email).
5. GIỮ NGUYÊN: route, format response thành công, cơ chế allowlist/bootstrap admin, `sanitizeUserInput` (có thể giữ hoặc thay bằng hàm mới — ghi rõ).

## Ràng buộc
- Chỉ sửa/tạo: `server/index.mjs`, `server/users.mjs` (mới), `server/__tests__/users.test.mjs` (mới). Được sửa `server/auth.mjs` chỉ nếu bỏ `sanitizeUserInput`; ghi lý do.
- Không sửa frontend. Nếu `src/AdminPage.tsx` cần hiện lỗi 409 khác cách hiện tại, ghi vào báo cáo, không tự sửa.
- Không thêm dependency. Test dùng dữ liệu giả `@example.com`.

## Tiêu chí hoàn thành
- K1: PATCH với `{ "foo": 1, "role": "superadmin" }` → 400; với `{ "foo": 1, "name": "Học viên Test 01" }` → 200 và user không có field `foo`.
- K2: `active: "yes"` → 400; `groupIds: ["<id không tồn tại>", "<id có thật>"]` → chỉ giữ id có thật.
- K3: Store có 1 admin active → PATCH hạ admin đó thành `user` hoặc `active: false` → 409; store không đổi.
- K4: Admin tự PATCH chính mình `role: "user"` → 409, kể cả khi còn admin khác.
- K5: Có 2 admin active → admin A hạ admin B thành `user` → 200; có log `admin.user_updated` với `changedFields: ["role"]`, không chứa email.
- K6: POST email sai định dạng (`abc`) → 400.
- K7: `npm run lint`, `npm test`, `npm run build` xanh; mọi test cũ pass.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path server/index.mjs -Pattern "Object.assign\(item, input"
npm run lint; npm test; npm run build
git add server
git commit -m "fix(F-8): whitelist admin user fields, protect last active admin"
git push -u origin fix/f8-admin-user-api-validation
git log --oneline -1 origin/fix/f8-admin-user-api-validation
git fetch origin
git ls-remote --heads origin fix/f8-admin-user-api-validation
git rev-parse --short HEAD
```
Kỳ vọng:
- `git diff --stat` chỉ có file trong `server/`.
- Select-String không có kết quả.
- lint/test/build xanh.
- `git ls-remote` in đúng 1 dòng, SHA trùng `git rev-parse`.

## Báo cáo
Output Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md` + bảng `K | tên test | pass` + ghi chú cho frontend (nếu có).
