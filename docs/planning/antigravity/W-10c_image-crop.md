# [W-10c] PDF Editor: cắt ảnh (crop) cho ảnh có sẵn và ảnh chèn, file xuất chỉ hiện phần đã cắt

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm (mục **Ba điều bắt buộc** và **Bước Y**).
Tiền điều kiện: W-10b đã merge (PR #83).
Nhánh: `feat/w10c-image-crop` (tạo từ `main`) · Commit: `feat(W-10c): crop existing and inserted images with clipping on export`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi Bước Y in `PUSH OK` – dòng đó là dòng ĐẦU TIÊN của báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w10c-image-crop
npm ci
```
Lệnh an toàn: không dùng `npx` với package ngoài `package.json`; không chạy dev server, không mở trình duyệt; lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Phạm vi
Phần còn lại của W-10 được chia:
- **W-10c (task này):** cắt ảnh.
- **W-10d (sau):** sắp lớp (đưa lên trên/xuống dưới).
- **W-10e (sau):** ảnh trong Form XObject và ảnh inline.

Task này **chỉ** làm cắt ảnh.

## Vấn đề (Claude đọc code trên `main` @ `03b3462`)
1. Không có cách cắt bớt viền ảnh (ví dụ bỏ phần trắng quanh chữ ký scan, cắt một phần logo). Panel "Ảnh" (`PropertiesPanel.tsx`, ~dòng 340-400) chỉ có xoay/lật/thay.
2. Đường xuất hiện có:
   - ảnh có sẵn: `applyImageEdits` với `targetMatrix` (`exportPdf.ts` ~dòng 228-240, `engine/imageTransform.ts`);
   - ảnh chèn xoay/lật: `pushOperators` (`exportPdf.ts` ~dòng 637-670);
   - ảnh chèn thường: `drawImage`;
   - ma trận đặt ảnh: `imagePlacementMatrix(a, view)` (`imagePlacement.ts`), đưa hình vuông đơn vị của ảnh vào đúng khung hiển thị, tính cả xoay/lật.
3. Bản xem ảnh (`PdfCanvas.tsx` ~dòng 570-590) đặt `<img>` giữa khung và xoay/lật bằng CSS.

## Logic cần đạt
1. **Kiểu dữ liệu** (`src/types.ts`): `imageCrop?: { left: number; top: number; right: number; bottom: number }`.
   - Phần trăm (0–1) bị cắt ở mỗi cạnh, tính trên **ảnh gốc đứng thẳng**, tức trước khi lật/xoay.
   - Ràng buộc: mỗi giá trị ≥ 0; `left + right ≤ 0.9`; `top + bottom ≤ 0.9`.
2. **Ý nghĩa khung:**
   - `x/y/width/height` luôn là khung **phần còn lại sau khi cắt**, đã lật/xoay, đúng như người dùng thấy;
   - đổi số cắt → **phần ảnh còn lại giữ nguyên vị trí trên trang**; khung co/giãn tương ứng.
   - Ví dụ: không xoay, tăng `left` từ 0 lên 0.1 → `x` tăng và `width` giảm đúng bằng 10% bề rộng ảnh đầy đủ.
   - Có xoay/lật thì cạnh "trái của ảnh gốc" ứng với cạnh khác trên màn hình. Tính theo `imageRotation`, `flipH`, `flipV`.
3. **Panel "Ảnh"** (`PropertiesPanel.tsx`):
   - nhóm "Cắt ảnh" gồm 4 ô số Trái / Trên / Phải / Dưới (đơn vị %, bước 1, 0–90) và nút `Bỏ cắt`;
   - các ô có `aria-label` tiếng Việt (`Cắt trái (%)`…). Nhãn chỉ cạnh **của ảnh gốc**; thêm dòng chú thích nhỏ "theo ảnh gốc, trước khi xoay/lật";
   - mỗi lần đổi là một bước lịch sử, kiểu `'resize'`. Vượt ràng buộc → giữ giá trị hợp lệ gần nhất;
   - áp dụng cho annotation `type: 'image'`, cả `sourceImage` lẫn ảnh chèn.
4. **Bản xem** (`PdfCanvas.tsx`):
   - khung annotation `overflow: hidden`;
   - bên trong là ảnh **đầy đủ** (ảnh preview của ảnh có sẵn, hoặc `imageDataUrl`/`replacementDataUrl`), kích thước và vị trí sao cho phần không bị cắt lấp đúng khung, vẫn xoay/lật bằng CSS như W-10b;
   - khung chọn (8 tay nắm) theo khung đã cắt. Kéo/giãn khung giữ nguyên `imageCrop`.
5. **Xuất** – hàm thuần mới trong `imagePlacement.ts`:
   ```ts
   export function croppedImageMatrix(a: Annotation, view: PageView): { matrix: Matrix; clip: Rect }
   ```
   - `P = imagePlacementMatrix(a, view)`: đưa hình vuông đơn vị vào khung **phần còn lại**;
   - `S = [sx, 0, 0, sy, l, b]`, với `sx = 1 − left − right`, `sy = 1 − top − bottom`, `l = left`, `b = bottom` (toạ độ ảnh PDF: gốc dưới-trái). `S` đưa hình vuông đơn vị vào phần còn lại;
   - ma trận ảnh đầy đủ `F = S⁻¹ × P` (theo quy ước nhân của `multMatrix`; chứng minh bằng K2). `matrix = F`;
   - `clip` = khung annotation đổi sang PDF bằng `viewToPdf` 4 góc (hình chữ nhật bao);
   - không có `imageCrop` (hoặc tất cả = 0) → **giữ nguyên** các đường xuất hiện tại, test cũ không đổi.
6. **Xuất ảnh có crop:**
   - **Ảnh chèn:** `pushOperators` với chuỗi `q`, `clip.x clip.y clip.w clip.h re`, `W`, `n`, `F cm`, `/<tên> Do`, `Q`. Dùng toán tử pdf-lib có sẵn: `rectangle(x, y, w, h)`, `clip()`, `endPath()`. Claude đã kiểm các hàm này có trong `node_modules/pdf-lib/cjs/api/operators.d.ts` (1.17.1). Độ mờ giữ cách làm của W-10b.
   - **Ảnh có sẵn:**
     - `ImageEdit` thêm `clip?: Rect`;
     - `applyImageEdits` bọc chuỗi `q`, `<clip> re W n`, `M cm`, `Do`, `Q`, với `M = F × CTM⁻¹` như W-10b;
     - clip tính theo toạ độ trang. Vì `re W n` nằm trước `cm` nên clip dùng CTM hiện tại tại vị trí `Do`. Phải đổi clip từ toạ độ trang sang hệ toạ độ hiện tại bằng `CTM⁻¹`. Không chắc → `TODO(verify)` và chứng minh bằng K4 trên trang có `cm` khác đơn vị trước `Do`.
7. GIỮ NGUYÊN: W-10a/b (kéo, giãn, xoá, xoay, lật, thay); `writePageContent` (W-10b2); engine khác.

## Ràng buộc
- Chỉ được sửa:
  - `src/types.ts` (chỉ `imageCrop`);
  - `src/pdf-editor/PropertiesPanel.tsx`, `src/pdf-editor/panel.css`, `src/pdf-editor/PdfCanvas.tsx` (chỉ render ảnh);
  - `src/pdf-editor/imagePlacement.ts`, `src/pdf-editor/exportPdf.ts`, `src/pdf-editor/engine/imageTransform.ts`, `src/pdf-editor/index.ts`;
  - test mới `src/pdf-editor/__tests__/w10c-*.test.ts(x)`.
- KHÔNG sửa test có sẵn. Test cũ trượt → **DỪNG**, báo tên test + lý do.
- Không thêm dependency. Fixture `pdf-lib` + PNG nhỏ **không đối xứng** tạo trong test (ví dụ 4×2 px, mỗi ô một màu), dữ liệu giả.

## Tiêu chí hoàn thành
- K1 (khung khi đổi crop): ảnh chèn khung `(0.2, 0.2, 0.4, 0.2)`, không xoay:
  - `left = 0.25` → `x = 0.3`, `width = 0.3`;
  - xoay 90° rồi đặt `left = 0.25` → cạnh tương ứng trên màn hình co lại đúng (ghi rõ cạnh nào trong test).
- K2 (`croppedImageMatrix`):
  - trang 600×400, khung `(0.1, 0.1, 0.2, 0.1)`, crop `{ left: 0.5 }` → ảnh của điểm `(0.5, 0)` (ảnh gốc) qua `F` trùng góc dưới-trái của `clip` (±0.01pt);
  - ảnh của `(1, 1)` trùng góc trên-phải `clip`;
  - có xoay 90° và lật ngang: 2 điểm tương ứng vẫn trùng.
- K3 (ảnh chèn, pdf.js thật): xuất ảnh 4×2 crop `{ left: 0.5 }` → `getOperatorList` có lệnh clip (`OPS.clip`/`eoClip`) trước `paintImageXObject`, CTM ảnh = `F` (±0.01). Render trang bằng pdf.js (canvas của jsdom hoặc kiểm toán tử) để thấy chỉ nửa phải ảnh. Không render được → kiểm toán tử là đủ, ghi rõ.
- K4 (ảnh có sẵn): fixture đặt ảnh trong `q 2 0 0 2 0 0 cm … Do Q` (có `cm` khác đơn vị); crop `{ top: 0.5 }` → clip đúng toạ độ trang (±0.5pt), ảnh giữ XObject gốc (không nhúng lại).
- K5 (hồi quy): không crop → luồng toán tử của ảnh chèn thường, ảnh chèn xoay/lật, ảnh có sẵn giống hệt trước (test W-10a/b vẫn pass).
- K6 (jsdom): panel có 4 ô `aria-label` `Cắt trái (%)`, `Cắt trên (%)`, `Cắt phải (%)`, `Cắt dưới (%)` và nút `Bỏ cắt`; nhập `left = 60` khi `right = 40` → bị giới hạn để `left + right ≤ 90`.
- K7: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed**.
- K8 (Claude kiểm tra khi QA, agent không làm):
  - ảnh có sẵn và ảnh chèn: cắt 4 cạnh, kết hợp xoay/lật → bản xem và file xuất cùng phần ảnh;
  - Undo/Redo;
  - ảnh có sẵn giữ chất lượng gốc.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/PropertiesPanel.tsx -Pattern "Cắt trái","Bỏ cắt"
Select-String -Path src/pdf-editor/imagePlacement.ts -Pattern "croppedImageMatrix"
git diff --stat -- src/pdf-editor/__tests__/
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Các Select-String có kết quả.
- Thư mục test: chỉ file `w10c-*` mới.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

Sau đó chạy **Bước Y** (`00_RULES.md`) với:
```powershell
$Branch = 'feat/w10c-image-crop'
$Msg    = 'feat(W-10c): crop existing and inserted images with clipping on export'
$Paths  = @('src/types.ts', 'src/pdf-editor')
$Expect = 1
```

## Báo cáo
Dòng đầu là `PUSH OK: …`. Sau đó theo `00_RULES.md` (output Bước A, toàn bộ output Bước Y, tổng kết vitest 2 lần), cộng thêm:
- bảng `K | tên test | pass`;
- công thức `F`, cách đổi clip về hệ toạ độ tại `Do`, số liệu K2/K4;
- tên toán tử pdf-lib đã dùng cho clip;
- danh sách `TODO(verify)`.
