# [W-0] Chuẩn bị: pin dependency, thêm Vitest, bỏ tên file khỏi activity log

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Nhánh: `chore/w0-pin-deps-vitest-log-pii` (tạo từ `main`) · Commit: `chore(W-0): pin dependencies, add vitest, drop file names from activity log`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/chore/w0-pin-deps-vitest-log-pii` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
```powershell
git checkout main
git pull --ff-only
git checkout -b chore/w0-pin-deps-vitest-log-pii
npm ci
```

## Vấn đề
- `package.json` có nhiều dependency `"latest"` (`react`, `vite`, `pdf-lib`, `pdfjs-dist`, `lucide-react`, `typescript`, `eslint`…). Nếu lockfile bị tạo lại, build sẽ không tái lập được, và CI sắp thêm (W-3) cần build ổn định.
- Repo chưa có test framework. Task W-1 cần chạy unit test có `DOMParser` (jsdom).
- `src/App.tsx` gửi `fileName` lên server qua activity log ở 5 chỗ: `document.opened`, `document.open_failed`, `document.exported`, `document.export_failed`, `signature.digital_completed`. Tên file thường chứa tên học viên/khách hàng (PII), vi phạm quy tắc log trong `00_RULES.md`.

## Logic cần đạt
1. Mọi dependency `"latest"` → version chính xác **đang có trong `package-lock.json`** (không nâng cấp). Các dependency `^x.y.z` → pin về version đang khoá.
2. Thêm devDependency `vitest`, `jsdom` (pin chính xác). Script `"test": "vitest run"`. Cấu hình `environment: 'jsdom'` cho test (trong `vite.config.ts` hoặc `vitest.config.ts`, agent chọn và ghi rõ).
3. Thêm 1 test mẫu `src/__tests__/smoke.test.ts` kiểm tra `DOMParser` tồn tại và parse được XML có namespace.
4. 5 log trên: bỏ `fileName`; thay bằng `fileExt` (vd. `pdf`) nếu hữu ích. Giữ `fileSize`, `pageCount`, `annotationCount`, `mode`. Không đổi tên action, không đổi level.

## Ràng buộc
- Chỉ sửa `package.json`, `package-lock.json`, `vite.config.ts` (hoặc tạo `vitest.config.ts`), `src/App.tsx` (chỉ 5 lời gọi log), thêm `src/__tests__/smoke.test.ts`.
- Không đổi hành vi giao diện.
- `tsconfig` chỉ sửa nếu bắt buộc để test chạy được; ghi rõ trong báo cáo.

## Tiêu chí hoàn thành
- K1: `package.json` không còn `"latest"`, `^`, `~`.
- K2: `npm ci` chạy sạch từ lockfile; `npm run lint`, `npm test`, `npm run build` xanh.
- K3: `src/App.tsx` không còn `fileName` trong lời gọi log.
- K4: Mở PDF, xuất PDF trên `npm run dev` vẫn hoạt động; Activity log hiện event không có tên file.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path package.json -Pattern '"latest"|"\^|"~'
Select-String -Path src/App.tsx -Pattern 'fileName'
npm run lint; npm test; npm run build
git add package.json package-lock.json vite.config.ts src
if (Test-Path vitest.config.ts) { git add vitest.config.ts }
git commit -m "chore(W-0): pin dependencies, add vitest, drop file names from activity log"
git push -u origin chore/w0-pin-deps-vitest-log-pii
git log --oneline -1 origin/chore/w0-pin-deps-vitest-log-pii
```
Kỳ vọng: 2 lệnh Select-String không còn kết quả (với `App.tsx`: không còn `fileName` trong lời gọi `log(`; nếu còn ở chỗ khác ngoài log, giải thích); lint/test/build xanh; dòng cuối in commit vừa push.

## Báo cáo
2 output `git push` + `git log origin/...` ở đầu, rồi theo `00_RULES.md` + bảng `package | trước | sau` cho các dependency đã pin.
