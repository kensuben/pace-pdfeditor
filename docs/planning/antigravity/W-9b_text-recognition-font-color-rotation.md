# [W-9b] PDF Editor: nhận đúng font, đậm/nghiêng, màu và hướng của chữ có sẵn trước khi sửa

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (bảng 2.2: B3, B14, B17, B22).
Tiền điều kiện: W-9a đã merge (PR #64).
Nhánh: `feat/w9b-text-style-recognition` (tạo từ `main`) · Commit: `feat(W-9b): detect font, weight, color and rotation of existing text`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Commit message phải đúng nguyên văn như trên** (W-9a dùng sai message, Claude phải squash lại khi merge).
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w9b-text-style-recognition
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Phạm vi
W-9 cũ được chia làm 3 phần:
- W-9a (đã merge): xoá thật khi xuất.
- **W-9b (task này):** nhận diện đúng **kiểu chữ** của dòng có sẵn.
- **W-9c (sau):** gom khối đoạn, sửa nhiều dòng, tự xuống dòng (B5, B6).

Task này **không** làm W-9c.

## Vấn đề (Claude đọc code + chạy thử trên `main` @ `abf0b98`, PDF giả)
1. **B22 – Helvetica bị nhận là Times.**
   - `src/pdf-editor/textExtraction.ts` dòng 26-30 dùng regex `/times|serif/` trên chuỗi `fontName + styles[fontName].fontFamily`.
   - pdf.js trả `fontFamily: 'sans-serif'` cho font không serif; chuỗi này **khớp** `serif` nên bị nhận là `'Times Roman'`.
   - Hậu quả khi QA W-9a: sửa dòng Helvetica → file xuất vẽ chữ mới bằng **Times-Roman** (có chân), khác hẳn các dòng xung quanh.
2. **B3 – màu chữ luôn đen.** `textExtraction.ts` dòng 43 gán cứng `color: '#000000'`. Chữ đỏ/xanh trong PDF sau khi sửa thành đen. `getTextContent` của pdf.js không trả màu.
3. **Đậm/nghiêng đoán theo tên trong pdf.js** (`/bold|black|heavy/`, `/italic|oblique/` trên `fontLabel`).
   - Tên font thật (`BaseFont`, ví dụ `ABCDEF+Arial-BoldMT`, `Times-Italic`) nằm trong `/Resources/Font` của trang nhưng chưa được đọc.
4. **B14 – chữ xoay so với màn hình bị đặt sai khung.**
   - `groupTextItemsIntoLines` chỉ dùng `tx[4]`, `tx[5]` và `item.width` theo phương ngang. Chữ dọc (trang `/Rotate 90` vẽ chữ thường, hoặc chữ vẽ xoay) có khung nằm ngang sai chỗ.
   - Hai dòng dọc bị gộp thành một vùng (QA W-9a: `"Dong khac giu nguyenNguoi ky: Hoc vien Test 02"`). Sửa vùng này → engine giữ lại chữ cũ, hộp che không phủ đúng chỗ.
5. **B17 – bản xem trên màn hình dùng font CSS tên `Helvetica` / `Times Roman` / `Courier` trần.**
   - `src/pdf-editor/PdfCanvas.tsx` dòng ~256, ~377, ~468, ~499, ~589 đặt `fontFamily: x.fontFamily || 'Helvetica'`. Máy không có Helvetica (Linux, một số Windows) hiện font dự phòng khác font khi xuất.
   - App đã nạp sẵn Arimo 400/700 thường/nghiêng (`src/main.tsx` dòng 24-31), tương thích kích thước với Helvetica/Arial.

## Logic cần đạt
1. **Sửa nhận diện theo pdf.js (dự phòng):**
   - trong `textExtraction.ts`, tách hàm thuần `familyFromFontLabel(label: string): 'Helvetica' | 'Times Roman' | 'Courier'`:
     - `courier|mono|consolas` → Courier;
     - `times|georgia|garamond|cambria` → Times Roman;
     - `serif` chỉ tính là Times khi **không** có `sans` → `'sans-serif'` phải ra Helvetica;
     - còn lại → Helvetica.
   - `groupTextItemsIntoLines` dùng hàm này. Đậm/nghiêng theo pdf.js giữ như cũ (chỉ là dự phòng).
2. **Đọc kiểu chữ thật từ content stream** (file mới `src/pdf-editor/engine/textStyleProbe.ts`, hàm thuần, chỉ **đọc**):
   ```ts
   export interface TextStyleProbe {
     bbox: Rect            // toạ độ PDF mặc định (pt), như engine W-7
     color?: string        // '#rrggbb'; undefined khi không xác định
     baseFont?: string     // BaseFont đã bỏ tiền tố subset 'ABCDEF+'
   }
   export function probeTextStyles(doc: PDFDocument, pageIndex: number): TextStyleProbe[]
   ```
   - Dùng lại, **không sửa**:
     - `readPageContent` (`engine/pageContent.ts`);
     - `tokenizeContent`;
     - `FontMetricsCache`, `computeTextAdvanceAndBbox`, `multMatrix` (`engine/textGeometry.ts`).

     Theo dõi trạng thái giống `removeTextInRegions` (`q/Q`, `cm`, `BT/ET`, `Tf`, `Tm/Td/TD/T*`, `Tc/Tw/Tz/TL/Ts`), mỗi lệnh `Tj/TJ/'/"` → 1 probe.
   - **Màu tô** (lưu/khôi phục theo `q/Q`, mặc định đen):
     - `g` → xám; `rg` → RGB; `k` → CMYK đổi sang RGB theo công thức đơn giản `r = (1-c)(1-k)`, `g = (1-m)(1-k)`, `b = (1-y)(1-k)`;
     - `sc/scn` có 1/3/4 số → xám/RGB/CMYK;
     - `sc/scn` có tên (pattern) hoặc không xác định → `color: undefined`.
   - `Tr 3` (chữ ẩn, thường là lớp OCR của bản scan) → **bỏ qua**, không tạo probe.
   - `BaseFont`: tra từ `/Resources/Font/<tên Tf>` của trang. Không có → `undefined`.
   - Form XObject (`Do`): không đi vào, không tạo probe.
   - Lỗi tokenizer/giải mã → trả `[]`, không ném lỗi.
3. **Suy ra họ font + đậm/nghiêng từ BaseFont** (hàm thuần trong `fonts.ts`): `styleFromBaseFont(name) → { family; bold; italic }`.
   - Họ font: cùng quy tắc mục 1, áp lên `name`.
   - `bold`: `/bold|black|heavy|semibold|demi/i`.
   - `italic`: `/italic|oblique/i`.
4. **Gắn kiểu chữ vào vùng** (hàm thuần mới trong `textExtraction.ts`): `enrichRegionsWithStyles(regions, probes, view: PageView): TextRegion[]`.
   - Đổi khung vùng (tỉ lệ 0–1) sang PDF bằng `viewToPdf` 4 góc → hình chữ nhật bao, nới 1pt.
   - Probe thuộc vùng khi **tâm** bbox của probe nằm trong khung đó.
   - Có probe:
     - `color` = màu của nhóm probe có **tổng bề rộng lớn nhất** (bỏ probe `color: undefined`);
     - `fontFamily/bold/italic` = `styleFromBaseFont` của probe rộng nhất có `baseFont`.
   - Không có probe → giữ nguyên vùng.
   - Vùng `source: 'ocr'` → giữ nguyên.
5. **Nối vào App** (`src/App.tsx`, chỉ trong `handleTextRegions` + một `useRef` cache):
   - `handleTextRegions` vẫn đặt vùng **ngay** như hiện tại (không làm chậm hiển thị);
   - sau đó chạy bất đồng bộ:
     - `PDFDocument.load(bytes)` cache theo `bytes` (load một lần cho mỗi phiên bản `bytes`);
     - probe của trang cache theo số trang, xoá cache khi `bytes` đổi;
     - `enrichRegionsWithStyles`;
     - cập nhật lại vùng của trang đó, **chỉ** cho các vùng còn có mặt (theo `id`). Không đụng vùng OCR và vùng đã bị sửa.
   - Lỗi probe → `console.warn`, không `alert`, giữ vùng như cũ.
6. **Chữ xoay so với màn hình (B14)** trong `groupTextItemsIntoLines`:
   - tính góc `angle = atan2(tx[1], tx[0])` (độ, theo hệ viewport);
   - `|angle| ≤ 2°`: giữ nguyên cách tính khung và gộp dòng hiện tại;
   - `|angle| > 2°`:
     - khung = hình chữ nhật bao của 4 góc: gốc `(tx[4], tx[5])`, vectơ chiều chữ (`tx[0], tx[1]`, độ dài `item.width`) và vectơ chiều cao (`tx[2], tx[3]`, độ dài `fontHeight`);
     - đặt `rotation` = góc làm tròn tới 1°;
     - **không gộp** với fragment nào khác.
   - Thêm `rotation?: number` vào `TextRegion` (`src/types.ts`).
   - Chiều dấu của vectơ không chắc → ghi `TODO(verify)` và chứng minh bằng test K5.
   - **Vùng có `rotation`** trong `PdfCanvas.tsx`:
     - vẫn hiện khung (để "Hiện khung bao" đúng chỗ);
     - nút có `aria-disabled="true"`, class thêm `rotated`, `title="Chữ xoay: chưa hỗ trợ sửa"`;
     - bấm **không** mở ô sửa.
7. **Font bản xem (B17)** – hàm thuần `cssFontStack(family?: string): string` trong `fonts.ts`:
   - `Helvetica`/không có → `Helvetica, Arimo, Arial, sans-serif`;
   - `Times Roman` → `"Times New Roman", Times, "Liberation Serif", serif`;
   - `Courier` → `"Courier New", Courier, "Liberation Mono", monospace`;
   - `Arimo` → `Arimo, Arial, sans-serif`;
   - `Be Vietnam Pro` → `"Be Vietnam Pro", sans-serif`;
   - `Noto Sans` → `"Noto Sans", sans-serif`.

   Thay **mọi** chỗ `fontFamily: … || 'Helvetica'` trong `PdfCanvas.tsx` bằng `cssFontStack(…)`. **Không** đổi giá trị `fontFamily` lưu trong annotation (vẫn là tên họ font để xuất).
8. GIỮ NGUYÊN:
   - cách gộp dòng cho chữ ngang;
   - W-9a (xoá thật, cảnh báo, kiểm tra sót);
   - `buildReplacementAnnotation` (đã chép `color/fontFamily/bold/italic` từ vùng, tự hưởng kết quả mới);
   - xuất PDF, OCR, engine W-7 (`textRemoval.ts`, `textGeometry.ts`, `contentTokenizer.ts`, `pageContent.ts`: chỉ gọi, không sửa).

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/types.ts` (chỉ thêm `rotation?: number` vào `TextRegion`);
  - `src/pdf-editor/textExtraction.ts`, `src/pdf-editor/fonts.ts`;
  - `src/pdf-editor/engine/textStyleProbe.ts` (mới);
  - `src/pdf-editor/PdfCanvas.tsx` (chỉ font CSS + hiển thị vùng `rotation`);
  - `src/pdf-editor/index.ts`;
  - `src/App.tsx` (chỉ `handleTextRegions` + cache);
  - CSS cho `.text-region.rotated` đặt trong `src/pdf-editor/viewer.css`;
  - test mới `src/pdf-editor/__tests__/w9b-*.test.ts`.
- KHÔNG sửa test có sẵn. Test cũ trượt → **DỪNG**, báo tên test + lý do, không tự sửa.
- KHÔNG sửa file trong `src/pdf-editor/engine/` trừ file mới `textStyleProbe.ts`.
- Không thêm dependency. Fixture PDF dựng bằng `pdf-lib`, dữ liệu giả (`Hoc vien Test 01`, `@example.com`), không commit file PDF.

## Tiêu chí hoàn thành
- K1 (`familyFromFontLabel`): `'g_d0_f1 sans-serif'` → Helvetica; `'g_d0_f2 serif'` → Times Roman; `'Times-Roman serif'` → Times Roman; `'CourierNewPSMT monospace'` → Courier.
- K2 (`styleFromBaseFont`):
  - `ABCDEF+Arial-BoldMT` → `{ Helvetica, bold: true, italic: false }`;
  - `Times-Italic` → `{ Times Roman, false, true }`;
  - `Courier-BoldOblique` → `{ Courier, true, true }`;
  - `Helvetica` → `{ Helvetica, false, false }`.
- K3 (`probeTextStyles`, fixture pdf-lib):
  - 3 dòng: `Helvetica` đen, `Helvetica-Bold` màu `rgb(0.8, 0.1, 0.1)`, `Times-Italic` màu xanh `rgb(0, 0.2, 0.6)`;
  - → 3 probe có bbox đúng dòng (±2pt), màu `#000000`, `#cc1a1a` (±1 mỗi kênh), `#003399` (±1), `baseFont` đúng;
  - fixture thêm 1 dòng `Tr 3` → không có probe cho dòng đó.
- K4 (`enrichRegionsWithStyles` + `groupTextItemsIntoLines` trên kết quả pdf.js thật của fixture K3):
  - dòng 2 → `color` `#cc1a1a`, `fontFamily` Helvetica, `bold: true`;
  - dòng 3 → Times Roman, `italic: true`;
  - dòng 1 → Helvetica (**không** còn Times — chứng minh B22 đã sửa).
- K5 (xoay, pdf.js thật):
  - trang `600×400` có `/Rotate 90`, `drawText('Customer: Hoc vien Test 01', { x: 50, y: 300, size: 14 })` và dòng `Line C` ở `y: 250`;
  - → 2 vùng **riêng**, cả hai có `rotation`;
  - đổi khung vùng "Customer…" sang PDF bằng `viewToPdf` → chứa bbox thật của dòng (x 50→50+độ rộng chữ, y ~300→314) với sai số ≤ 2pt, và **không** chứa dòng `Line C`.
- K6 (`cssFontStack`): đúng 6 trường hợp ở mục 7. `render` `PdfCanvas` (jsdom) với vùng `fontFamily: 'Helvetica'` → `style.fontFamily` của ô sửa chứa `Arimo`.
- K7 (jsdom): vùng có `rotation` → nút có `aria-disabled="true"`; bấm không xuất hiện `textarea.inline-text-editor`.
- K8 (hồi quy xuất): fixture K3 → sửa dòng 2 qua `buildReplacementAnnotation` (vùng đã enrich) → `buildEditedPdfWithReport`:
  - file xuất có font `Helvetica-Bold` (không có `Times-Roman`);
  - toán tử màu tô trước chữ mới là `0.8 0.1 0.1 rg` (±0.01);
  - `cleanedPages = [1]`.
- K9: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed**.
- K10 (Claude kiểm tra khi QA, agent không làm):
  - PDF giả có chữ màu + đậm + Times → bấm sửa → ô sửa hiện đúng màu/kiểu; xuất ra đúng font/màu;
  - trang xoay: khung bao đúng chỗ, vùng xoay không mở ô sửa;
  - 1280 / 1440px không đổi bố cục.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/textExtraction.ts -Pattern "/times\|serif/"
Select-String -Path src/pdf-editor/PdfCanvas.tsx -Pattern "\|\| 'Helvetica'"
Select-String -Path src/App.tsx -Pattern "probeTextStyles","enrichRegionsWithStyles"
git diff --stat -- src/pdf-editor/engine/
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
git add src/types.ts src/App.tsx src/pdf-editor
git commit -m "feat(W-9b): detect font, weight, color and rotation of existing text"
git push -u origin feat/w9b-text-style-recognition
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Select-String `/times|serif/` và `|| 'Helvetica'` trong `PdfCanvas.tsx`: **không có** kết quả.
- `probeTextStyles` / `enrichRegionsWithStyles` có trong `App.tsx`.
- Diff `engine/`: chỉ `textStyleProbe.ts` (mới).
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w9b-text-style-recognition
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w9b-text-style-recognition
```
- `git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`.
- Dòng `git log` phải bắt đầu bằng `feat(W-9b): detect font, weight, color and rotation of existing text`.

Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z, **dòng tổng kết vitest cả 2 lần**. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- cách theo dõi màu tô và quy tắc chọn màu/font khi một vùng có nhiều probe;
- công thức khung chữ xoay (chiều dấu vectơ) và kết quả K5 (số liệu bbox);
- thời gian `probeTextStyles` trên trang 200 dòng (trung vị 3 lần);
- danh sách `TODO(verify)`.
