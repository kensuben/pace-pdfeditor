# [W-8] PDF Editor: chọn đối tượng có khung + 8 tay nắm, kéo di chuyển/giãn mọi loại đối tượng, dịch bằng phím mũi tên, thêm chữ không qua hộp thoại

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (lỗi B7, B8, B10, B11; quyết định Q-P4).
Tiền điều kiện: W-7 đã merge vào `main` (PR #42). Có thể làm **song song với F-12** (F-12 chỉ sửa `exportPdf.ts`).
Nhánh: `feat/w8-selection-move-resize` (tạo từ `main`) · Commit: `feat(W-8): selection frame with resize handles, drag-move for all objects, arrow-key nudge, inline text creation`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w8-selection-move-resize
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề (đọc trên `main` @ `03d6d06`)
1. **Chỉ ảnh chèn mới kéo được** (`src/pdf-editor/PdfCanvas.tsx`, state `imageDrag` `:50-59` và effect `:60-96`).
   - Text box mới, highlight, nét vẽ/chữ ký tay: chỉ chọn được (`onSelect`), không kéo, không giãn được (B7).
   - Không có khung chọn, không có tay nắm.
2. **Ảnh chỉ phóng/thu ±10% bằng 2 nút** (`src/App.tsx`, `scaleSelectedImage` `:190-199`, nút `:595`). Không giãn tự do được (B8).
3. **Ảnh chèn bị méo trên trang không phải Letter dọc**: chiều cao tính bằng hệ số cố định `.77` (`App.tsx:280`), tức tỉ lệ 612/792 (B10).
4. **Thêm chữ bằng `window.prompt('Enter text')`** (`PdfCanvas.tsx:179`), không gõ trực tiếp trên trang (B11).
5. Không có phím mũi tên để dịch đối tượng. Phím tắt hiện có: Ctrl+Z / Ctrl+Shift+Z, Delete/Backspace (`App.tsx:232-241`).
6. Nét vẽ/chữ ký (`type: 'draw' | 'signature'`) lưu bằng `points` (toạ độ 0–1), `width = height = 0` (`PdfCanvas.tsx:182`). Muốn có khung chọn thì phải tính hộp bao từ `points`.
7. **Chữ thay thế chữ gốc** (`replaceOriginal: true`, tạo ở `src/pdf-editor/textEdit.ts`): khi xuất, hình chữ nhật che được vẽ **đúng tại `x, y` của annotation** (`exportPdf.ts`). Nếu cho kéo đi, chỗ che cũng đi theo, làm **lộ chữ gốc**. W-9 sẽ xoá chữ gốc thật; đến lúc đó mới cho di chuyển loại này.

## Logic cần đạt
Toạ độ vẫn lưu dạng tỉ lệ 0–1 của trang như hiện tại (không đổi kiểu `Annotation` trong `src/types.ts`).

1. **Hàm thuần** `src/pdf-editor/selection/geometry.ts`. Mọi hàm nhận/trả toạ độ 0–1 và giữ đối tượng nằm trong trang (`[0,1]`):
   - `getBounds(a: Annotation): Rect`: với nét vẽ/chữ ký lấy hộp bao của `points`; loại khác lấy `x, y, width, height`.
   - `moveBy(a, dx, dy): Annotation`: nét vẽ thì dịch mọi điểm; loại khác dịch `x, y`. Kẹp sao cho **cả hộp bao** nằm trong trang.
   - `resizeFromHandle(a, handle, dx, dy, opts: { keepAspect: boolean; minSize: { w: number; h: number } }): Annotation`.
     - `handle` ∈ `'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'`. Cạnh/góc đối diện đứng yên.
     - `keepAspect` chỉ áp dụng cho tay nắm góc.
     - Không nhỏ hơn `minSize`, không lật âm.
     - Nét vẽ/chữ ký: co giãn mọi điểm quanh góc đối diện.
   - `nudgeDelta(pagePt: { width: number; height: number }, stepPt: number, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): { dx: number; dy: number }`: đổi bước theo point (pt) sang tỉ lệ.
   - `imageInsertSize(imgPx: { w: number; h: number }, pagePt: { width: number; height: number }): { width: number; height: number }`:
     - rộng mặc định 0,28 trang, giữ **đúng tỉ lệ ảnh theo pt của trang**;
     - nếu cao > 0,35 trang thì giảm cả hai theo cùng tỉ lệ. Thay cho hệ số `.77`.
2. **Khung chọn** `src/pdf-editor/selection/SelectionFrame.tsx` (+ `selection.css`, dùng token trong `src/pace-theme.css`):
   - Viền quanh `getBounds` của đối tượng đang chọn, cùng 8 tay nắm (vuông ~8px CSS, có `aria-label` tiếng Việt, ví dụ "Kéo giãn góc trên trái").
   - Kéo phần thân = di chuyển; kéo tay nắm = giãn. Dùng `setPointerCapture`.
   - **Trong lúc kéo chỉ cập nhật bản xem trước** (state cục bộ), **không** `commit`. Thả chuột → `commit` **đúng 1 lần** (1 bước Undo).
   - Ảnh: tay nắm góc mặc định giữ tỉ lệ, giữ Shift khi kéo thì giãn tự do. Nét vẽ/chữ ký: chỉ có 4 tay nắm góc, luôn giữ tỉ lệ. Text box, highlight: giãn tự do.
   - Text box: giãn chỉ đổi khung, **không đổi `fontSize`**.
   - `minSize`: 8px CSS quy đổi theo zoom hiện tại.
   - Annotation `replaceOriginal: true`: có viền chọn, **không có tay nắm, không kéo được**. Con trỏ `not-allowed`, `title` = "Chữ thay thế chữ gốc chưa di chuyển được (sẽ hỗ trợ khi xoá chữ gốc thật)". Vẫn sửa nội dung (double-click) và xoá được như hiện tại.
3. **Bỏ code cũ:** state `imageDrag` + effect (`PdfCanvas.tsx:50-96`), `scaleSelectedImage` và 2 nút phóng/thu ảnh (`App.tsx:190-199`, `:595`). Ảnh kéo/giãn bằng khung chọn.
4. **Phím tắt** (khung trang đang hoạt động, focus **không** nằm trong `input/textarea/select/[contenteditable]`):
   - Mũi tên: dịch 1 pt; Shift + mũi tên: dịch 10 pt.
   - Mỗi lần nhấn `commit` một bước history **không ghi activity log**. Thêm tham số tuỳ chọn cho `commit` nếu cần; không đổi chữ ký các lời gọi hiện có.
   - Esc: bỏ chọn.
   - Không áp dụng cho `replaceOriginal`.
   - Delete/Backspace giữ nguyên.
5. **Thêm chữ không qua hộp thoại:**
   - Công cụ "Thêm chữ": click hoặc kéo trên trang → tạo khung và **mở ngay `textarea` soạn tại chỗ** (dùng lại `inline-text-editor`, style theo `textStyle` hiện tại).
   - Enter hoặc rời focus: nếu có chữ (sau `trim`) → `onAdd` (1 bước history, activity `annotation.added` như cũ). Esc hoặc rỗng → không tạo gì.
   - Xoá dòng `window.prompt`.
6. **Chèn ảnh đúng tỉ lệ:** `insertImage` (`App.tsx:276+`) lấy kích thước trang hiện tại (`pdf.getPage(page)` → `getViewport({ scale: 1 })`) rồi gọi `imageInsertSize`.
7. **Activity log:** kéo di chuyển dùng lại `annotation.moved` (như `App.tsx:609`). Giãn dùng **chuỗi mới** `annotation.resized` / "Thay đổi kích thước đối tượng", metadata `{ type, page }`. Không ghi toạ độ chi tiết, không ghi nội dung.
8. **Q-P4 (màn hình < 1024px):** chỉ chọn (viền) + xoá; không hiện tay nắm, không kéo/giãn, không nudge. Dùng `window.matchMedia('(min-width: 1024px)')` có lắng nghe thay đổi (hook `src/pdf-editor/useDesktopEditor.ts`).
9. GIỮ NGUYÊN: định dạng file xuất, công cụ highlight/vẽ/chữ ký (tạo mới), sửa vùng chữ gốc (click dòng chữ ở công cụ Chọn), Undo/Redo, các chuỗi activity log cũ.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/pdf-editor/PdfCanvas.tsx`, `src/App.tsx`, `src/pdf-editor/index.ts`;
  - `src/pdf-editor/selection/**` (mới), `src/pdf-editor/useDesktopEditor.ts` (mới);
  - `src/pdf-editor/__tests__/selection-*.test.ts` (mới).
- KHÔNG sửa:
  - `src/types.ts`, `src/pdf-editor/exportPdf.ts` (F-12 đang sửa song song), `src/pdf-editor/engine/**`;
  - CSS có sẵn, `server/`, `public/`.
- Không thêm dependency.
- Thanh định dạng chữ (`TextFormatBar`) giữ nguyên. Panel thuộc tính và đường gióng để task sau (W-8b), **không làm ở đây**.

## Tiêu chí hoàn thành
- K1 (test `getBounds`/`moveBy`):
  - nét vẽ 3 điểm → hộp bao đúng;
  - `moveBy` vượt mép phải → kẹp, hộp bao chạm đúng 1,0;
  - highlight `moveBy(0.1, 0.05)` → `x, y` tăng đúng.
- K2 (test `resizeFromHandle`):
  - `se` +0,1/+0,1 → `width, height` tăng 0,1, `x, y` giữ nguyên;
  - `nw` +0,1/+0,1 → `x, y` tăng 0,1, `width, height` giảm 0,1;
  - kéo quá nhỏ → bằng `minSize`, không âm;
  - `keepAspect` ở góc `se` với ảnh 2:1 → tỉ lệ giữ 2:1 (sai số ≤ 1e-6);
  - tay nắm cạnh `e` không bị ảnh hưởng bởi `keepAspect`;
  - nét vẽ giãn ×2 quanh góc `nw` → các điểm cách góc gấp đôi.
- K3 (test `nudgeDelta`): trang 600×800 pt, bước 1 pt, `ArrowRight` → `dx = 1/600`. Shift (10 pt) `ArrowDown` → `dy = 10/800`.
- K4 (test `imageInsertSize`):
  - ảnh 400×200 px trên trang dọc 595×842 → `width = 0.28`, `height = 0.28*595*(200/400)/842` (sai số ≤ 1e-6);
  - trên trang ngang 842×595 → tỉ lệ pt vẫn đúng 2:1;
  - ảnh rất cao → `height = 0.35`, `width` giảm tương ứng.
- K5: `Select-String "window.prompt"` trong `src/pdf-editor/` → không có kết quả. `scaleSelectedImage`, `imageDrag` không còn trong `src/`.
- K6: `npm run lint`, `npm run build` xanh. `vitest run` kết thúc, mọi test cũ pass.
- K7 (Claude kiểm tra khi QA, agent không làm). Trên trình duyệt:
  - 1280px:
    - kéo di chuyển/giãn text box, ảnh (giữ tỉ lệ; Shift = tự do), highlight, nét vẽ;
    - 1 lần kéo = 1 lần Undo;
    - mũi tên/Shift+mũi tên dịch đúng;
    - thêm chữ gõ tại chỗ;
    - chữ thay thế chữ gốc không kéo được;
    - xuất PDF thấy vị trí/kích thước mới.
  - 768px và 390px: không có tay nắm, vẫn chọn + xoá được, không vỡ bố cục.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/*.tsx,src/pdf-editor/**/*.tsx -Pattern "window.prompt"
Select-String -Path src/App.tsx,src/pdf-editor/*.tsx -Pattern "scaleSelectedImage","imageDrag","\*\.77"
Select-String -Path src/App.tsx -Pattern "annotation.resized"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/App.tsx src/pdf-editor
git commit -m "feat(W-8): selection frame with resize handles, drag-move for all objects, arrow-key nudge, inline text creation"
git push -u origin feat/w8-selection-move-resize
```
Kỳ vọng:
- `git diff --stat` / `git status --porcelain`: chỉ file trong Ràng buộc.
- Select-String `window.prompt`: không có kết quả.
- Select-String `scaleSelectedImage` / `imageDrag` / `*.77`: không có kết quả.
- Select-String `annotation.resized`: có ít nhất 1 kết quả.
- lint/build xanh; vitest kết thúc, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w8-selection-move-resize
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w8-selection-move-resize
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- danh sách tay nắm theo từng loại đối tượng;
- cách xử lý xem trước khi kéo (state nào, commit ở đâu);
- danh sách `TODO(verify)`.
