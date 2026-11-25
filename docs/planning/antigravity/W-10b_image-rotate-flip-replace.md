# [W-10b] PDF Editor: xoay 90°, lật ngang/dọc và thay ảnh (ảnh có sẵn lẫn ảnh chèn)

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm (mục **Ba điều bắt buộc** và **Bước Y**).
Tiền điều kiện: W-10a đã merge (PR #81).
Nhánh: `feat/w10b-image-rotate-flip-replace` (tạo từ `main`) · Commit: `feat(W-10b): rotate, flip and replace existing and inserted images`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi Bước Y in `PUSH OK` – dòng đó là dòng ĐẦU TIÊN của báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w10b-image-rotate-flip-replace
npm ci
```
Lệnh an toàn: không dùng `npx` với package ngoài `package.json`; không chạy dev server, không mở trình duyệt; lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Phạm vi
W-10 trong `docs/pdf-editor/01-PLAN.md` được chia:
- W-10a (đã merge): nhận ảnh có sẵn, kéo, giãn, xoá.
- **W-10b (task này):** xoay 90°, lật, thay ảnh, cho **cả ảnh có sẵn** (`sourceImage`) **và ảnh chèn mới** (`imageDataUrl`).
- **W-10c (sau):** cắt ảnh (crop), sắp lớp, ảnh trong Form XObject và ảnh inline.

Task này **không** làm crop/sắp lớp/Form XObject/inline.

## Vấn đề (Claude đọc code trên `main` @ `5c45601`)
1. **Không có thao tác nào ngoài kéo/giãn/xoá cho ảnh.**
   - `PropertiesPanel.tsx` (~dòng 217-243) chỉ có Vị trí & kích thước, Khoá tỉ lệ và Độ mờ.
   - Muốn xoay một ảnh scan bị ngược hoặc thay logo cũ bằng logo mới thì người dùng phải xoá rồi chèn lại, mất vị trí.
2. `Annotation` (`src/types.ts`) không có trường xoay/lật.
   - Ảnh chèn xuất bằng `p.drawImage` (`exportPdf.ts`, nhánh `a.type === 'image' && a.imageDataUrl`, sau dòng `if (a.sourceImage) continue`).
   - Ảnh có sẵn xuất bằng `applyImageEdits` (`engine/imageTransform.ts`), đổi được vị trí/kích thước qua `newBbox` nhưng không xoay/lật được.
3. **Độ mờ không có tác dụng với ảnh có sẵn.** Thanh "Độ mờ" vẫn hiện cho annotation `sourceImage`, nhưng khi xuất ảnh gốc không bị vẽ lại nên giá trị độ mờ bị bỏ qua.

## Logic cần đạt
1. **Kiểu dữ liệu** (`src/types.ts`, trường tuỳ chọn trên `Annotation`):
   - `imageRotation?: 0 | 90 | 180 | 270` (chiều kim đồng hồ khi nhìn trên màn hình);
   - `flipH?: boolean`, `flipV?: boolean`;
   - `replacementDataUrl?: string` (chỉ cho `sourceImage`: ảnh thay thế, PNG/JPEG).
2. **Quy ước hình học** (dùng chung cho bản xem và xuất):
   - `x/y/width/height` của annotation **luôn** là khung hiển thị sau khi xoay;
   - xoay 90°/270° → hoán đổi khung quanh **tâm** (đổi bề rộng ↔ chiều cao theo pt; quy đổi tỉ lệ bằng kích thước trang ở hệ toạ độ hiển thị);
   - thứ tự áp: lật trước, xoay sau, quanh tâm khung.
3. **Panel "Ảnh"** (`PropertiesPanel.tsx`, khi `selectedAnnotation.type === 'image'`):
   - 5 nút, có `aria-label`/`title` tiếng Việt: `Xoay trái 90°`, `Xoay phải 90°`, `Lật ngang`, `Lật dọc`, `Thay ảnh…`;
   - "Thay ảnh…" mở `input type=file accept="image/png,image/jpeg"`. Sai định dạng → `alert('Chỉ hỗ trợ ảnh PNG hoặc JPEG.')` như `insertImage`;
   - thay ảnh: giữ **bề rộng** và góc trên-trái khung, chiều cao tính lại theo tỉ lệ ảnh mới (xét cả `imageRotation`);
     - ảnh chèn → đổi `imageDataUrl`;
     - ảnh có sẵn → đặt `replacementDataUrl` và cập nhật ảnh preview;
   - mỗi thao tác là **một bước** lịch sử (Undo/Redo được). Dùng `onUpdateAnnotation(updated, 'update')`. Kích thước đổi (xoay 90°, thay ảnh) thì dùng kiểu `'resize'`;
   - ẩn thanh **Độ mờ** khi annotation có `sourceImage`.
4. **Bản xem** (`PdfCanvas.tsx`, phần render ảnh):
   - `<img>` đặt giữa khung, kích thước **trước khi xoay** (90°/270° thì hoán đổi), `transform: rotate(<deg>) scale(<±1>, <±1>)`;
   - `sourceImage` có `replacementDataUrl` → preview dùng ảnh thay thế;
   - khung chọn (8 tay nắm) vẫn theo `x/y/width/height`.
5. **Ma trận đích** – hàm thuần mới trong `exportPdf.ts` (hoặc file mới `src/pdf-editor/imagePlacement.ts`):
   ```ts
   export function imagePlacementMatrix(a: Annotation, view: PageView): [number, number, number, number, number, number]
   ```
   - xác định vị trí hiển thị `(u, v)` (tỉ lệ 0–1) mà 3 góc ảnh gốc phải nằm sau khi lật + xoay quanh tâm khung: **dưới-trái**, **dưới-phải**, **trên-trái** của ảnh khi đứng thẳng;
   - đổi 3 điểm sang PDF bằng `viewToPdf` → `P0`, `P1`, `P2`;
   - trả về `[P1x−P0x, P1y−P0y, P2x−P0x, P2y−P0y, P0x, P0y]`. Đây là ma trận đưa hình vuông đơn vị của ảnh vào đúng chỗ, đúng cả trên trang `/Rotate` và CropBox lệch gốc.
6. **Xuất ảnh chèn** (`exportPdf.ts`):
   - không xoay/lật → **giữ nguyên** `drawImage` như hiện tại (test cũ không đổi);
   - có xoay/lật → nhúng ảnh như cũ, rồi ghi `q`, `<imagePlacementMatrix> cm`, `/<tên> Do`, `Q` bằng toán tử cấp thấp của pdf-lib (`pushGraphicsState`, `concatTransformationMatrix`, `drawObject`, `popGraphicsState`), và đăng ký XObject vào trang (`page.node.newXObject('Image', ref)`). Claude đã kiểm trong `node_modules/pdf-lib` (1.17.1): `cjs/api/operators.d.ts` có 4 hàm toán tử trên, `cjs/core/structures/PDFPageLeaf.d.ts` có `newXObject(tag: string, xObjectRef: PDFRef): PDFName`. Thêm nội dung vào trang bằng `page.pushOperators(...)` (có trong `cjs/api/PDFPage.d.ts`);
   - `opacity < 1` → giữ hành vi độ mờ như `drawImage` (ExtGState). Không làm được thì ghi rõ trong báo cáo.
7. **Xuất ảnh có sẵn** (`engine/imageTransform.ts`):
   - `ImageEdit` thêm `targetMatrix?: Matrix` và `replaceWith?: { name: string }`;
   - có `targetMatrix` → `M = targetMatrix × CTM⁻¹` (theo quy ước của `multMatrix` sẵn có; chứng minh bằng K4), bọc `q M cm Do Q` như W-10a;
   - có `replaceWith` → đổi toán tử tên của **đúng** lần `Do` đó sang tên mới. Các lần `Do` khác của cùng ảnh cũ giữ nguyên;
   - `exportPdf.ts`:
     - annotation `sourceImage` có xoay/lật **hoặc** `replacementDataUrl` → truyền `targetMatrix = imagePlacementMatrix(a, view)`; không có → giữ đường `newBbox` của W-10a;
     - `replacementDataUrl` → nhúng ảnh (`embedPng`/`embedJpg`), đăng ký XObject vào trang, truyền `replaceWith`;
   - K6 của W-10a (không đổi → giống hệt byte) phải vẫn đúng.
8. GIỮ NGUYÊN: kéo/giãn/xoá của W-10a; ảnh chèn không xoay/lật; mọi phần W-9, F-16→F-18b; engine cũ (`textRemoval.ts`, `textGeometry.ts`, `contentTokenizer.ts`, `pageContent.ts`, `textStyleProbe.ts`, `imageProbe.ts`).

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/types.ts` (chỉ thêm trường ở mục 1);
  - `src/pdf-editor/PropertiesPanel.tsx`, `src/pdf-editor/PdfCanvas.tsx` (chỉ render ảnh), `src/pdf-editor/panel.css`;
  - `src/pdf-editor/exportPdf.ts`, `src/pdf-editor/engine/imageTransform.ts`, `src/pdf-editor/imagePlacement.ts` (mới, nếu tách);
  - `src/pdf-editor/index.ts`;
  - `src/App.tsx` (chỉ nếu cần truyền callback đọc file cho panel);
  - test mới `src/pdf-editor/__tests__/w10b-*.test.ts(x)`.
- KHÔNG sửa test có sẵn. Test cũ trượt → **DỪNG**, báo tên test + lý do.
- Không thêm dependency. Fixture dựng bằng `pdf-lib` với PNG nhỏ tạo trong test (ảnh **không đối xứng**, ví dụ 3×2 px với một góc màu riêng, để kiểm được xoay/lật); dữ liệu giả.

## Tiêu chí hoàn thành
- K1 (`imagePlacementMatrix`, trang 600×400 không xoay):
  - khung `(0.1, 0.1, 0.2, 0.1)`;
  - không xoay → `[120, 0, 0, 40, 60, 320]`;
  - xoay 90° → định thức âm/dương đúng, ảnh của góc dưới-trái nằm ở vị trí dự kiến (ghi giá trị trong test);
  - lật ngang → `a < 0`.
- K2: như K1 trên trang `/Rotate 90` và trang CropBox `[100 100 700 500]`: 3 góc đổi về đúng `viewToPdf` của vị trí hiển thị (sai số < 1e-6).
- K3 (ảnh chèn, pdf.js thật): xoay 90° rồi xuất → `getOperatorList` có `paintImageXObject` với CTM khớp `imagePlacementMatrix` (±0.01). Không xoay → luồng toán tử giống hệt test xuất ảnh cũ.
- K4 (ảnh có sẵn): fixture 1 ảnh ở `(50,600,120,60)`; xoay phải 90° qua annotation `sourceImage` → CTM sau khi xuất khớp `imagePlacementMatrix` (±0.01); lật dọc → `d < 0` tương ứng.
- K5 (thay ảnh có sẵn): ảnh dùng 2 lần trên trang; thay lần thứ 2 →
  - lần 1 vẫn vẽ XObject cũ;
  - lần 2 vẽ XObject mới (khác tên);
  - kích thước XObject mới đúng ảnh thay.
- K6 (thay ảnh chèn): `imageDataUrl` đổi, chiều cao khung tính lại đúng tỉ lệ (±0.001), góc trên-trái giữ nguyên.
- K7 (jsdom): chọn ảnh → panel có 5 nút đúng `aria-label`; bấm "Xoay phải 90°" gọi `onUpdateAnnotation` với `imageRotation: 90` và khung hoán đổi quanh tâm; annotation `sourceImage` **không** có thanh Độ mờ.
- K8: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed** (gồm `w10a-*`).
- K9 (Claude kiểm tra khi QA, agent không làm):
  - PDF giả có logo:
    - xoay/lật/thay ở bản xem → file xuất đúng hướng, đúng ảnh;
    - ảnh có sẵn giữ chất lượng gốc khi chỉ xoay/lật;
  - ảnh chèn xoay/lật đúng;
  - Undo/Redo từng thao tác.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/PropertiesPanel.tsx -Pattern "Xoay phải 90°","Lật ngang","Thay ảnh"
Select-String -Path src/pdf-editor/exportPdf.ts, src/pdf-editor/engine/imageTransform.ts -Pattern "targetMatrix","replaceWith"
git diff --stat -- src/pdf-editor/__tests__/
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Các Select-String có kết quả.
- Thư mục test: chỉ file `w10b-*` mới.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

Sau đó chạy **Bước Y** (`00_RULES.md`) với:
```powershell
$Branch = 'feat/w10b-image-rotate-flip-replace'
$Msg    = 'feat(W-10b): rotate, flip and replace existing and inserted images'
$Paths  = @('src/types.ts', 'src/App.tsx', 'src/pdf-editor')
$Expect = 1
```

## Báo cáo
Dòng đầu là `PUSH OK: …`. Sau đó theo `00_RULES.md` (output Bước A, toàn bộ output Bước Y, tổng kết vitest 2 lần), cộng thêm:
- bảng `K | tên test | pass`;
- cách tính 3 góc ảnh khi xoay/lật, và số liệu K1, K4;
- các hàm pdf-lib cấp thấp đã dùng (tên đúng trong `node_modules/pdf-lib`);
- độ mờ của ảnh chèn xoay/lật có giữ được không;
- danh sách `TODO(verify)`.
