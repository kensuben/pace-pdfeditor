# [F-10] Ẩn danh Word: residual tôn trọng lựa chọn giữ/tắt của người dùng; nhận địa chỉ viết liền không có dấu ":"; sửa font hiển thị tiếng Việt

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: W-5 (gồm W-5d) đã merge vào `main` (PR #34).
Nhánh: `fix/f10-residual-options-inline-address` (tạo từ `main`) · Commit: `fix(F-10): pass keep/mask options to residual scan, detect inline address labels`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f10-residual-options-inline-address
npm ci
```
Không dùng `npx` với package ngoài `package.json`; không dùng `cmd /c` với chuỗi nhiều dòng; lệnh chạy lâu phải có giới hạn thời gian.

## Vấn đề (QA W-5, dữ liệu giả)
1. **Báo WARN thừa khi người dùng chủ động giữ hoặc tắt một loại.**
   - `src/word-anonymizer/WordAnonymizerPage.tsx:423` gọi `scanResidual(outArrayBuffer, inspection.identities, extraTargets)` mà **không truyền** tham số thứ 4 `ScanResidualOptions { maskKinds, keepValues }` (`core/residual.ts:15-18`).
   - Bước residual tự quét lại (W-5d) vì vậy coi số điện thoại người dùng **chọn giữ**, hoặc loại người dùng **tắt**, là "bị sót".
   - Đo thực tế: đoạn `Điện thoại: 0912 345 678; Email: lienhe.test@example.com` với `keepValues=['0912345678']` → truyền đủ tham số thì **PASS**, gọi như giao diện thì **WARN**. Kết quả tương tự khi tắt loại `phone`.
   - Lỗi nghiêng về phía an toàn (không khoá nút tải), nhưng làm người dùng mất tin vào kết quả.
2. **Không nhận địa chỉ viết liền không có dấu `:`.**
   - `core/sensitive.ts`, `findAddresses`: chỉ chạy khi chuỗi có `:` (`if (!text.includes(':')) return matches`), và `ADDRESS_LABEL_REGEX` (`:43`) yêu cầu nhãn đứng trước `:`.
   - Đo thực tế: `Bên A: Công ty TNHH Mẫu Thử, địa chỉ tại Số 1 Đường Test, Hà Nội, MST 0101234567, do Ông Người Đại Diện Test 01 làm đại diện` → MST, tên, SĐT được xử lý nhưng **địa chỉ giữ nguyên**, và residual vẫn **PASS** (vì địa chỉ không nằm trong danh sách phát hiện).

3. **Font không đủ dấu tiếng Việt.** Trong thẻ "Thông tin nhạy cảm phát hiện được", cột "Giá trị gốc" và "Sau khi che" dùng font monospace không có đủ glyph tiếng Việt. Ảnh chụp thực tế: `Số 1 Đường Test, Phường Mẫu` hiển thị thành `Sô´1 Đường Test, Phường Mâũ` (dấu tách rời). Chỉ lỗi hiển thị, file kết quả đúng.

## Logic cần đạt
1. **Giao diện:** truyền `{ maskKinds, keepValues }` (đúng giá trị đang dùng cho `anonymizeDocx`) vào `scanResidual`.
2. **Nhãn địa chỉ viết liền** (`core/sensitive.ts`):
   - Thêm các nhãn mở đầu **không cần `:`**, có và không dấu, không phân biệt hoa thường, nguyên từ:
     - `địa chỉ tại`, `có địa chỉ tại`, `trụ sở tại`, `có trụ sở tại`, `trụ sở chính tại`, `địa chỉ trụ sở tại`, `thường trú tại`, `cư trú tại`;
     - `địa chỉ là`, `địa chỉ:`.
   - Vùng địa chỉ bắt đầu ngay sau nhãn và dừng theo **đúng quy tắc của W-5d**: dấu `;`, xuống dòng, ngay trước nhãn dừng (`ADDRESS_STOP_LABEL_REGEX`), tối đa 200 ký tự.
   - Bổ sung điểm dừng cho dạng viết liền:
     - dấu `.` theo sau là khoảng trắng và chữ in hoa;
     - các cụm `, do `, `, đại diện`, `, người đại diện`, `, MST`, `, mã số thuế`, `, điện thoại`, `, email`.
   - Bỏ điều kiện `text.includes(':')` (thay bằng kiểm tra nhanh có chữ "địa chỉ"/"trụ sở"/"trú tại", có và không dấu).
   - Giữ nguyên ưu tiên: entity → email/SĐT/CCCD/MST/STK → địa chỉ (chỉ che phần nằm ngoài các vùng trước).
3. **Không che nhầm:** câu chỉ nhắc tới "địa chỉ" mà không có nhãn trên (vd. `Vui lòng cập nhật địa chỉ email`, `địa chỉ IP`) → không nhận là địa chỉ.
4. **Font:** cột giá trị trong thẻ thông tin nhạy cảm dùng font có đủ dấu tiếng Việt (vd. `font-family: "Be Vietnam Pro", "Arimo", system-ui, sans-serif` + `font-variant-numeric: tabular-nums` để số thẳng cột). Không dùng font monospace cho chữ tiếng Việt.
5. GIỮ NGUYÊN: định dạng che (giữ phần sau dấu phẩy cuối), mọi hành vi đã đạt ở W-5/W-5d, hiệu năng tuyến tính.

## Ràng buộc
- Chỉ sửa:
  - `src/word-anonymizer/WordAnonymizerPage.tsx` (chỉ lời gọi `scanResidual` và class/style của cột giá trị)
  - `src/word-anonymizer/word-anonymizer.css`
  - `src/word-anonymizer/core/sensitive.ts`
  - `src/word-anonymizer/__tests__/*`
- Không sửa `server/`, `public/`, `src/App.tsx`. Không thêm dependency.
- Test dùng dữ liệu giả (`Công ty TNHH Mẫu Thử`, `Người Đại Diện Test 01`, `Số 1 Đường Test`, `@example.com`).

## Tiêu chí hoàn thành
- K1: Test giao diện: fixture có `Điện thoại: 0912 345 678; Email: lienhe.test@example.com`; bỏ chọn che số điện thoại → chạy → residual `PASS`; file còn nguyên `0912 345 678`; email bị che. Tương tự khi tắt loại "Số điện thoại".
- K2: `Bên A: Công ty TNHH Mẫu Thử, địa chỉ tại Số 1 Đường Test, Hà Nội, MST 0101234567, do Ông Người Đại Diện Test 01 làm đại diện` (có 2 entity) → `Bên A: Pháp nhân A, địa chỉ tại ****, Hà Nội, MST *******567, do Ông Người đại diện 1 làm đại diện`. Residual `PASS`.
- K3: `Công ty có trụ sở tại Tòa nhà Test, 123 Đường Mẫu, TP. Hồ Chí Minh. Ngành nghề: đào tạo` → che địa chỉ tới trước `. Ngành`; `Ngành nghề: đào tạo` giữ nguyên.
- K4: `Ông A thường trú tại Số 2 Đường Mẫu, Phường Thử, Đà Nẵng; điện thoại 0987654321` → địa chỉ che, SĐT che.
- K5: Không che nhầm: `Vui lòng cập nhật địa chỉ email của bạn`, `Kiểm tra địa chỉ IP của máy`, `Chúng tôi sẽ gửi tới địa chỉ đã đăng ký` → không có vùng địa chỉ.
- K6: Hiệu năng: `findSensitive` trên `'địa chỉ tại x, '.repeat(20000)` và `'trụ sở tại '.repeat(20000)` mỗi chuỗi < 200 ms. Thời gian tăng tuyến tính: gấp đôi độ dài thì thời gian không quá khoảng 2,5 lần.
- K8: Ảnh chụp thẻ thông tin nhạy cảm (1280px) với địa chỉ `Số 1 Đường Test, Phường Mẫu, Hà Nội`: dấu hiển thị đúng, không tách rời.
- K7: `npm run lint`, `npm test` (phải kết thúc), `npm run build` xanh; mọi test cũ pass.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path src/word-anonymizer/WordAnonymizerPage.tsx -Pattern "scanResidual\("
Select-String -Path src/word-anonymizer/core/sensitive.ts -Pattern "includes\(':'\)"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/word-anonymizer
git commit -m "fix(F-10): pass keep/mask options to residual scan, detect inline address labels"
git push -u origin fix/f10-residual-options-inline-address
```
Kỳ vọng:
- `git diff --stat` chỉ có file trong Ràng buộc.
- Select-String `scanResidual(` cho thấy lời gọi có tham số thứ 4.
- Select-String `includes(':')` không có kết quả trong `findAddresses`.
- lint/build xanh; vitest kết thúc, không in `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f10-residual-options-inline-address
git rev-parse --short HEAD
git log --oneline -1 origin/fix/f10-residual-options-inline-address
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Output Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md` + bảng `K | tên test | pass` + danh sách nhãn địa chỉ đã thêm + thời gian ở K6 + ảnh K8.
