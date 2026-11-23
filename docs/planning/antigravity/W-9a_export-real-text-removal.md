# [W-9a] PDF Editor: xuất PDF xoá thật chữ cũ khi sửa chữ có sẵn, cảnh báo rõ trang nào còn chữ cũ

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (mục 4, 5, 7: Q-P1, Q-P2).
Tiền điều kiện: W-7 (engine, PR #42), F-12 (PR #47), F-15c (PR #61) đã merge.
Nhánh: `feat/w9a-export-real-text-removal` (tạo từ `main`) · Commit: `feat(W-9a): remove original text via content stream engine on export and warn about pages with remaining text`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w9a-export-real-text-removal
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Vấn đề (Claude đọc code trên `main` @ `b2efb11`)
1. **Sửa chữ có sẵn chỉ che, không xoá (B1).**
   - `src/pdf-editor/exportPdf.ts`, `buildEditedPdf` (~dòng 139-171): với annotation `replaceOriginal`, hàm chỉ vẽ **hình chữ nhật màu nền** (`p.drawRectangle`) rồi vẽ chữ mới đè lên.
   - Chữ gốc vẫn nằm trong content stream. Người nhận file copy, tìm kiếm hoặc đưa file vào công cụ AI vẫn đọc được chữ cũ.
   - Test `KNOWN ISSUE B1` (`src/pdf-editor/__tests__/pdfEditor.test.ts` ~dòng 247-252) đang khẳng định lỗi này, có ghi chú "W-9 sẽ đảo test này".
2. **Engine xoá thật đã có nhưng chưa nối vào xuất file.**
   - `src/pdf-editor/engine/textRemoval.ts`: `removeTextInRegions(doc, pageIndex, regions: Rect[]): RemovalReport` (~dòng 42) và `pagesWithRemainingText(reports)` (~dòng 31).
   - Vùng (`Rect`) tính theo **toạ độ PDF mặc định (pt, gốc dưới-trái)**, giống `viewToPdf` trong `src/pdf-editor/pageGeometry.ts`.
   - Quy tắc của engine:
     - lệnh vẽ chữ có **tâm** nằm trong vùng → xoá (`removedOps`);
     - lệnh chạm vùng nhưng tâm nằm ngoài → giữ lại, tăng `keptIntersecting`;
     - chữ trong Form XObject, font Type3, lỗi giải mã → `skipped`.
   - Không chỗ nào ngoài test gọi engine này.
3. **Không có cảnh báo khi chữ cũ còn sót.** Quyết định **Q-P2**:
   - không xoá được thì vẫn cho xuất, nhưng phải cảnh báo rõ **trang nào** còn chữ cũ trước khi tải về;
   - activity log chỉ ghi số trang/số vùng, không ghi nội dung.
4. **Annotation thay chữ không lưu chữ gốc và nguồn gốc.**
   - `buildReplacementAnnotation` (`src/pdf-editor/textEdit.ts`) chỉ chép vị trí/định dạng từ `TextRegion`.
   - Không lưu chữ cũ (`region.text`), nguồn (`region.source`: `'native' | 'ocr'`), vị trí gốc.
   - Vùng OCR là chữ **trong ảnh scan**: engine không xoá được, vẫn phải che.
5. **Ký số dùng cùng bytes xuất.** `signDocument` trong `src/App.tsx` (~dòng 575-590) gọi `buildPdfBytes()` rồi gửi file đi ký. Chữ cũ còn sót sẽ bị "đóng dấu" vào bản ký.

## Logic cần đạt
1. **Lưu thông tin gốc khi thay chữ:**
   - thêm vào `Annotation` (`src/types.ts`) 3 trường **tuỳ chọn**:
     - `originalText?: string`;
     - `originalSource?: 'native' | 'ocr'`;
     - `originalRect?: { x: number; y: number; width: number; height: number }` (toạ độ tỉ lệ 0–1 như `x/y/width/height`).
   - `buildReplacementAnnotation` điền 3 trường từ `region`. Các trường khác giữ nguyên, kể cả `maskPad*`.
   - Annotation cũ (đã lưu local trước W-9a) không có 3 trường này → coi `originalSource` là `'native'`, `originalRect` = khung annotation, bỏ qua kiểm tra sót theo chữ (mục 4).
2. **Xoá thật trước khi vẽ** (`exportPdf.ts`):
   - hàm mới `buildEditedPdfWithReport(bytes, annotations, options?) → Promise<{ bytes: Uint8Array; report: ExportTextReport }>`;
   - `buildEditedPdf` giữ chữ ký cũ, gọi hàm mới và trả `bytes` (không vỡ nơi đang dùng);
   - thứ tự xử lý:
     - (a) nhóm các annotation `type === 'text' && replaceOriginal` theo trang;
     - (b) với mỗi trang có ít nhất 1 annotation `originalSource !== 'ocr'`:
       - dựng vùng = `originalRect` (hoặc khung annotation) **nới thêm** `maskPadX / maskPadTop / maskPadBottom` đúng như phần tính hình chữ nhật che hiện tại;
       - đổi 4 góc sang PDF bằng `viewToPdf(getPageView(page), u, v)`, lấy hình chữ nhật bao;
       - gọi `removeTextInRegions` **một lần cho mỗi trang**, với mọi vùng của trang đó;
     - (c) **sau đó** mới vẽ annotation như hiện tại;
     - engine viết lại `Contents` của trang, nên phải chạy trước mọi lệnh `drawText`/`drawRectangle` của trang đó.
   - **Hình chữ nhật che** chỉ vẽ khi:
     - annotation có `originalSource === 'ocr'` (chữ nằm trong ảnh); **hoặc**
     - trang của nó nằm trong `pagesWithRemainingText` (engine giữ lại lệnh chạm vùng hoặc bỏ qua); **hoặc**
     - trang nằm trong `options.forceMaskPages` (mục 4).

     Các trường hợp còn lại: **không** vẽ hình che, để nền gốc (màu, ảnh, kẻ bảng) hiện ra.
   - `text === ''` (người dùng xoá dòng chữ gốc): vẫn xoá vùng, không vẽ chữ mới.
   - Trang **không** có annotation thay chữ: **không** gọi engine, content stream giữ nguyên byte.
3. **Báo cáo xuất** (export type mới trong `exportPdf.ts`):
   ```ts
   export type RemainingTextReason = 'kept-intersecting' | 'skipped' | 'ocr-image' | 'residual-text'
   export interface ExportTextReport {
     editedPages: number[]            // trang (1-based) có thay chữ
     cleanedPages: number[]           // trang engine xoá sạch, không cần che
     maskedPages: number[]            // trang có vẽ hình che
     warnings: Array<{ page: number; reason: RemainingTextReason; regionCount: number }>
   }
   ```
   - `kept-intersecting` / `skipped` lấy từ `RemovalReport`.
   - `ocr-image`: trang có vùng OCR (chữ trong ảnh chỉ được che, chưa xoá khỏi ảnh).
   - Một trang có thể có nhiều lý do. Sắp theo số trang.
4. **Kiểm tra sót sau khi xuất** (file mới `src/pdf-editor/residualCheck.ts`, hàm thuần dùng `pdfjs-dist`):
   - `findRemainingOriginalText(outBytes, checks: Array<{ page: number; rect: {x,y,width,height}; originalText: string; newText: string }>) → Promise<number[]>` (trang 1-based);
   - chuẩn hoá chuỗi: NFC, gộp khoảng trắng, trim;
   - **bỏ qua** check khi `originalText` rỗng, hoặc `newText` (đã chuẩn hoá) **chứa** `originalText` (người dùng chỉ thêm chữ, không có gì bí mật bị lộ);
   - với mỗi check, lấy text item của trang có hộp bao (toạ độ tỉ lệ 0–1 theo `page.getViewport({ scale: 1 })`) **giao** với `rect` nới 2pt;
     - nối chuỗi các item đó theo thứ tự trả về;
     - nếu chuỗi đã chuẩn hoá **chứa** `originalText` → trang đó còn chữ cũ;
   - cách đổi `item.transform` sang toạ độ viewport: dùng API pdf.js có sẵn trong repo (ví dụ `pdfjs.Util.transform(viewport.transform, item.transform)`). Không chắc tên/chữ ký → ghi `TODO(verify)` và mô tả trong báo cáo.
5. **Nối vào App** (`src/App.tsx`, chỉ trong `buildPdfBytes`, `exportPdf`, `signDocument`):
   - `buildPdfBytes` dùng `buildEditedPdfWithReport`, rồi chạy `findRemainingOriginalText` cho các annotation có `originalText`.
   - Trang bị phát hiện mà **chưa** nằm trong `maskedPages`:
     - dựng lại **một lần** với `forceMaskPages` = các trang đó;
     - thêm warning `residual-text`.
   - Có warning → hỏi người dùng **trước khi tải về và trước khi gửi đi ký**:
     - dùng `window.confirm` (như xoá trang hiện có), nội dung từ hàm thuần `formatRemainingTextWarning(warnings): string` (đặt trong `exportPdf.ts` hoặc `residualCheck.ts`);
     - nội dung tiếng Việt, liệt kê **từng trang** + lý do dễ hiểu:
       - `kept-intersecting`: "chữ cũ nằm chung lệnh vẽ với chữ cần giữ nên chỉ được che bằng nền";
       - `skipped`: "chữ nằm trong khối đặc biệt (Form XObject/Type3) nên chỉ được che bằng nền";
       - `ocr-image`: "chữ nằm trong ảnh scan nên chỉ được che, chưa xoá khỏi ảnh";
       - `residual-text`: "kiểm tra sau khi xuất vẫn tìm thấy chữ cũ";
     - kết thúc bằng câu nhắc: người nhận vẫn có thể copy/tìm thấy chữ cũ; không dùng file này để xoá thông tin nhạy cảm.
     - **Không** đưa nội dung chữ cũ hay chữ mới vào thông báo.
   - Huỷ → không tải về / không gửi đi ký. Ghi log `document.export_cancelled` (hoặc `signature.digital_cancelled` khi ký) với metadata `{ reason: 'remaining_text', pages: '2,5', regionCount }`.
   - Xuất thành công → log `document.exported` như hiện tại, **thêm** metadata `editedPageCount`, `cleanedPageCount`, `remainingTextPages` (chuỗi số trang, rỗng nếu không có).
   - Metadata log **không** chứa chữ.
6. GIỮ NGUYÊN:
   - mọi thứ khác của `buildEditedPdf`: font (F-11), xoay trang / CropBox (F-12), highlight Multiply (F-13), ảnh, nét vẽ;
   - `canRotatePage` (trang có thay chữ vẫn chưa xoay được);
   - UI sửa chữ, `editTextRegion`, `deleteSelected`;
   - engine `src/pdf-editor/engine/**` (chỉ gọi, không sửa). Cần sửa engine → **DỪNG**, báo lý do.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/types.ts` (chỉ thêm 3 trường tuỳ chọn ở mục 1);
  - `src/pdf-editor/textEdit.ts`, `src/pdf-editor/exportPdf.ts`, `src/pdf-editor/residualCheck.ts` (mới), `src/pdf-editor/index.ts`;
  - `src/App.tsx` (chỉ `buildPdfBytes`, `exportPdf`, `signDocument`);
  - test mới `src/pdf-editor/__tests__/w9a-*.test.ts`.
- **Test có sẵn — được sửa đúng 2 test sau, không test nào khác:**
  - `pdfEditor.test.ts`, test `KNOWN ISSUE B1: retains original text…`:
    - đảo thành khẳng định **không còn** `Customer: Hoc vien Test 01`;
    - đổi tên test, bỏ chữ "KNOWN ISSUE";
    - sửa cả 2 comment có cụm "W-9 sẽ đảo test này" (~dòng 247 và 249) cho đúng hành vi mới.
  - `export-rotation.test.ts`, test `K6: standard page produces exact same content stream operations…`:
    - chỉ bỏ các toán tử của **hình chữ nhật che** khỏi `expectedOperators` và bỏ assert `maskCm`;
    - giữ nguyên mọi assert khác (highlight, chữ, ảnh);
    - nếu thứ tự stream thay đổi vì engine viết lại `Contents`, giải thích trong báo cáo.
  - Test khác trượt → **DỪNG**, báo tên test + lý do, không tự sửa.
- Không thêm dependency. Fixture PDF dựng bằng `pdf-lib` với dữ liệu giả (`Hoc vien Test 01`, `@example.com`), không commit file PDF.

## Tiêu chí hoàn thành
- K1 (xoá thật):
  - fixture 3 dòng Helvetica (`Line A` / `Customer: Hoc vien Test 01` / `Line C`);
  - thay dòng 2 bằng `Customer: Test 02` qua `buildReplacementAnnotation` (region `source: 'native'`, `text` = chữ gốc);
  - kết quả:
    - pdf.js **không** trích ra `Hoc vien Test 01`, **có** `Customer: Test 02`;
    - `Line A` / `Line C` lệch ≤ 0.01 pt;
    - `report.cleanedPages = [1]`, `maskedPages = []`, `warnings = []`.
- K2 (xoá dòng): như K1 nhưng `text = ''` → không còn chữ gốc, không vẽ chữ mới, không vẽ hình che.
- K3 (trang xoay / CropBox lệch gốc): trang `/Rotate 90` và trang có MediaBox/CropBox `[100 100 700 500]` (cùng kiểu fixture F-12):
  - thay đúng dòng mục tiêu → dòng đó bị xoá;
  - các dòng còn lại còn nguyên.
- K4 (giữ lại vì chạm vùng):
  - fixture một lệnh `Tj` dài, vùng thay chỉ phủ ~40% (như `T-D1` của W-7);
  - kết quả:
    - `warnings` có `{ page: 1, reason: 'kept-intersecting' }`, `maskedPages = [1]`;
    - content stream có lệnh vẽ hình che.
- K5 (OCR): annotation `originalSource: 'ocr'` → `warnings` có `ocr-image`, `maskedPages` chứa trang. Không gọi engine cho trang chỉ có vùng OCR (kiểm bằng spy hoặc bằng content stream gốc không đổi byte).
- K6 (trang không sửa): PDF 2 trang, chỉ sửa trang 1 → content stream trang 2 **giống hệt byte** trước và sau.
- K7 (`findRemainingOriginalText`):
  - với file **gốc** (chưa xoá) và check của dòng 2 → trả `[1]`;
  - với file đã xoá ở K1 → `[]`;
  - với `newText` chứa `originalText` → bỏ qua, trả `[]`.
- K8 (`formatRemainingTextWarning`):
  - warnings trang 2 (`kept-intersecting`) + trang 5 (`ocr-image`) → chuỗi có "Trang 2", "Trang 5", hai câu lý do ở mục 5 và câu nhắc cuối;
  - **không** chứa chuỗi chữ cũ/mới truyền vào fixture.
- K9 (annotation cũ): annotation `replaceOriginal` **không** có `originalText/originalSource/originalRect` vẫn xuất được: dùng khung annotation làm vùng, xoá thật như K1.
- K10: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed**. Chỉ 2 test được phép sửa có thay đổi.
- K11 (Claude kiểm tra khi QA, agent không làm):
  - mở PDF giả, sửa 1 dòng → Xuất → file tải về copy/tìm không ra chữ cũ, không có hình che trắng;
  - sửa vùng OCR → hộp cảnh báo nêu đúng trang; Huỷ → không tải về; activity log không chứa chữ.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/App.tsx -Pattern "buildEditedPdfWithReport","findRemainingOriginalText","formatRemainingTextWarning"
Select-String -Path src/pdf-editor/exportPdf.ts -Pattern "removeTextInRegions"
Select-String -Path src/pdf-editor/__tests__/pdfEditor.test.ts -Pattern "KNOWN ISSUE B1","W-9 sẽ đảo"
git diff --stat -- src/pdf-editor/__tests__/ src/word-anonymizer/__tests__/
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
git add src/types.ts src/App.tsx src/pdf-editor
git commit -m "feat(W-9a): remove original text via content stream engine on export and warn about pages with remaining text"
git push -u origin feat/w9a-export-real-text-removal
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- 3 hàm mới có trong `App.tsx`; `removeTextInRegions` có trong `exportPdf.ts`.
- Select-String `KNOWN ISSUE B1` / `W-9 sẽ đảo`: **không có** kết quả.
- Diff thư mục test: chỉ `pdfEditor.test.ts`, `export-rotation.test.ts` (sửa) và các file `w9a-*` (mới).
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w9a-export-real-text-removal
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w9a-export-real-text-removal
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z, **dòng tổng kết vitest cả 2 lần**. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- diff đúng của 2 test cũ được phép sửa (dán nguyên đoạn trước/sau);
- cách tính vùng xoá (nới padding, đổi toạ độ) và thứ tự engine → vẽ;
- cách `findRemainingOriginalText` đổi toạ độ text item;
- nội dung mẫu của hộp cảnh báo (dữ liệu giả);
- danh sách `TODO(verify)`.
