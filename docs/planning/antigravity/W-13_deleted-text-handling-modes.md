# [W-13] Ẩn danh Word: chữ đã xoá (Track Changes) được che như chữ thường, hoặc bỏ hẳn, theo lựa chọn của người dùng

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/word-anonymizer/01-PLAN.md` (mục 8, quyết định Q-W1).
Tiền điều kiện: W-8b **không** liên quan (khác module). Làm từ `main` mới nhất.
Nhánh: `feat/w13-deleted-text-modes` (tạo từ `main`) · Commit: `feat(W-13): deleted tracked-change text modes (mask by default, remove, keep with warning)`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w13-deleted-text-modes
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề (đọc trên `main` @ `f450449`)
1. Hợp đồng thường được sửa bằng Track Changes. Khối thông tin pháp nhân (tên công ty, người đại diện, địa chỉ, điện thoại, MST) hay nằm trong **chữ đã xoá** (`w:del` → `w:r` → `w:delText`). Người dùng gửi ảnh chụp minh hoạ: toàn bộ khối Bên A/Bên B là chữ gạch đỏ.
2. Việc thay thế chỉ chạy trên `w:t`:
   - `src/word-anonymizer/core/textReplace.ts:18-30` (`getDirectParagraphTNodes` chỉ lấy `w:t`);
   - `replaceTextInXmlDocument` `:305-320`, được gọi ở `anonymize.ts:699-720` cho mọi `word/*.xml`.

   `w:delText` **giữ nguyên** → tên, SĐT, MST, địa chỉ trong chữ đã xoá **vẫn nằm trong file gửi cho AI**.
3. Đây là quyết định Q3 của W-5 ("không che chữ đã xoá, chỉ cảnh báo"):
   - giao diện hiện cảnh báo "sẽ **KHÔNG** được che hay thay thế" (`WordAnonymizerPage.tsx:1114-1132`);
   - `inspect.ts` có `scanDeletedText`;
   - `residual.ts:270-306` xếp loại `deleted-text`.
4. **Quyết định mới của chủ dự án (Q-W1, 2026-11-21):** cho người dùng chọn; **mặc định là che**.

## Logic cần đạt
1. **Kiểu & tuỳ chọn** (`core/types.ts`):
   - `export type DeletedTextMode = 'mask' | 'remove' | 'keep'`.
   - `AnonymizeOptions.deletedTextMode?: DeletedTextMode`, mặc định `'mask'` khi không truyền.
   - `ScanResidualOptions.deletedTextMode?`, cùng mặc định.
   - `AnonymizeReplacements` thêm `deletedRunsRemoved: number`.
2. **`'mask'`:** che/thay chữ đã xoá **đúng như chữ thường** (pháp nhân/người đại diện, email/SĐT/CCCD/MST/STK/địa chỉ theo `maskKinds`/`keepValues`).
   - Trong mỗi đoạn `w:p`, coi các `w:delText` (theo thứ tự tài liệu) là **một luồng chữ riêng**, tách khỏi luồng `w:t`. Chạy cùng thuật toán của `replaceParagraphText` (khớp xuyên nhiều run, NFC, nguyên từ, ưu tiên entity → nhạy cảm) trên luồng đó.
   - Gợi ý: tham số hoá `getDirectParagraphTNodes(p, localName: 't' | 'delText')`.
   - **Giữ nguyên cấu trúc** `w:del` (tác giả đã ẩn danh, ngày tháng theo tuỳ chọn hiện có). Người duyệt vẫn thấy chỗ bị xoá, chỉ nội dung bị che.
   - Thống kê thay thế cộng vào `replacements` như chữ thường.
3. **`'remove'`:**
   - Xoá mọi `w:del` có chứa `w:delText` hoặc `w:delInstrText` ở **mọi** `word/*.xml` (gồm `comments.xml`, header/footer, footnotes/endnotes). Tương đương bấm "Accept" cho các thay đổi xoá chữ.
   - Đếm vào `deletedRunsRemoved`.
   - Không đụng `w:del` nằm trong `w:rPr` (đánh dấu xoá dấu đoạn) và `w:ins`.
   - `w:moveFrom` chưa xác minh cách Word lưu chữ → ghi `TODO(verify)`, **không** xoá trong task này, liệt kê trong báo cáo.
   - Sau khi xoá, file phải mở được: test bằng việc parse lại XML và giữ đủ `w:body`.
4. **`'keep'`:** giữ nguyên hành vi hiện tại (không đụng chữ đã xoá, vẫn cảnh báo).
5. **Residual** (`scanResidual`):
   - `'mask'` / `'remove'`: chuỗi còn sót trong `w:delText` là **rò rỉ**, xếp loại `deleted-text`, làm trạng thái tối thiểu `WARN` (giống chữ thường).
   - `'keep'`: phát hiện trong `w:delText` vẫn liệt kê (loại `deleted-text`) nhưng **không** làm trạng thái xấu đi. Ghi rõ "theo lựa chọn giữ nguyên chữ đã xoá".
6. **Giao diện** (`WordAnonymizerPage.tsx`), trong thẻ tuỳ chọn:
   - Nhóm radio "**Chữ đã xoá (Track Changes)**":
     - "Che như chữ thường (khuyến nghị)" (mặc định);
     - "Bỏ hẳn phần chữ đã xoá";
     - "Giữ nguyên (chỉ cảnh báo)".
   - Cảnh báo `deletedHits` hiện có (`:1114-1132`) đổi theo chế độ:
     - `keep`: giữ nội dung hiện tại;
     - `mask`: chuyển thành thông báo thông tin "Các nội dung sau trong chữ đã xoá sẽ được che/thay thế";
     - `remove`: "Phần chữ đã xoá sẽ bị bỏ khỏi file xuất".
   - Đổi chế độ sau khi đã chạy → hiện "Cấu hình đã thay đổi" như các tuỳ chọn khác.
   - Truyền `deletedTextMode` cho cả `anonymizeDocx` và `scanResidual`.
7. **Activity log:** chỉ thêm metadata `deletedTextMode` và `deletedRunsRemoved` (số). Không ghi nội dung.
8. GIỮ NGUYÊN: mọi hành vi W-1…W-5, F-10 với chữ thường, ẩn danh tác giả bản sửa, comment, metadata.

## Ràng buộc
- Chỉ được sửa:
  - `src/word-anonymizer/core/types.ts`, `textReplace.ts`, `anonymize.ts`, `residual.ts`;
  - `src/word-anonymizer/WordAnonymizerPage.tsx`;
  - `src/word-anonymizer/word-anonymizer.css` (nếu cần);
  - `src/word-anonymizer/__tests__/fixtures.ts` (chỉ **thêm** khả năng dựng fixture);
  - test mới `src/word-anonymizer/__tests__/w13-*.test.ts(x)`.
- KHÔNG sửa `src/pdf-editor/**`, `server/`, `public/`, test có sẵn.
- Không thêm dependency.
- Dữ liệu test giả: `Công ty TNHH Mẫu Thử`, `Người Đại Diện Test 01`, `0912 345 678`, `0101234567`, `Số 1 Đường Test, Hà Nội`, `lienhe.test@example.com`.

## Tiêu chí hoàn thành
Fixture chung `F`: `document.xml` có một đoạn với:
- `w:t` "Bên A: ";
- `w:del` chứa hai run `w:delText` liên tiếp "Công ty TNHH " + "Mẫu Thử" (tách run);
- tiếp theo `w:del` chứa "Điện thoại: 0912 345 678, MST 0101234567, địa chỉ tại Số 1 Đường Test, Hà Nội".

Entity tổ chức = `Công ty TNHH Mẫu Thử`.

- K1 (`mask`, mặc định không truyền tuỳ chọn):
  - nối các `w:delText` của đoạn → có `Pháp nhân A`, SĐT `09******78`, MST `*******567`, địa chỉ `****, Hà Nội`; **không** còn `Mẫu Thử`, `0912 345 678`, `0101234567`;
  - số phần tử `w:del` không đổi;
  - `w:t` "Bên A: " giữ nguyên;
  - `scanResidual` → `PASS`.
- K2 (`remove`):
  - không còn `w:delText` nào trong `document.xml`;
  - `deletedRunsRemoved ≥ 2`;
  - "Bên A: " còn;
  - XML parse lại được;
  - `scanResidual` → `PASS`.
- K3 (`keep`):
  - `w:delText` giữ nguyên văn bản gốc;
  - `scanResidual` có phát hiện loại `deleted-text` nhưng `status` **không** vì thế mà thành `WARN`/`FAIL` (trường hợp chỉ có chữ đã xoá chứa dữ liệu).
- K4 (`mask` trong `comments.xml` và header): fixture có `w:delText` "0912 345 678" trong comment và trong header → cả hai được che.
- K5: `w:delText` dạng NFD (`Mẫu` viết tổ hợp) vẫn khớp entity (`mask`).
- K6 (`mask`, nhiều run): entity bị tách ở 3 run `w:delText` khác nhau trong cùng đoạn → được thay đúng 1 lần, không sót mảnh.
- K7: test giao diện (jsdom, theo mẫu `WordAnonymizerPage.test.tsx`) → có 3 radio, mặc định chọn "Che như chữ thường"; đổi sang "Giữ nguyên" thì hiện cảnh báo có chữ "KHÔNG".
- K8: `npm run lint`, `npm run build` xanh. `vitest run` kết thúc, mọi test cũ pass.
- K9 (Claude kiểm tra khi QA): file .docx giả có khối Bên A/Bên B trong Track Changes, thử cả 3 chế độ, mở file kết quả bằng LibreOffice/pdf để xem chữ đã xoá.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/word-anonymizer/core/types.ts -Pattern "DeletedTextMode"
Select-String -Path src/word-anonymizer/core/textReplace.ts -Pattern "delText"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/word-anonymizer
git commit -m "feat(W-13): deleted tracked-change text modes (mask by default, remove, keep with warning)"
git push -u origin feat/w13-deleted-text-modes
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- 2 lệnh Select-String: có kết quả.
- lint/build xanh; vitest kết thúc, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w13-deleted-text-modes
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w13-deleted-text-modes
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- cách tách luồng `w:delText`;
- danh sách phần tử bị xoá ở chế độ `remove`;
- danh sách `TODO(verify)`.
