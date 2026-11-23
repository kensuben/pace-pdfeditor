# [F-16] PDF Editor: chữ sửa giữ đúng font Be Vietnam Pro / Arimo, khung bao không cắt ngang ô đang sửa

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (bảng 2.2: B23, B24).
Tiền điều kiện: W-9c đã merge (PR #68).
Nhánh: `fix/f16-font-detection-bbox-overlay` (tạo từ `main`) · Commit: `fix(F-16): detect Be Vietnam Pro and Arimo base fonts, hide bounding box of the item being edited`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Commit message phải đúng nguyên văn như trên.** W-9a, W-9b, W-9c đều sai message. Sau khi commit:
- chạy `git log -1 --format=%s`;
- nếu khác nguyên văn → `git commit --amend -m "<message đúng>"` **trước** khi push.

**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.** W-9c đã báo "done" khi chưa push.

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f16-font-detection-bbox-overlay
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Vấn đề (Claude chạy thử trên `main` @ `2c07d06`, PDF mẫu của hướng dẫn, dữ liệu giả)
1. **B23 – chữ sửa xuất ra font khác font gốc.**
   - PDF mẫu dùng Be Vietnam Pro. `BaseFont` thực tế đọc được: `/BeVietnamPro-Regular-5465`, `/BeVietnamPro-Bold-2336`. Hậu tố `-5465` do pdf-lib thêm; file từ phần mềm khác thường có tiền tố subset dạng `ABCDEF+BeVietnamPro-Regular`.
   - `styleFromBaseFont` (`src/pdf-editor/fonts.ts` dòng 37-56) chỉ trả `Helvetica | Times Roman | Courier`, nên `BeVietnamPro` rơi vào `Helvetica`.
   - Khi xuất, `resolveExportFontFamily('Helvetica', text có dấu)` → `Arimo`. Đoạn "Điều 1" sau khi sửa ra **Arimo**, các đoạn xung quanh vẫn Be Vietnam Pro → lệch kiểu chữ rõ.
   - App đã đóng gói đủ 4 biến thể Be Vietnam Pro và Arimo (`src/pdf-editor/fonts/`, dùng khi xuất từ F-11) và đã nạp webfont tương ứng (`src/main.tsx`), nhưng không bao giờ được chọn cho chữ gốc.
2. **B24 – khung bao nét đứt cắt ngang ô đang sửa.**
   - Khi bật "Hiện khung bao" và đang sửa một vùng, lớp khung bao (`PdfCanvas.tsx` ~dòng 560-576, `className="bounding-box-region"`, `zIndex: 44`) vẫn vẽ khung của **chính vùng đang sửa**.
   - Đường viền dưới của khung cũ chạy ngang qua dòng chữ trong ô sửa (ảnh `public/huong-dan/img/26-pdf-sua-doan.jpg`).
   - Annotation đang sửa (`bounding-box-annotation`, ~dòng 578-596) cũng bị tương tự.

## Logic cần đạt
1. **`styleFromBaseFont`** (`fonts.ts`):
   - kiểu trả về `family` mở rộng thành `'Helvetica' | 'Times Roman' | 'Courier' | 'Be Vietnam Pro' | 'Arimo'`;
   - chuẩn hoá tên trước khi so:
     - bỏ tiền tố subset `^[A-Z]{6}\+`;
     - bỏ hậu tố số `-\d+$`;
     - so trên chuỗi chữ thường đã **bỏ ký tự không phải chữ cái**, ví dụ `BeVietnamPro-Bold` → `bevietnamprobold`;
   - thứ tự kiểm (dừng ở điều kiện đầu tiên khớp):
     - (1) chứa `bevietnam` → `Be Vietnam Pro`;
     - (2) chứa `arimo` → `Arimo`;
     - (3)–(5) giữ nguyên quy tắc cũ: courier/mono → Courier; times/georgia/garamond/cambria hoặc serif không có sans → Times Roman; còn lại Helvetica;
   - `bold` / `italic` giữ nguyên regex cũ (áp lên tên đã bỏ tiền tố). Ví dụ `BeVietnamPro-SemiBold` → `bold: true` (khi xuất chỉ có Regular/Bold).
2. **Không đổi** `resolveExportFontFamily`: đã trả đúng `Be Vietnam Pro` / `Arimo` khi được yêu cầu. Kiểm lại bằng test K3.
3. **Khung bao** (`PdfCanvas.tsx`):
   - khi `inlineEdit` đang mở cho vùng `id = X` (`kind: 'region'`) → **không** vẽ `bounding-box-region` của `X`;
   - khi `inlineEdit` mở cho annotation `id = Y` (`kind: 'annotation'`) → **không** vẽ `bounding-box-annotation` của `Y`;
   - đóng ô sửa → khung hiện lại như cũ. Các khung khác giữ nguyên.
4. GIỮ NGUYÊN:
   - W-9a/b/c: xoá thật, cảnh báo, probe màu, khối đoạn, reflow;
   - `familyFromFontLabel`, `cssFontStack`, cách xuất;
   - mọi test cũ, kể cả `w9b-*` K2 (Arial-BoldMT, Times-Italic, Courier-BoldOblique, Helvetica phải ra kết quả như cũ).

## Ràng buộc
- Chỉ được sửa:
  - `src/pdf-editor/fonts.ts` (chỉ `styleFromBaseFont` và kiểu trả về);
  - `src/pdf-editor/textExtraction.ts` (chỉ khi cần sửa kiểu cho khớp, không đổi logic);
  - `src/pdf-editor/PdfCanvas.tsx` (chỉ 2 khối khung bao);
  - test mới `src/pdf-editor/__tests__/f16-*.test.ts(x)`.
- KHÔNG sửa test có sẵn. Test cũ trượt → **DỪNG**, báo tên test + lý do, không tự sửa.
- Không thêm dependency, không thêm file font.

## Tiêu chí hoàn thành
- K1 (`styleFromBaseFont`):
  - `BeVietnamPro-Regular-5465` → `{ Be Vietnam Pro, false, false }`;
  - `ABCDEF+BeVietnamPro-Bold` → `{ Be Vietnam Pro, true, false }`;
  - `BeVietnamPro-BoldItalic` → `{ Be Vietnam Pro, true, true }`;
  - `BeVietnamPro-SemiBold` → `bold: true`;
  - `QWERTY+Arimo-Italic` → `{ Arimo, false, true }`;
  - 4 trường hợp K2 của W-9b ra như cũ.
- K2 (probe + enrich, pdf.js thật):
  - fixture pdf-lib nhúng `src/pdf-editor/fonts/BeVietnamPro-Regular.ttf` và `BeVietnamPro-Bold.ttf` (đọc bằng `fs`, `registerFontkit`, `subset: true`);
  - 2 dòng `Học viên Test 01` (Regular) và `Điều 1. Nội dung` (Bold);
  - `probeTextStyles` + `groupTextItemsIntoLines` + `enrichRegionsWithStyles` → vùng 1 `fontFamily: 'Be Vietnam Pro'`, `bold: false`; vùng 2 `Be Vietnam Pro`, `bold: true`.
- K3 (xuất): sửa vùng 1 thành `Học viên Test 09` qua `buildReplacementAnnotation` → `buildEditedPdfWithReport`:
  - trong `/Resources/Font` của trang có `BaseFont` mới chứa `BeVietnamPro`;
  - **không** có font mới chứa `Arimo`;
  - pdf.js trích ra `Học viên Test 09`, không còn `Test 01`.
- K4 (jsdom): render `PdfCanvas` với `showBoundingBoxes` và 2 vùng, bấm vùng 1 để mở ô sửa:
  - **không** còn `.bounding-box-region` của vùng 1, vẫn còn của vùng 2;
  - `Esc` → khung vùng 1 hiện lại.
- K5 (jsdom): tương tự K4 cho annotation chữ đang sửa (`.bounding-box-annotation`).
- K6: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed**.
- K7 (Claude kiểm tra khi QA, agent không làm):
  - PDF mẫu của hướng dẫn: sửa đoạn "Điều 1" → ô sửa và file xuất dùng Be Vietnam Pro;
  - bật khung bao lúc đang sửa → không còn nét đứt cắt ngang ô sửa.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/fonts.ts -Pattern "bevietnam","arimo"
Select-String -Path src/pdf-editor/PdfCanvas.tsx -Pattern "inlineEdit" | Measure-Object
git diff --stat -- src/pdf-editor/__tests__/ src/pdf-editor/exportPdf.ts src/pdf-editor/engine/
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
git add src/pdf-editor
git commit -m "fix(F-16): detect Be Vietnam Pro and Arimo base fonts, hide bounding box of the item being edited"
git log -1 --format=%s
git push -u origin fix/f16-font-detection-bbox-overlay
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- `bevietnam`, `arimo` có trong `fonts.ts`.
- Diff `exportPdf.ts`, `engine/`: rỗng. Thư mục test: chỉ file `f16-*` mới.
- `git log -1 --format=%s` in **đúng** message trên.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f16-font-detection-bbox-overlay
git rev-parse --short HEAD
git log --oneline -1 origin/fix/f16-font-detection-bbox-overlay
```
- `git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`.
- Dòng `git log` phải là `<sha> fix(F-16): detect Be Vietnam Pro and Arimo base fonts, hide bounding box of the item being edited`.

Rỗng/lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z, **dòng tổng kết vitest cả 2 lần**. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- quy tắc chuẩn hoá tên font đã dùng;
- danh sách `TODO(verify)`.
