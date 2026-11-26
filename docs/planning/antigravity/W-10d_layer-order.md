# [W-10d] PDF Editor: sắp lớp đối tượng (đưa lên trên/xuống dưới), kể cả ảnh có sẵn so với nội dung gốc của trang

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm (mục **Ba điều bắt buộc** và **Bước Y**).
Tiền điều kiện: W-10c đã merge (PR #85).
Nhánh: `feat/w10d-layer-order` (tạo từ `main`) · Commit: `feat(W-10d): bring forward and send backward for annotations and existing images`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi Bước Y in `PUSH OK` – dòng đó là dòng ĐẦU TIÊN của báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w10d-layer-order
npm ci
```
Lệnh an toàn: không dùng `npx` với package ngoài `package.json`; không chạy dev server, không mở trình duyệt; lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Phạm vi
- **W-10d (task này):** sắp lớp.
- **W-10e (sau):** ảnh trong Form XObject và ảnh inline.

## Vấn đề (Claude đọc code trên `main` @ `dc93715`)
1. **Không đổi được thứ tự chồng lớp.**
   - Ảnh chèn đè lên chữ mới thêm, hoặc highlight nằm dưới ảnh: người dùng không có cách đưa đối tượng lên/xuống.
   - Panel (`PropertiesPanel.tsx`) không có nhóm "Sắp lớp".
2. **Thứ tự hiện tại không nhất quán:**
   - **Xuất:** `exportPdf.ts` (~dòng 421, `for (const a of annotations)`) vẽ theo **thứ tự mảng** `annotations`. Đối tượng sau nằm trên.
   - **Bản xem:** `PdfCanvas.tsx` render theo thứ tự mảng (~dòng 495), nhưng ảnh có `zIndex: 20` cố định (~dòng 543), lớp che ảnh có sẵn `zIndex: 9` (~dòng 529). Ảnh **luôn** nằm trên chữ/highlight ở bản xem dù trong file xuất có thể nằm dưới.
3. **Ảnh có sẵn so với nội dung gốc của trang:**
   - `applyImageEdits` (`engine/imageTransform.ts`) giữ toán tử `Do` tại **đúng vị trí cũ** trong content stream, nên ảnh có sẵn luôn giữ thứ tự gốc so với chữ/hình gốc của trang.
   - Logo nằm dưới nền màu, hay ảnh chữ ký nằm trên chữ, không chỉnh được.

## Logic cần đạt
1. **Sắp lớp annotation** (hàm thuần mới `src/pdf-editor/layers.ts`):
   ```ts
   export type LayerAction = 'front' | 'forward' | 'backward' | 'back'
   export function reorderAnnotations(annotations: Annotation[], id: string, action: LayerAction): Annotation[]
   ```
   - Chỉ đổi thứ tự **giữa các annotation cùng trang** (`page` của annotation được chọn). Vị trí tương đối của annotation trang khác giữ nguyên trong mảng.
   - Bỏ qua annotation `deleted`: không tính là "lớp" khi tìm vị trí kế tiếp.
   - Đã ở trên cùng mà chọn `front`/`forward` (hoặc dưới cùng mà chọn `back`/`backward`) → trả **đúng mảng cũ** (cùng tham chiếu), để App không tạo bước lịch sử thừa.
2. **Ảnh có sẵn so với nội dung gốc:**
   - thêm `pageLayer?: 'original' | 'top' | 'bottom'` vào `Annotation` (chỉ dùng khi có `sourceImage`, mặc định `'original'`);
   - với annotation `sourceImage`:
     - `front` → `pageLayer = 'top'` (nằm trên toàn bộ nội dung gốc của trang), **và** đưa annotation lên cuối nhóm như mục 1;
     - `back` → `pageLayer = 'bottom'` (nằm dưới toàn bộ nội dung gốc);
     - `forward`/`backward` → chỉ đổi thứ tự annotation như mục 1, **không** đổi `pageLayer`.
   - Thứ tự cuối cùng trong file:
     ```
     [ảnh có sẵn 'bottom'] → nội dung gốc (ảnh 'original' ở vị trí cũ) → [ảnh có sẵn 'top'] → annotation khác theo thứ tự mảng
     ```
3. **Panel** (`PropertiesPanel.tsx`):
   - nhóm "Sắp lớp" cho **mọi** annotation đang chọn;
   - 4 nút có `aria-label`/`title`: `Đưa lên trên cùng`, `Đưa lên một lớp`, `Đưa xuống một lớp`, `Đưa xuống dưới cùng`;
   - nút không có tác dụng (đã ở trên/dưới cùng) thì `disabled`;
   - prop mới `onReorder(id: string, action: LayerAction)`.
4. **App** (`App.tsx`):
   - xử lý `onReorder` bằng `reorderAnnotations` (+ cập nhật `pageLayer` cho `sourceImage`);
   - mảng không đổi → không commit;
   - đổi → `commit(…, { action: 'annotation.reordered', description: 'Sắp lớp đối tượng', metadata: { page, layer: action } })`, metadata không chứa nội dung;
   - phím tắt: `Ctrl+]` lên một lớp, `Ctrl+[` xuống một lớp, `Ctrl+Shift+]` lên trên cùng, `Ctrl+Shift+[` xuống dưới cùng (macOS dùng `Cmd`):
     - nhận phím bằng `e.code === 'BracketRight' / 'BracketLeft'`, không dùng `e.key` (với Shift, `e.key` thành `}`/`{` và khác nhau theo bàn phím);
     - gọi `e.preventDefault()`, vì `Cmd+[`/`Cmd+]` trên macOS là lùi/tiến trang của trình duyệt;
     - đặt cạnh khối phím tắt sẵn có (`App.tsx` ~dòng 386-410, nơi xử lý `Ctrl+Z`, zoom);
     - chỉ áp dụng khi có đối tượng đang chọn và **không** đang gõ trong ô nhập.
5. **Bản xem** (`PdfCanvas.tsx`):
   - mọi annotation trên trang có `zIndex` theo **thứ tự mảng** (ví dụ `20 + chỉ số trong nhóm trang`), thay cho `zIndex: 20` cố định của ảnh. Lớp che ảnh có sẵn (`source-image-mask`) giữ dưới mọi annotation;
   - ảnh có sẵn `pageLayer = 'bottom'`: bản xem không thể vẽ dưới canvas trang, nên dùng `mix-blend-mode: multiply` cho ảnh preview (chữ đen của trang vẫn nhìn thấy xuyên qua phần nền sáng của ảnh). Ghi chú giới hạn này trong báo cáo.
6. **Xuất** (`engine/imageTransform.ts` + `exportPdf.ts`):
   - `ImageEdit` thêm `layer?: 'top' | 'bottom'` và `pageMatrix?: Matrix`. `pageMatrix` là ma trận đặt ảnh trong toạ độ **trang** = `croppedImageMatrix(a, view).matrix`, kèm `clip` nếu có crop;
   - `layer` có giá trị → bỏ `Do` ở vị trí cũ (như `remove`), rồi:
     - `bottom` → **chèn vào đầu** content stream: `q`, `[clip re W n]`, `pageMatrix cm`, `/Name Do`, `Q`;
     - `top` → bọc toàn bộ nội dung cũ trong `q … Q` (tránh CTM/clip còn hiệu lực ở cuối stream), rồi **thêm vào cuối** cùng chuỗi trên;
   - nhiều ảnh cùng `layer` → giữ thứ tự theo thứ tự annotation trong mảng;
   - `pageLayer = 'original'` hoặc không có → giữ nguyên hành vi W-10a/b/c;
   - `replaceWith` vẫn áp dụng (tên XObject mới).
7. GIỮ NGUYÊN: W-10a/b/c; W-9 (xoá chữ chạy sau sửa ảnh, đọc content đã ghi lại); `writePageContent` (W-10b2); engine khác.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/types.ts` (chỉ `pageLayer`);
  - `src/pdf-editor/layers.ts` (mới);
  - `src/pdf-editor/PropertiesPanel.tsx`, `src/pdf-editor/panel.css`;
  - `src/pdf-editor/PdfCanvas.tsx` (chỉ `zIndex` và `mix-blend-mode`);
  - `src/pdf-editor/exportPdf.ts`, `src/pdf-editor/engine/imageTransform.ts`, `src/pdf-editor/index.ts`;
  - `src/App.tsx` (chỉ `onReorder` + phím tắt);
  - test mới `src/pdf-editor/__tests__/w10d-*.test.ts(x)`.
- KHÔNG sửa test có sẵn. Test cũ trượt → **DỪNG**, báo tên test + lý do.
- Không thêm dependency. Fixture `pdf-lib`, PNG nhỏ tạo trong test, dữ liệu giả.

## Tiêu chí hoàn thành
- K1 (`reorderAnnotations`):
  - trang 1 có `[A, B, C]`, trang 2 có `[D]` xen giữa (`[A, D, B, C]`);
  - kết quả:
    - `front(A)` → thứ tự trang 1 `B, C, A`; D giữ vị trí tương đối;
    - `forward(A)` → `B, A, C`;
    - `back(C)` → `C, A, B`;
    - `front(C)` → **cùng tham chiếu** mảng cũ;
    - annotation `deleted` bị bỏ qua khi tính.
- K2 (xuất thứ tự annotation, pdf.js thật): ảnh chèn + highlight chồng nhau.
  - `back(ảnh)` → trong `getOperatorList`, `paintImageXObject` đứng **trước** lệnh tô highlight;
  - `front(ảnh)` → đứng sau.
- K3 (ảnh có sẵn `bottom`):
  - fixture có chữ vẽ trước, ảnh vẽ sau;
  - `back` → `paintImageXObject` đứng **trước** mọi `showText`, CTM ảnh giữ đúng vị trí cũ (±0.01).
- K4 (ảnh có sẵn `top`):
  - fixture có ảnh vẽ trước, hình chữ nhật tô màu vẽ sau đè lên ảnh;
  - `front` → `paintImageXObject` đứng **sau** lệnh tô; CTM đúng.
  - Fixture thêm `q 1 0 0 1 50 50 cm` **không đóng** `Q` ở cuối stream → ảnh vẫn đúng vị trí (chứng minh việc bọc `q … Q`).
- K5 (kết hợp): ảnh có sẵn xoay 90° + crop + `top` → CTM khớp `croppedImageMatrix` và có clip trước ảnh.
- K6 (jsdom): panel có 4 nút đúng `aria-label`; đối tượng trên cùng → 2 nút "lên" `disabled`. `keydown` với `code: 'BracketRight'` + `ctrlKey` gọi `onReorder(id, 'forward')` và `defaultPrevented = true`.
- K7 (jsdom, bản xem): 2 annotation (highlight, ảnh) → `zIndex` của div theo thứ tự mảng; sau `back(ảnh)` ảnh có `zIndex` nhỏ hơn highlight.
- K8: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed**.
- K9 (Claude kiểm tra khi QA, agent không làm):
  - ảnh chèn đè chữ → đưa xuống dưới → bản xem và file xuất khớp;
  - logo có sẵn đưa xuống dưới nền màu / chữ ký đưa lên trên chữ → file xuất đúng (đối chiếu poppler);
  - phím tắt; Undo/Redo.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/PropertiesPanel.tsx -Pattern "Đưa lên trên cùng","Đưa xuống dưới cùng"
Select-String -Path src/pdf-editor/engine/imageTransform.ts -Pattern "layer"
Select-String -Path src/pdf-editor/PdfCanvas.tsx -Pattern "zIndex: 20,"
git diff --stat -- src/pdf-editor/__tests__/
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- 2 Select-String đầu có kết quả.
- `zIndex: 20,` cố định: **không có** kết quả.
- Thư mục test: chỉ file `w10d-*` mới.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

Sau đó chạy **Bước Y** (`00_RULES.md`) với:
```powershell
$Branch = 'feat/w10d-layer-order'
$Msg    = 'feat(W-10d): bring forward and send backward for annotations and existing images'
$Paths  = @('src/types.ts', 'src/App.tsx', 'src/pdf-editor')
$Expect = 1
```

## Báo cáo
Dòng đầu là `PUSH OK: …`. Sau đó theo `00_RULES.md` (output Bước A, toàn bộ output Bước Y, tổng kết vitest 2 lần), cộng thêm:
- bảng `K | tên test | pass`;
- cách chèn đầu/cuối content stream và bọc `q … Q`;
- giới hạn của bản xem với `pageLayer = 'bottom'`;
- danh sách `TODO(verify)`.
