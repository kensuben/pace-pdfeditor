# [F-5] Trang Ẩn danh Word: chặn tải bằng bàn phím khi FAIL, bỏ kết quả cũ khi đổi cấu hình, sửa tràn 390px, ghi chú đăng nhập giả lập DEV

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: W-2 đã merge vào `main` (PR #14).
Nhánh: `fix/f5-word-ui-qa-fixes` (tạo từ `main`) · Commit: `fix(F-5): lock download on FAIL for keyboard, reset stale results, fix 390px overflow, document DEV mock login`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/fix/f5-word-ui-qa-fixes` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.** Bắt buộc chạy **Bước Z** trong `00_RULES.md`.

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f5-word-ui-qa-fixes
npm ci
```

## Vấn đề
QA W-2 chạy Playwright với file .docx giả và phát hiện:
1. **Khoá tải khi FAIL bị vượt qua bằng bàn phím.** `src/word-anonymizer/WordAnonymizerPage.tsx:831-840`: nút tải là `<a href={downloadBlobUrl} download=…>`, khi FAIL chưa xác nhận thì chỉ bị chặn bằng CSS `pointerEvents: 'none'` + `opacity`. Đo thực tế: Tab tới link rồi nhấn Enter vẫn tải được file (`DOWNLOADED-via-keyboard`).
2. **Kết quả cũ không bị xoá khi đổi cấu hình.** `handleLabelChange` (`:169`), `handleInitialsChange` (`:183`) và các `setOptions` (`:574`, `:588`, `:609`, `:626`, `:643`) không xoá `anonymizeResult`, `residualReport`, `downloadBlobUrl`. Đo thực tế: sau khi chạy, sửa nhãn thì nút "Tải tài liệu đã ẩn danh" vẫn hiện và vẫn trả file cũ. Ví dụ hậu quả: chạy xong mới bật "Xoá ngày giờ" rồi tải → file vẫn còn ngày giờ.
3. **Tràn chữ ở 390px.** Trong khung "Tùy chọn ẩn danh", mô tả `small` của `.word-option-label` và ô `select` của `.word-select-row` (`src/word-anonymizer/word-anonymizer.css:354-400`) bị cắt ở mép phải khung. Trang không cuộn ngang nhưng chữ bị che.
4. **Đăng nhập giả lập ở DEV chưa có ghi chú.** `src/App.tsx:579` (`if (import.meta.env.DEV)`) tạo tài khoản giả `Học viên Test 01` khi chưa cấu hình Microsoft. Chủ dự án quyết định **giữ** (Q-F5a) nhưng phải ghi chú trong README.

## Logic cần đạt
1. **Khoá thật khi FAIL chưa xác nhận**: không render `<a href>` (hoặc không có thuộc tính `href`/`download`); thay bằng `<button type="button" disabled>` cùng nội dung. Bàn phím, chuột, trình đọc màn hình đều không tải được. Tick "Tôi đã hiểu rủi ro" → nút tải hoạt động như bình thường. PASS và WARN không đổi.
2. **Bỏ kết quả cũ**: mọi thay đổi nhãn, initials hoặc tuỳ chọn ẩn danh sau khi đã chạy → xoá `anonymizeResult`, `residualReport`, revoke và xoá `downloadBlobUrl`, reset `acknowledgeRisk`. Hiện dòng nhắc *"Cấu hình đã thay đổi — bấm "Ẩn danh tài liệu" để tạo lại file."*. Hai tuỳ chọn tải (giữ tên gốc, mapping JSON) **không** làm mất kết quả.
3. **390px**: chữ mô tả tự xuống dòng trong khung; `select` rộng tối đa 100% khung, xếp xuống dưới nhãn khi màn hẹp. Không đổi giao diện ở 768/1280px.
4. **README**: trong mục "Chạy dự án" thêm ghi chú: khi chạy `npm run dev` mà chưa cấu hình `VITE_MICROSOFT_CLIENT_ID`, nút đăng nhập dùng tài khoản giả `Học viên Test 01` để thử giao diện; chỉ có ở chế độ DEV, **không có trong bản build production**; gọi API vẫn lỗi vì không có token thật. Đồng thời thêm comment ngắn ở `src/App.tsx:579` trỏ tới mục README này.
5. GIỮ NGUYÊN: hành vi đăng nhập giả lập (không xoá), mọi hành vi đã đạt ở W-2 (K1–K6), phần core.

## Ràng buộc
- Chỉ sửa:
  - `src/word-anonymizer/WordAnonymizerPage.tsx`
  - `src/word-anonymizer/word-anonymizer.css`
  - `src/word-anonymizer/__tests__/WordAnonymizerPage.test.tsx`
  - `src/App.tsx` (chỉ thêm comment tại dòng DEV mock)
  - `README.md` (chỉ mục "Chạy dự án")
- Không sửa `src/word-anonymizer/core/*`.
- Không thêm dependency.

## Tiêu chí hoàn thành
- K1: File cho kết quả FAIL, chưa tick xác nhận → trong DOM không có `a[href]` tải file; nút tải `disabled`; Tab + Enter không tạo download. Tick xác nhận → tải được. Có test tự động cho trạng thái DOM.
- K2: Chạy xong → sửa 1 nhãn → khối kết quả và nút tải biến mất, dòng nhắc hiện ra; chạy lại → file mới chứa nhãn mới. Lặp lại với bật `removeDates` → file mới không còn `w:date`. Đổi "Giữ tên gốc" không làm mất kết quả. Có test tự động.
- K3: 390px: không có phần tử nào trong khung "Tùy chọn ẩn danh" tràn ra ngoài khung (`scrollWidth <= clientWidth` của khung). 768/1280px không đổi. Đính kèm ảnh chụp 390px.
- K4: README có ghi chú đăng nhập giả lập DEV; `npm run build` rồi tìm chuỗi `mock-account-id` trong `dist/assets/*.js` → không có kết quả.
- K5: `npm run lint`, `npm test`, `npm run build` xanh; tất cả test cũ vẫn pass.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path src/word-anonymizer/WordAnonymizerPage.tsx -Pattern "pointerEvents"
npm run lint; npm test; npm run build
Select-String -Path dist/assets/*.js -Pattern "mock-account-id"
Select-String -Path README.md -Pattern "giả lập|Học viên Test 01"
git add src/word-anonymizer src/App.tsx README.md
git commit -m "fix(F-5): lock download on FAIL for keyboard, reset stale results, fix 390px overflow, document DEV mock login"
git push -u origin fix/f5-word-ui-qa-fixes
git log --oneline -1 origin/fix/f5-word-ui-qa-fixes
```
Kỳ vọng:
- `git diff --stat` chỉ có các file trong Ràng buộc.
- Select-String `pointerEvents` không có kết quả.
- lint/test/build xanh.
- Select-String trên `dist` không có kết quả.
- Select-String trên README có ít nhất 1 dòng.
- Dòng cuối in commit vừa push, rồi chạy Bước Z.

## Báo cáo
Output `git rev-parse` của Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md`, thêm:
- Bảng `K | cách kiểm | kết quả`.
- Ảnh chụp 390px của khung "Tùy chọn ẩn danh" và trạng thái FAIL chưa xác nhận.
