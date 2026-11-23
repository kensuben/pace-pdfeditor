# [W-9c] PDF Editor: sửa cả đoạn văn nhiều dòng, chữ tự xuống dòng thay vì bị thu nhỏ

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (bảng 2.2: B5, B6).
Tiền điều kiện: W-9a (PR #64), W-9b (PR #66) đã merge.
Nhánh: `feat/w9c-text-blocks-reflow` (tạo từ `main`) · Commit: `feat(W-9c): group lines into paragraph blocks, multi-line editing and reflow on export`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Commit message phải đúng nguyên văn như trên.** W-9a và W-9b đều dùng sai message, Claude phải squash lại khi merge. Sau khi commit:
- chạy `git log -1 --format=%s`;
- nếu khác nguyên văn → `git commit --amend -m "<message đúng>"` **trước** khi push.

**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w9c-text-blocks-reflow
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Vấn đề (Claude đọc code trên `main` @ `30709bd`)
1. **B6 – chỉ sửa được từng dòng.**
   - `groupTextItemsIntoLines` (`src/pdf-editor/textExtraction.ts`) gom fragment thành **dòng**; `PdfCanvas.tsx` (~dòng 133) đưa thẳng các dòng lên làm vùng sửa.
   - Một đoạn văn 3 dòng (ví dụ "Điều 1. Nội dung dịch vụ" trong PDF mẫu của hướng dẫn) phải sửa 3 lần. Sửa xong dòng 1 không tự dồn chữ sang dòng 2.
2. **B5 – chữ dài hơn khung bị thu nhỏ.** `src/pdf-editor/exportPdf.ts` (~dòng 262):
   ```ts
   if (a.replaceOriginal && naturalWidth > boxWidth) fontSize = Math.max(6, fontSize * (boxWidth / naturalWidth))
   ```
   Thay chữ dài hơn → chữ bé dần (tối thiểu 6pt), khác cỡ với văn bản xung quanh.
3. **Bản xem trên màn hình không thấy phần tràn:** annotation thay chữ (`.annotation`, `src/styles.css`) có `overflow: hidden` và chiều cao cố định.
4. Phím trong ô sửa (`editorKeyDown`, `PdfCanvas.tsx` ~dòng 331): `Enter` = lưu, `Shift+Enter` = xuống dòng, `Esc` = huỷ. **Giữ nguyên** (hướng dẫn và test đang dựa vào).

## Logic cần đạt
1. **Gom dòng thành khối đoạn** – hàm thuần mới `groupLinesIntoBlocks(lines: TextRegion[], viewport: { width: number; height: number }, pageNumber: number): TextRegion[]` trong `textExtraction.ts`. Trong `PdfCanvas.tsx`, gọi **ngay sau** `groupTextItemsIntoLines`. **Không sửa** `groupTextItemsIntoLines`.
   - Xét các dòng theo thứ tự từ trên xuống. Dòng `L` nối vào khối đang mở (dòng cuối là `P`) khi **tất cả** điều kiện sau đúng:
     - (a) cả hai `source: 'native'`, không có `rotation`;
     - (b) **không dòng nào có "hàng xóm cùng hàng"**: không tồn tại dòng khác (trong toàn bộ danh sách) có tâm dọc lệch ≤ 0.42 × chiều cao và **không** giao theo chiều ngang. Dòng có hàng xóm là ô bảng/biểu mẫu (nhãn | giá trị) → luôn đứng riêng;
     - (c) cùng `fontFamily`, `bold`, `italic`; cỡ chữ lệch ≤ 10%;
     - (d) khoảng cách đường chân chữ (đáy `L` − đáy `P`, tính bằng pt) trong `[0.9, 1.8] × fontSize`;
     - (e) lề trái lệch ≤ `max(2pt, 0.5 × fontSize)`. Cho phép **thụt đầu dòng**: nếu `P` là dòng đầu khối thì `P.left − L.left` được nằm trong `[0, 4 × fontSize]`;
     - (f) phần giao theo chiều ngang ≥ 50% bề rộng dòng hẹp hơn.
   - **Khối ≥ 2 dòng** → 1 vùng mới:
     - `id`: `native-block-<page>-<n>`;
     - khung = hình chữ nhật bao các dòng; `fontSize` = trung vị cỡ chữ các dòng;
     - `text`: nối các dòng. Dòng trước "đầy" (mép phải ≥ mép phải khối − 2 × fontSize) → nối bằng **dấu cách**; ngược lại → nối bằng `\n` (giữ xuống dòng cứng, ví dụ danh sách);
     - `lineHeight` (pt) = trung vị khoảng cách đường chân chữ;
     - `lineRects` = khung từng dòng (tỉ lệ 0–1).
   - **Khối 1 dòng** → trả **nguyên** vùng dòng đó (giữ `id`, không thêm `lineRects`).
   - Vùng OCR và vùng xoay đi qua nguyên vẹn.
2. **Kiểu dữ liệu** (`src/types.ts`, chỉ thêm trường tuỳ chọn):
   - `TextRegion`: `lineHeight?: number`, `lineRects?: Array<{ x: number; y: number; width: number; height: number }>`;
   - `Annotation`: `lineHeight?: number`, `originalLineRects?: Array<{ x: number; y: number; width: number; height: number }>`.
3. **`buildReplacementAnnotation`** (`textEdit.ts`): chép `lineHeight` và `originalLineRects` (từ `region.lineRects`). Các trường khác giữ nguyên.
4. **Ô sửa khối** (`PdfCanvas.tsx`, textarea vùng):
   - `white-space: pre-wrap`; `line-height` = `region.lineHeight × zoom` px nếu có;
   - chiều cao **tự giãn** theo nội dung (`scrollHeight`), tối thiểu bằng khung vùng. Chiều rộng giữ bằng khung;
   - phím giữ nguyên mục 4 của Vấn đề;
   - thêm `title` cho ô sửa khối: `"Enter: lưu · Shift+Enter: xuống dòng · Esc: huỷ"`.
5. **Bản xem annotation thay chữ** (`PdfCanvas.tsx`):
   - annotation `replaceOriginal` dùng `line-height` = `a.lineHeight × zoom` px nếu có;
   - đặt `overflow: visible` (chỉ cho `replaceOriginal`, qua class mới ví dụ `annotation text replacement`, CSS đặt trong `src/pdf-editor/viewer.css`) để thấy phần chữ tràn;
   - khung chọn (SelectionFrame) giữ theo khung annotation.
6. **Xuất – tự xuống dòng thay vì thu nhỏ** (`exportPdf.ts`):
   - hàm thuần mới `wrapTextToWidth(text: string, maxWidth: number, measure: (s: string) => number): string[]`:
     - tôn trọng `\n`;
     - ngắt theo khoảng trắng;
     - từ dài hơn `maxWidth` thì cắt theo ký tự;
     - không bỏ ký tự nào, trừ khoảng trắng ở chỗ ngắt;
   - với annotation `replaceOriginal`:
     - **bỏ** dòng thu nhỏ cỡ chữ (mục 2 Vấn đề);
     - `lines = wrapTextToWidth(value, boxWidth, s => font.widthOfTextAtSize(s, fontSize))`;
     - `lineHeightPt = a.lineHeight ?? fontSize * 1.2`;
     - dòng `i` vẽ ở `v = (a.y * height + fontSize + i * lineHeightPt) / height` qua `viewToPdf`, căn lề **từng dòng** theo `a.align`; gạch chân từng dòng nếu `a.underline`.
   - **Chỉ 1 dòng** → gọi `drawText` **đúng một lần với cùng tham số như hiện tại**. Test `K6` của `export-rotation.test.ts` đang so chuỗi toán tử, không được trượt.
   - **Tràn:** tổng chiều cao các dòng > chiều cao khung + 0.5 × `lineHeightPt` → vẫn vẽ hết. Thêm số trang vào trường mới `overflowPages: number[]` của `ExportTextReport` (sắp xếp, không trùng).
   - Annotation chữ **không** `replaceOriginal` (text box thêm mới): **giữ nguyên** cách vẽ hiện tại.
7. **Xoá thật theo từng dòng** (`exportPdf.ts`, phần dựng vùng của W-9a):
   - annotation có `originalLineRects` → mỗi dòng là một vùng (nới padding như hiện tại), gọi `removeTextInRegions` với **tất cả** vùng của trang, vẫn một lần cho mỗi trang;
   - không có → giữ cách cũ (`originalRect` hoặc khung annotation);
   - kiểm tra sót (`findRemainingOriginalText`) giữ nguyên, dùng `originalRect` + `originalText`.
8. **App** (`src/App.tsx`, chỉ trong `exportPdf`):
   - log `document.exported` thêm metadata `overflowPageCount`;
   - có `overflowPages` → `showStatusNotice` (hàm đã có trong `App.tsx`, ~dòng 291): `"Trang X: đoạn đã sửa dài hơn đoạn gốc, chữ có thể đè lên nội dung bên dưới."` Không chặn tải về.
9. GIỮ NGUYÊN:
   - W-9a (xoá thật, cảnh báo, kiểm tra sót), W-9b (nhận font/màu, chữ xoay khoá sửa);
   - `groupTextItemsIntoLines`; engine `src/pdf-editor/engine/**` (chỉ gọi);
   - text box thêm mới, OCR;
   - phím tắt ô sửa.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/types.ts` (chỉ thêm trường ở mục 2);
  - `src/pdf-editor/textExtraction.ts`, `src/pdf-editor/textEdit.ts`, `src/pdf-editor/exportPdf.ts`;
  - `src/pdf-editor/PdfCanvas.tsx` (gọi `groupLinesIntoBlocks`, textarea vùng, render annotation thay chữ);
  - `src/pdf-editor/viewer.css`, `src/pdf-editor/index.ts`;
  - `src/App.tsx` (chỉ `exportPdf`);
  - test mới `src/pdf-editor/__tests__/w9c-*.test.ts(x)`.
- KHÔNG sửa test có sẵn. Test cũ trượt → **DỪNG**, báo tên test + lý do, không tự sửa.
- KHÔNG sửa `src/styles.css` hay CSS ngoài `src/pdf-editor/`.
- Không thêm dependency. Fixture PDF dựng bằng `pdf-lib`, dữ liệu giả (`Hoc vien Test 01`, `@example.com`), không commit file PDF.

## Tiêu chí hoàn thành
- K1 (`groupLinesIntoBlocks`, dữ liệu dòng giả):
  - 3 dòng cùng font/cỡ 12, lề trái 70pt, đường chân cách nhau 15pt, dòng 1–2 đầy, dòng 3 ngắn → 1 khối, `text` = `dòng1 + ' ' + dòng2 + ' ' + dòng3`, `lineRects.length = 3`, `lineHeight ≈ 15`;
  - thêm dòng 4 cách 40pt → khối riêng.
- K2: biểu mẫu 3 hàng "nhãn | giá trị" (nhãn ở x=70, giá trị ở x=200, cùng font) → **6 vùng riêng**, không khối nào (điều kiện b).
- K3: danh sách 3 dòng ngắn (`• Mục 1`, `• Mục 2`, `• Mục 3`) → 1 khối, `text` nối bằng `\n`.
- K4: khác cỡ chữ (tiêu đề 18pt + đoạn 12pt), hoặc khác `bold` → không gộp tiêu đề vào đoạn.
- K5: thụt đầu dòng 20pt ở dòng 1 (fontSize 12) → vẫn 1 khối.
- K6 (pdf.js thật): fixture pdf-lib đoạn 3 dòng + 1 biểu mẫu 2 hàng → `groupTextItemsIntoLines` rồi `groupLinesIntoBlocks` cho 1 khối 3 dòng + 4 vùng biểu mẫu.
- K7 (`wrapTextToWidth`, đo bằng Helvetica 12 của pdf-lib):
  - chuỗi 3 câu dài với `maxWidth` 200 → mọi dòng ≤ 200pt, nối lại (bỏ khoảng trắng ở chỗ ngắt) bằng chuỗi gốc;
  - có `\n` → ngắt đúng chỗ;
  - một "từ" 60 ký tự liền → bị cắt theo ký tự, không mất ký tự.
- K8 (xuất, pdf.js thật):
  - fixture đoạn 3 dòng; thay bằng chuỗi dài hơn qua `buildReplacementAnnotation` (vùng khối);
  - kết quả:
    - pdf.js trích ra **không** còn chữ cũ của cả 3 dòng;
    - chữ mới nằm trên ≥ 3 dòng, **cùng cỡ chữ gốc** (không thu nhỏ: kiểm `Tf` = cỡ gốc);
    - các dòng cách nhau ≈ `lineHeight` (±0.5pt);
    - `cleanedPages = [1]`.
- K9 (tràn): thay bằng chuỗi gấp 3 lần → `overflowPages = [1]`, vẫn vẽ hết chữ.
- K10 (hồi quy): thay 1 dòng bằng chuỗi ngắn → chuỗi toán tử giống hệt hiện tại. Test `K6` của `export-rotation.test.ts` vẫn pass **không sửa**.
- K11 (jsdom): bấm vùng khối → textarea có `title` như mục 4 và `style.lineHeight` khác rỗng. `Shift+Enter` thêm `\n`, `Enter` lưu (gọi `onEditRegion` 1 lần với chuỗi có `\n`).
- K12: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed**.
- K13 (Claude kiểm tra khi QA, agent không làm):
  - PDF mẫu: đoạn "Điều 1" là 1 khối; bảng "Bên A/Bên B" vẫn sửa từng ô;
  - sửa đoạn dài hơn → bản xem thấy chữ tràn, file xuất tự xuống dòng đúng cỡ, chữ cũ mất;
  - 1280 / 1440px không đổi bố cục.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/exportPdf.ts -Pattern "fontSize \* \(boxWidth / naturalWidth\)"
Select-String -Path src/pdf-editor/PdfCanvas.tsx -Pattern "groupLinesIntoBlocks"
Select-String -Path src/pdf-editor/exportPdf.ts -Pattern "wrapTextToWidth","originalLineRects","overflowPages"
git diff --stat -- src/pdf-editor/engine/ src/pdf-editor/__tests__/ src/styles.css
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
git add src/types.ts src/App.tsx src/pdf-editor
git commit -m "feat(W-9c): group lines into paragraph blocks, multi-line editing and reflow on export"
git log -1 --format=%s
git push -u origin feat/w9c-text-blocks-reflow
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Select-String dòng thu nhỏ cỡ chữ: **không có** kết quả.
- `groupLinesIntoBlocks`, `wrapTextToWidth`, `originalLineRects`, `overflowPages`: có kết quả.
- Diff `engine/` và `styles.css`: rỗng. Thư mục test: chỉ file `w9c-*` mới.
- `git log -1 --format=%s` in **đúng** `feat(W-9c): group lines into paragraph blocks, multi-line editing and reflow on export`.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w9c-text-blocks-reflow
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w9c-text-blocks-reflow
```
- `git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`.
- Dòng `git log` phải là `<sha> feat(W-9c): group lines into paragraph blocks, multi-line editing and reflow on export`.

Sai message mà đã push → **không** force-push: báo lại để Claude squash khi merge.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z, **dòng tổng kết vitest cả 2 lần**. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- ngưỡng gom khối đã dùng (nếu chỉnh so với mục 1 thì nêu lý do + số liệu);
- cách tính vị trí từng dòng khi xuất trên trang xoay / CropBox lệch gốc (dùng `viewToPdf`);
- danh sách `TODO(verify)`.
