# [F-18] PDF Editor: dòng đơn sửa dài hơn được kéo sang phải trước khi xuống dòng, dòng "Nhãn: giá trị" không bị gộp thành khối

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm (đặc biệt mục **Ba điều bắt buộc** và **Bước Y**).
Tiền điều kiện: F-17 đã merge (PR #74).
Nhánh: `fix/f18-single-line-extend-label-lines` (tạo từ `main`) · Commit: `fix(F-18): extend single-line replacements to available width and keep label lines out of paragraph blocks`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi Bước Y in `PUSH OK` – dòng đó là dòng ĐẦU TIÊN của báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f18-single-line-extend-label-lines
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Vấn đề (Claude chạy thử trên `main` @ `b564926`, PDF giả font Times, dữ liệu giả)
1. **B26 – dòng đơn bị ngắt dòng quá sớm.**
   - Sửa tiêu đề `CONG VAN SO 01/2026` (Times-Bold 14) thành `CÔNG VĂN SỐ 01/2026` → file xuất thành **2 dòng** (`CÔNG VĂN SỐ` / `01/2026`), dù bên phải còn trống cả trang.
   - Nguyên nhân: `exportPdf.ts` (~dòng 337, 399) ngắt dòng theo `boxWidth = a.width * width`, tức đúng bề rộng chữ cũ, kể cả khi vùng chỉ có **một dòng** (không có `originalLineRects`).
   - Bản xem (`PdfCanvas.tsx` ~dòng 522-530, `.annotation.replacement`, `white-space: pre-wrap`, `width = display.width`) cũng ngắt sớm như vậy.
   - Acrobat cho dòng đơn kéo dài sang phải tới chỗ trống trước khi xuống dòng.
2. **B27 – dòng dạng "Nhãn: giá trị" bị gộp thành khối.**
   - Hai dòng `Kinh gui: Hoc vien Test 01` / `Dia chi: So 1 Duong Test, Ha Noi` (cùng font, thẳng lề, cách 20pt, cỡ 13) bị `groupLinesIntoBlocks` (`textExtraction.ts` ~dòng 343, điều kiện a–f của W-9c) gộp làm một khối.
   - Người dùng bấm sửa dòng "Kính gửi", chọn hết (Ctrl+A) rồi gõ → mất luôn dòng "Địa chỉ".
   - Điều kiện (b) "hàng xóm cùng hàng" chỉ bắt được khi nhãn và giá trị là **2 vùng riêng**. Ở đây chúng nằm trong **một** lệnh vẽ chữ.

## Logic cần đạt
1. **Bề rộng tối đa cho dòng đơn** (`textEdit.ts`, `buildReplacementAnnotation`):
   - chỉ áp khi `region.lineRects` **không có** (vùng một dòng);
   - tính `maxWidth` (tỉ lệ 0–1 theo bề rộng trang) = `limit − region.x`, với `limit` là giá trị **nhỏ nhất** trong:
     - (a) mép trái của vùng gần nhất **cùng hàng, bên phải** trong `neighbors`, trừ khe `0.5 × region.fontSize` (đổi sang tỉ lệ). Cùng hàng = tâm dọc lệch ≤ 0.42 × chiều cao lớn hơn, và `neighbor.x ≥ region.x + region.width − 0.001`;
     - (b) **mép phải nội dung trang** = lớn nhất `x + width` của mọi vùng `source: 'native'` không xoay trong `neighbors` (không nhỏ hơn mép phải của chính vùng);
   - `maxWidth` không nhỏ hơn `region.width`;
   - thêm trường tuỳ chọn `maxWidth?: number` vào `Annotation` (`src/types.ts`).
   - Để tính (b) đúng: chuỗi tham số chỉ có **tỉ lệ**; cần bề rộng trang (pt) để đổi `fontSize` → tỉ lệ thì thêm tham số tuỳ chọn `pageWidthPt?: number` cuối hàm (mặc định bỏ qua khe ở (a) nếu không có). `App.tsx` truyền bề rộng trang lấy từ nguồn sẵn có. Nguồn nào dùng được thì **ghi trong báo cáo**; không chắc → `TODO(verify)`.
2. **Xuất** (`exportPdf.ts`, nhánh `replaceOriginal`):
   - không có `originalLineRects` và có `a.maxWidth` → bề rộng ngắt dòng = `max(boxWidth, a.maxWidth * width)`;
   - có `originalLineRects` (khối) → **giữ nguyên** `boxWidth` như W-9c;
   - căn lề giữa/phải tính theo bề rộng ngắt dòng mới;
   - kết quả **1 dòng** → vẫn gọi `drawText` **một lần với tham số như hiện tại**, chỉ khác `maxWidth` = bề rộng mới. Test `K6` của `export-rotation.test.ts` phải pass **không sửa**;
   - `overflowPages` vẫn tính như cũ.
3. **Bản xem** (`PdfCanvas.tsx`, chỉ phần render annotation `replaceOriginal`): annotation có `maxWidth` và không có `originalLineRects` → `width` của div = `a.maxWidth`, để bản xem ngắt dòng cùng chỗ với file xuất. Khung chọn (`SelectionFrame`) và khung bao giữ theo `a.width`.
4. **Không gộp dòng nhãn** (`textExtraction.ts`, `groupLinesIntoBlocks`):
   - hàm thuần mới `isLabelLine(text: string): boolean`: dòng bắt đầu bằng **nhãn ngắn** rồi dấu hai chấm. Regex gợi ý (cờ `u`): `/^[\p{L}\p{N}][\p{L}\p{N} .\/()&-]{0,39}:(\s|$)/u`, nhãn tối đa **6 từ**;
   - trong `canMerge(P, L, …)`:
     - `isLabelLine(L.text)` → **không** nối `L` vào khối (L luôn bắt đầu khối mới);
     - `isLabelLine(P.text)` và `P` **không đầy** (mép phải < mép phải lớn nhất của 2 dòng − 2 × fontSize) → không nối;
   - đoạn văn bắt đầu bằng "Lưu ý: …" mà dòng 1 đầy vẫn gộp với dòng tiếp theo (không phải dòng nhãn);
   - các điều kiện a–f của W-9c **giữ nguyên**.
5. GIỮ NGUYÊN: W-9a/b/c, F-16, F-17; text box thêm mới; engine; phím tắt.

## Ràng buộc
- Chỉ được sửa:
  - `src/types.ts` (chỉ thêm `maxWidth?: number` vào `Annotation`);
  - `src/pdf-editor/textEdit.ts`, `src/pdf-editor/exportPdf.ts`, `src/pdf-editor/textExtraction.ts`;
  - `src/pdf-editor/PdfCanvas.tsx` (chỉ `width` của annotation thay chữ);
  - `src/App.tsx` (chỉ truyền `pageWidthPt` trong `editTextRegion`);
  - `src/pdf-editor/index.ts`;
  - test mới `src/pdf-editor/__tests__/f18-*.test.ts(x)`.
- KHÔNG sửa test có sẵn. Test cũ trượt → **DỪNG**, báo tên test + lý do, không tự sửa.
- Không thêm dependency.

## Tiêu chí hoàn thành
- K1 (`buildReplacementAnnotation`): vùng đơn `x 0.1, width 0.3`; neighbors có vùng cùng hàng ở `x 0.6` và vùng khác hàng có mép phải `0.9` → `maxWidth ≈ 0.5 − khe` (±0.01). Không có vùng cùng hàng → `maxWidth ≈ 0.8` (tới mép phải nội dung 0.9). Vùng khối (có `lineRects`) → `maxWidth` undefined.
- K2 (xuất, pdf.js thật):
  - fixture Times-Bold 14 `CONG VAN SO 01/2026` ở x=70 trên trang 595pt, thêm 1 dòng thân văn kéo tới x≈520;
  - sửa thành `CÔNG VĂN SỐ 01/2026` qua `buildReplacementAnnotation` (có `pageWidthPt`) → xuất ra **1 dòng** (một lệnh vẽ chữ, pdf.js trích ra nguyên chuỗi trên cùng toạ độ y), `overflowPages = []`.
- K3: chuỗi dài hơn `maxWidth` → vẫn xuống dòng ở `maxWidth`, cỡ chữ giữ nguyên.
- K4 (hồi quy khối): đoạn 3 dòng của W-9c (test K8 cũ) vẫn ngắt theo bề rộng khối.
- K5 (`isLabelLine`):
  - `true`: `Kính gửi: Học viên Test 01`, `Địa chỉ: Số 1 Đường Test`, `Email: test@example.com`, `Mã số thuế:`;
  - `false`: `Bên B cung cấp chương trình đào tạo kỹ năng quản trị cho cán bộ: theo đề cương` (nhãn dài hơn 6 từ), `• Mục 1`, `Hôm nay, ngày 05 tháng 01`.
- K6 (`groupLinesIntoBlocks`):
  - 2 dòng `Kính gửi: …` / `Địa chỉ: …` (dữ liệu như Vấn đề 2) → **2 vùng riêng**;
  - đoạn 2 dòng bắt đầu `Lưu ý: …` với dòng 1 đầy → **1 khối**.
- K7: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed**, gồm toàn bộ test `w9c-*` và `export-rotation` K6.
- K8 (Claude kiểm tra khi QA, agent không làm):
  - PDF giả font Times: tiêu đề sửa dài hơn vẫn 1 dòng ở bản xem và file xuất;
  - 2 dòng "Kính gửi / Địa chỉ" sửa riêng được;
  - đoạn "Điều 1" của PDF mẫu hướng dẫn vẫn là 1 khối.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/textEdit.ts -Pattern "maxWidth"
Select-String -Path src/pdf-editor/textExtraction.ts -Pattern "isLabelLine"
git diff --stat -- src/pdf-editor/__tests__/ src/pdf-editor/engine/
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- `maxWidth`, `isLabelLine` có kết quả.
- Diff `engine/`: rỗng. Thư mục test: chỉ file `f18-*` mới.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

Sau đó chạy **Bước Y** (`00_RULES.md`) với:
```powershell
$Branch = 'fix/f18-single-line-extend-label-lines'
$Msg    = 'fix(F-18): extend single-line replacements to available width and keep label lines out of paragraph blocks'
$Paths  = @('src/types.ts', 'src/App.tsx', 'src/pdf-editor')
$Expect = 1
```

## Báo cáo
Dòng đầu là `PUSH OK: …`. Sau đó theo `00_RULES.md` (output Bước A, toàn bộ output Bước Y, tổng kết vitest 2 lần), cộng thêm:
- bảng `K | tên test | pass`;
- nguồn bề rộng trang (`pageWidthPt`) đã dùng trong `App.tsx`;
- regex `isLabelLine` cuối cùng và ví dụ đúng/sai;
- danh sách `TODO(verify)`.
