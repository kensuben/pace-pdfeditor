# [F-14] Ẩn danh Word: tab/xuống dòng là ranh giới khi nhận diện, nhãn ở chữ thường áp cho giá trị trong chữ đã xoá

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/word-anonymizer/01-PLAN.md` mục 8.
Tiền điều kiện: W-14 đã merge (PR #53). Làm **song song được với W-15c** (W-15c chỉ sửa `entitySuggest.ts` / `inspect.ts`).
Nhánh: `fix/f14-stream-separators-label-context` (tạo từ `main`) · Commit: `fix(F-14): treat tabs and breaks as boundaries, apply field labels across current and deleted text`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f14-stream-separators-label-context
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình.
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề (Claude chạy trên `main` @ `10f2e1e`, file .docx giả)
Đoạn văn thử (mỗi dòng 1 `w:p`, `⇥` = `<w:tab/>`, `↵` = `<w:br/>`, `[xoá]` = `w:del/w:delText`):
```
Đại diện:⇥Ông NGƯỜI ĐẠI DIỆN TEST 02⇥Chức vụ: Giám đốc       (entity "NGƯỜI ĐẠI DIỆN TEST 02")
Liên hệ: lienhe.test@example.com↵Tiếp theo
MST:⇥0101234567⇥Điện thoại: 0912 345 678
Địa chỉ:⇥[xoá]Số 1 Đường Test, Hà Nội
Mã số thuế:⇥[xoá]0101234567
```
Kết quả hiện tại:
- **A.** "Ông NGƯỜI ĐẠI DIỆN TEST 02" **không được thay** (residual WARN `body-text`).
- **B.** Email bị che **lẹm sang dòng sau và làm hỏng chữ**: `l****@e****.comTi` + `ếp theo`.
- **C.** Địa chỉ và MST trong **chữ đã xoá** (nhãn ở chữ thường) **không được che**, và residual **không báo**.
- **D.** MST `0101234567` đứng trước tab **không được che** (residual WARN).

Nguyên nhân (đọc code):
1. `src/word-anonymizer/core/textReplace.ts`, `replaceNodeListText` (~dòng 151):
   - luồng chữ chỉ nối `textContent` của `w:t` (hoặc `w:delText`);
   - `w:tab`, `w:br`, `w:cr`, `w:noBreakHyphen` **không** tạo ký tự nào → "TEST 02" dính "Chức" thành "TEST 02Chức", "example.com" dính "Tiếp" thành "example.comTiếp";
   - ranh giới từ và regex email/số vì thế sai.
2. Chế độ `mask` (W-13) chạy luồng `w:delText` **riêng**. Nhãn "Địa chỉ:", "Mã số thuế:" nằm ở `w:t` nên không có trong luồng → `sensitive.ts` không thấy nhãn → không nhận địa chỉ/MST.
3. `residual.ts` quét `w:delText` cũng không có ngữ cảnh nhãn → không báo.

## Logic cần đạt
1. **Ký tự ngăn cách ảo:** khi dựng luồng chữ của một đoạn (cả luồng `w:t` lẫn luồng `w:delText`):
   - duyệt các run **theo thứ tự tài liệu**;
   - `w:tab`, `w:ptab` → chèn `\t`; `w:br`, `w:cr` → chèn `\n`; `w:noBreakHyphen` → `-`; `w:softHyphen` → không chèn;
   - ký tự ảo **không** thuộc node nào (không có `nodeRange`), không bao giờ được ghi lại vào XML.
   - Không có span thay thế nào được **vắt qua** ký tự ảo `\t` hoặc `\n`. Nếu regex khớp vắt qua thì cắt span tại ký tự ảo đầu tiên; với email/SĐT/số thì bỏ hẳn span đó.
2. **Luồng "gốc" cho chữ đã xoá (`mask`):**
   - Với mỗi đoạn có `w:delText`, dựng luồng gốc = `w:t` **không** nằm trong `w:ins` + `w:delText`, theo thứ tự tài liệu, có ký tự ảo như mục 1.
   - Chạy nhận diện (entity → từ khoá → nhạy cảm, đúng thứ tự hiện có) trên luồng gốc.
   - **Chỉ áp** các phần của span rơi vào node `w:delText`. Phần rơi vào `w:t` đã do lượt `w:t` xử lý, **không** sửa lại (giữ nguyên tắc thay một lượt của W-14).
   - Lượt `w:t` hiện có giữ nguyên, chỉ thêm ký tự ảo.
3. **Residual:** quét `w:delText` theo luồng gốc như mục 2 (có nhãn từ `w:t`), cũng có ký tự ảo. Còn sót → `deleted-text` như hiện tại. Quét `w:t` cũng dùng ký tự ảo.
4. **Hiệu năng:** tuyến tính. Tài liệu 2.000 đoạn, mỗi đoạn 3 tab → `anonymizeDocx` không chậm hơn bản hiện tại quá 30%. Đo trung vị 3 lần, ghi số liệu trong báo cáo.
5. GIỮ NGUYÊN: định dạng che, ưu tiên, chế độ `remove`/`keep`, từ khoá W-14, mọi test cũ.

## Ràng buộc
- Chỉ được sửa:
  - `src/word-anonymizer/core/textReplace.ts`, `residual.ts`, `anonymize.ts` (chỉ nếu cần truyền thêm tham số);
  - `src/word-anonymizer/__tests__/fixtures.ts` (chỉ thêm);
  - test mới `src/word-anonymizer/__tests__/f14-*.test.ts`.
- KHÔNG sửa `entitySuggest.ts`, `inspect.ts` (W-15c đang sửa song song), `WordAnonymizerPage.tsx`, `src/pdf-editor/**`, test có sẵn.

  Test cũ trượt → **DỪNG**, báo tên test + lý do, không tự sửa.
- Không thêm dependency. Dữ liệu giả như mục Vấn đề.

## Tiêu chí hoàn thành
- K1: đoạn A → `Ông Người đại diện 2` + tab + `Chức vụ: Giám đốc` (tab giữ nguyên trong XML).
- K2: đoạn B → dòng 1 thành `Liên hệ: l****@e****.com`, dòng 2 **giữ nguyên** `Tiếp theo`.
- K3: đoạn "MST:⇥0101234567⇥Điện thoại: 0912 345 678" → `*******567` và `09******78`.
- K4 (`mask`): "Địa chỉ:⇥[xoá]Số 1 Đường Test, Hà Nội" → `w:delText` thành `****, Hà Nội`. "Mã số thuế:⇥[xoá]0101234567" → `*******567`. Nhãn `w:t` giữ nguyên.
- K5: residual trên file **gốc** (chưa ẩn danh) với nội dung K4 → có finding `deleted-text` cho địa chỉ và MST. Trên file đã ẩn danh → `PASS`.
- K6: entity tách giữa `w:t` và `w:delText` ("Đại diện: Bà NGƯỜI ĐẠI " + [xoá]"DIỆN TEST 05") với entity `NGƯỜI ĐẠI DIỆN TEST 05`:
  - không còn mảnh "DIỆN TEST 05" trong `w:delText`;
  - phần ở `w:t` xử lý theo luồng `w:t` (ghi rõ kết quả thực tế trong báo cáo);
  - residual không báo sót nhầm.
- K7: thay một lượt vẫn đúng (test W-14 K7 cũ pass).
- K8 (hiệu năng): số liệu theo mục 4.
- K9: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần** đều **0 failed**.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
git add src/word-anonymizer
git commit -m "fix(F-14): treat tabs and breaks as boundaries, apply field labels across current and deleted text"
git push -u origin fix/f14-stream-separators-label-context
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f14-stream-separators-label-context
git rev-parse --short HEAD
git log --oneline -1 origin/fix/f14-stream-separators-label-context
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z, **dòng tổng kết vitest cả 2 lần**. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- cách dựng ký tự ảo và luồng gốc;
- số liệu hiệu năng;
- danh sách `TODO(verify)`.
