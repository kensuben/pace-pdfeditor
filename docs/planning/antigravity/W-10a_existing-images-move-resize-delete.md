# [W-10a] PDF Editor: chọn, di chuyển, đổi kích thước và xoá thật ảnh có sẵn trong PDF

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm (mục **Ba điều bắt buộc** và **Bước Y**).
Tiền điều kiện: W-7 (engine), W-8 (khung chọn), F-18b đã merge.
Nhánh: `feat/w10a-existing-images` (tạo từ `main`) · Commit: `feat(W-10a): select, move, resize and delete existing PDF images via content stream`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi Bước Y in `PUSH OK` – dòng đó là dòng ĐẦU TIÊN của báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w10a-existing-images
npm ci
```
Lệnh an toàn: không dùng `npx` với package ngoài `package.json`; không chạy dev server, không mở trình duyệt; lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Phạm vi
W-10 trong `docs/pdf-editor/01-PLAN.md` được tách:
- **W-10a (task này):** nhận ảnh có sẵn, chọn, kéo, giãn, xoá; xuất bằng cách sửa content stream (không vẽ lại ảnh).
- **W-10b (sau):** xoay, lật, cắt, thay ảnh, sắp lớp; ảnh nằm trong Form XObject và ảnh inline.

Task này **không** làm phần W-10b.

## Vấn đề (Claude đọc code trên `main` @ `ca6d10e`)
1. **B9 – ảnh có sẵn trong PDF không chọn/sửa được.**
   - Chỉ chữ có sẵn được nhận thành vùng (`TextRegion`, `textExtraction.ts`).
   - Ảnh gốc (logo, chữ ký scan, con dấu…) không có vùng nào, không có khung bao, không bấm được.
   - Người dùng muốn bỏ hoặc dời logo/chữ ký cũ chỉ có cách vẽ hình đè lên. Ảnh vẫn nằm nguyên trong file.
2. Engine W-7 đã có:
   - `tokenizeContent` / `serializeContent` (`engine/contentTokenizer.ts`, nhận cả `BI … EI` inline);
   - `readPageContent` / `writePageContent` (`engine/pageContent.ts`);
   - `multMatrix`, `applyMatrix` (`engine/textGeometry.ts`).

   `removeTextInRegions` (`engine/textRemoval.ts` ~dòng 242) đã gặp toán tử `Do` nhưng chỉ để bỏ qua Form XObject.
3. Ảnh chèn mới (`type: 'image'`, `imageDataUrl`) đã kéo/giãn được bằng `SelectionFrame` (W-8), mặc định khoá tỉ lệ (`defaultAspectLockedForType('image')`, `viewMath.ts` dòng 282). `exportPdf.ts` vẽ ảnh chèn bằng `drawImage`.
4. `App.tsx` (~dòng 403-480) đã cache `PDFDocument.load(bytes)` theo `bytes` để chạy `probeTextStyles` cho từng trang (W-9b). Dùng lại cache này.
5. `pageGeometry.ts` có `viewToPdf` (tỉ lệ 0–1 → pt) nhưng chưa có chiều ngược lại.

## Logic cần đạt
1. **Nhận ảnh** – file mới `src/pdf-editor/engine/imageProbe.ts`, hàm thuần, chỉ đọc:
   ```ts
   export interface PageImageInfo {
     resourceName: string      // tên trong /Resources/XObject, ví dụ 'Im1'
     occurrence: number        // thứ tự lần `Do` của cùng resourceName trên trang (0, 1, …)
     ctm: [number, number, number, number, number, number]  // CTM tại lúc `Do`
     bbox: Rect                // ảnh của hình vuông đơn vị qua ctm, toạ độ PDF (pt)
     axisAligned: boolean      // |b| và |c| ≈ 0 (sai số 1e-6 × max(|a|,|d|)) và a > 0, d > 0
   }
   export function probePageImages(doc: PDFDocument, pageIndex: number): { images: PageImageInfo[]; skipped: { formXObject: number; inline: number } }
   ```
   - Theo dõi `q/Q/cm` như engine.
   - `Do /Name`: tra `/Resources/XObject/Name`. `/Subtype /Image` → ghi nhận. `/Subtype /Form` → `skipped.formXObject++`, không đi vào.
   - `BI` → `skipped.inline++`.
   - Lỗi giải mã → `{ images: [], skipped: {0,0} }`, không ném lỗi.
2. **Đổi toạ độ** – thêm vào `pageGeometry.ts` hàm `pdfToView(view, x, y) → { u, v }`, nghịch đảo đúng của `viewToPdf` cho cả 4 góc xoay. Test khứ hồi K2.
3. **Vùng ảnh trên trang**:
   - thêm kiểu `PageImageRegion` (`src/types.ts`): `{ id, page, x, y, width, height, resourceName, occurrence, editable: boolean }`, toạ độ tỉ lệ 0–1 như `TextRegion`;
   - `id` = `img-<page>-<resourceName>-<occurrence>`;
   - `editable = axisAligned`.
   - `App.tsx`:
     - trong khối bất đồng bộ của `handleTextRegions`, dùng cache `PDFDocument` sẵn có, gọi `probePageImages` (cache theo trang, xoá khi `bytes` đổi);
     - đổi `bbox` sang tỉ lệ bằng `pdfToView` 4 góc, lưu vào state mới `pageImages: Record<number, PageImageRegion[]>`;
     - truyền qua `PageList` → `PdfCanvas` (prop mới `pageImages`).
4. **Chọn ảnh** (`PdfCanvas.tsx`, công cụ Chọn):
   - mỗi vùng ảnh có một nút trong suốt `className="page-image-region"`, `title="Ảnh trong PDF"` (không sửa được: `aria-disabled="true"`, `title="Ảnh này chưa hỗ trợ sửa"`);
   - khi "Hiện khung bao" bật → vẽ khung nét đứt cho vùng ảnh như vùng chữ;
   - bấm vào vùng ảnh `editable`:
     - (a) cắt ảnh xem trước từ canvas trang đã render (đúng vùng, `toDataURL('image/png')`) làm **ảnh preview**;
     - (b) tạo annotation `type: 'image'` với `imageDataUrl` = ảnh preview, `x/y/width/height` = vùng ảnh, và trường mới `sourceImage: { resourceName, occurrence, originalRect }` (`originalRect` tỉ lệ 0–1);
     - (c) chọn annotation đó (khung 8 tay nắm của W-8). Vùng ảnh đã thành annotation thì ẩn nút `page-image-region` của nó;
     - (d) `backgroundColor` = màu nền lấy mẫu quanh vùng (dùng `sampleBackground` sẵn có trong `PdfCanvas.tsx` ~dòng 281).
   - Annotation có `sourceImage`:
     - **bản xem** vẽ một lớp **che** ở `originalRect` (màu `backgroundColor`) dưới ảnh preview, để thấy ảnh đã rời chỗ cũ;
     - kéo/giãn/phím mũi tên/panel X-Y-Rộng-Cao dùng nguyên cơ chế W-8 (khoá tỉ lệ mặc định như ảnh chèn).
5. **Xoá** (`App.tsx`, `deleteSelected`):
   - annotation có `sourceImage` → **không** gỡ khỏi danh sách, mà đặt `deleted: true` (trường mới, `src/types.ts`). Bản xem chỉ còn lớp che, không vẽ ảnh preview, không chọn lại được;
   - Undo/Redo dùng lịch sử hiện có.
6. **Xuất** – file mới `src/pdf-editor/engine/imageTransform.ts`:
   ```ts
   export interface ImageEdit { resourceName: string; occurrence: number; newBbox?: Rect; remove?: boolean }
   export function applyImageEdits(doc: PDFDocument, pageIndex: number, edits: ImageEdit[]): { applied: number; notFound: number }
   ```
   - Duyệt lại ops như mục 1 để tìm đúng `Do` (theo `resourceName` + `occurrence`).
   - `remove` → bỏ toán tử `Do` đó (giữ nguyên mọi toán tử khác).
   - `newBbox` → thay `Do` bằng chuỗi `q`, `M cm`, `Do`, `Q`. Ở đây `M` làm ảnh của hình vuông đơn vị khớp `newBbox`:
     - `CTM_mới = M × CTM` theo quy ước nhân ma trận của PDF;
     - cần `CTM_mới = CTM × U`, với `U` là phép co giãn + tịnh tiến biến `bbox` cũ thành `newBbox` (toạ độ PDF);
     - suy ra `M = CTM × U × CTM⁻¹`.
     - Ghi công thức đã dùng trong báo cáo. Không chắc chiều nhân → `TODO(verify)` và chứng minh bằng K5.
   - `newBbox` lệch `bbox` cũ < 0.5pt ở mọi cạnh → coi như không đổi, không ghi.
   - Ghi lại bằng `serializeContent` + `writePageContent`.
   - `exportPdf.ts`:
     - trước bước xoá chữ của W-9a, với mỗi trang có annotation `sourceImage`, gọi `applyImageEdits`;
     - `newBbox` = khung annotation đổi sang PDF bằng `viewToPdf` 4 góc;
     - `deleted` → `remove: true`;
     - annotation `sourceImage` **không** được vẽ bằng `drawImage` và **không** vẽ lớp che. Ảnh gốc được giữ nguyên chất lượng, chỉ đổi vị trí.
   - `notFound > 0` → thêm cảnh báo vào `ExportTextReport.warnings` với lý do mới `'image-not-found'`. `formatRemainingTextWarning` có câu tương ứng: "không tìm thấy ảnh gốc để sửa, ảnh có thể vẫn ở vị trí cũ".
7. **Xoay trang:** `canRotatePage` (`viewMath.ts` dòng 117) trả `false` khi trang có annotation `sourceImage` (như với `replaceOriginal`).
8. GIỮ NGUYÊN:
   - ảnh chèn mới (`imageDataUrl` không có `sourceImage`) xuất như cũ;
   - W-9a/b/c, F-16→F-18b;
   - engine cũ (`textRemoval.ts`, `textGeometry.ts`, `contentTokenizer.ts`, `pageContent.ts`, `textStyleProbe.ts`): chỉ gọi, không sửa.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/types.ts`: thêm `PageImageRegion`; thêm `sourceImage?`, `deleted?` vào `Annotation`;
  - `src/pdf-editor/engine/imageProbe.ts`, `src/pdf-editor/engine/imageTransform.ts` (mới);
  - `src/pdf-editor/pageGeometry.ts` (chỉ thêm `pdfToView`);
  - `src/pdf-editor/exportPdf.ts`, `src/pdf-editor/residualCheck.ts` (chỉ câu cảnh báo mới);
  - `src/pdf-editor/viewMath.ts` (chỉ `canRotatePage`);
  - `src/pdf-editor/PdfCanvas.tsx`, `src/pdf-editor/PageList.tsx` (chỉ truyền prop `pageImages`);
  - `src/pdf-editor/viewer.css`, `src/pdf-editor/index.ts`;
  - `src/App.tsx`: chỉ cache/probe ảnh, state `pageImages`, `deleteSelected`;
  - test mới `src/pdf-editor/__tests__/w10a-*.test.ts(x)`.
- KHÔNG sửa test có sẵn. Test cũ trượt → **DỪNG**, báo tên test + lý do, không tự sửa.
- Không thêm dependency. Fixture PDF dựng bằng `pdf-lib` (`embedPng` với PNG nhỏ tạo trong test, dữ liệu giả); không commit file PDF/ảnh thật.

## Tiêu chí hoàn thành
- K1 (`probePageImages`):
  - fixture có 2 ảnh PNG (`drawImage` ở `(50,600,100,50)` và `(300,100,80,80)`), 1 Form XObject (`embedPage` + `drawPage`), 1 ảnh xoay 30°;
  - kết quả: 3 `images` (2 `axisAligned: true` có bbox đúng ±0.5pt, 1 `axisAligned: false`), `skipped.formXObject = 1`.
- K2 (`pdfToView`): khứ hồi `viewToPdf → pdfToView` sai số < 1e-9 cho 4 góc xoay và CropBox lệch gốc.
- K3 (`applyImageEdits` xoá): xoá ảnh 1 → pdf.js `getOperatorList` của trang còn đúng 1 lần `paintImageXObject`; mọi chữ trên trang (nếu có) giữ nguyên.
- K4 (di chuyển): ảnh 1 dời tới `(200, 400, 100, 50)` → `probePageImages` trên file xuất cho bbox mới ±0.5pt; ảnh 2 không đổi.
- K5 (giãn + trang xoay): trang `/Rotate 90` có 1 ảnh; đổi kích thước gấp đôi qua `buildEditedPdfWithReport` (annotation `sourceImage` với toạ độ tỉ lệ) → bbox sau khi xuất khớp `viewToPdf` của khung annotation ±0.5pt.
- K6 (không đổi): annotation `sourceImage` với khung trùng gốc → content stream trang **giống hệt byte**.
- K7 (không tìm thấy): `occurrence` sai → `notFound = 1`, báo cáo có warning `image-not-found`, file vẫn xuất.
- K8 (jsdom): `PdfCanvas` với `pageImages` 1 vùng `editable`:
  - bấm → gọi callback tạo annotation có `sourceImage`;
  - vùng `editable: false` có `aria-disabled="true"`, bấm không tạo gì.
- K9: `canRotatePage` trả `false` khi trang có annotation `sourceImage`.
- K10: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed**.
- K11 (Claude kiểm tra khi QA, agent không làm):
  - PDF giả có logo và chữ ký ảnh:
    - bấm chọn → 8 tay nắm;
    - kéo/giãn → bản xem đúng;
    - xoá → chỉ còn nền;
    - xuất → file có ảnh ở vị trí mới, đúng chất lượng gốc; ảnh đã xoá không còn trong lệnh vẽ;
  - Undo/Redo đúng;
  - 1280 / 1440px không đổi bố cục.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/App.tsx -Pattern "probePageImages","pageImages"
Select-String -Path src/pdf-editor/exportPdf.ts -Pattern "applyImageEdits"
git diff --stat -- src/pdf-editor/__tests__/ src/pdf-editor/engine/
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Các Select-String có kết quả.
- Diff `engine/`: chỉ 2 file mới. Thư mục test: chỉ file `w10a-*` mới.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

Sau đó chạy **Bước Y** (`00_RULES.md`) với:
```powershell
$Branch = 'feat/w10a-existing-images'
$Msg    = 'feat(W-10a): select, move, resize and delete existing PDF images via content stream'
$Paths  = @('src/types.ts', 'src/App.tsx', 'src/pdf-editor')
$Expect = 1
```

## Báo cáo
Dòng đầu là `PUSH OK: …`. Sau đó theo `00_RULES.md` (output Bước A, toàn bộ output Bước Y, tổng kết vitest 2 lần), cộng thêm:
- bảng `K | tên test | pass`;
- công thức `M` đã dùng và kết quả số của K4/K5;
- cách lấy ảnh preview từ canvas (độ phân giải, xử lý zoom);
- danh sách `TODO(verify)`.
