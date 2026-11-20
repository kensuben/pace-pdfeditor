# [F-13] Highlight hiện đúng màu trên màn hình (hiện chỉ thấy khi xuất PDF), xem trước dạng hình chữ nhật khi kéo

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (lỗi B20).
Tiền điều kiện: W-8 đã merge vào `main` (PR #44). Có thể làm **song song với F-12** (F-12 chỉ sửa `exportPdf.ts`).
Nhánh: `fix/f13-highlight-visible` (tạo từ `main`) · Commit: `fix(F-13): render highlight fill on screen and show rectangle preview while dragging`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f13-highlight-visible
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề (đọc trên `main` @ `f8c2cb8`; Claude đã kiểm trên trình duyệt)
1. **B20 – highlight không hiện trên màn hình** (lỗi có từ bản phát hành đầu tiên).
   - `src/pdf-editor/PdfCanvas.tsx:454-476` render mọi annotation không phải ảnh/nét vẽ bằng `<div className="annotation {type}">` với `style` gồm `color: a.color` và `opacity`, **không có màu nền**.
   - CSS chỉ có `.annotation.highlight{mix-blend-mode:multiply}` (`src/styles.css`).
   - Đo trên Chromium: `getComputedStyle(.annotation.highlight).backgroundColor = rgba(0, 0, 0, 0)` → vùng đánh dấu **trong suốt**, chỉ thấy viền nét đứt khi đang chọn.
   - File PDF xuất ra thì **có** vệt màu (`exportPdf.ts` vẽ `drawRectangle` với `color` + `opacity`).
   - Hậu quả: người dùng tưởng công cụ "Đánh dấu" không chạy và đánh dấu nhiều lần; file xuất lại có nhiều vệt chồng nhau.
2. **Xem trước khi kéo sai hình:** khi kéo tạo highlight, `PdfCanvas.tsx:533-536` vẽ bản xem trước bằng **đường nét tự do** (`svg.ink.draft` theo `draft`) thay vì hình chữ nhật sẽ được tạo. Công cụ "Thêm chữ" cũng vậy.

## Logic cần đạt
1. **Hàm thuần** `src/pdf-editor/annotationStyle.ts`:
   - `annotationFill(a: Annotation): string | undefined` → với `type === 'highlight'` trả `a.color`; loại khác trả `undefined`.
   - `draftRect(start: Point, end: Point): { x: number; y: number; width: number; height: number }` → hình chữ nhật chuẩn hoá (x, y là góc trên-trái, kích thước không âm), kẹp trong `[0, 1]`.
2. **`PdfCanvas.tsx`:**
   - `div.annotation` thêm `backgroundColor: annotationFill(display)`. Giữ `opacity` và `mix-blend-mode: multiply` như cũ để chữ bên dưới vẫn đọc được.
   - Khi công cụ là `highlight` hoặc `text` và đang kéo:
     - hiện **hình chữ nhật xem trước** theo `draftRect(draft[0], điểm hiện tại)`;
     - highlight: nền màu `color` đang chọn, `opacity` 0.38, `mix-blend-mode: multiply`;
     - text: viền nét đứt, nền trong suốt;
     - **không** vẽ `svg.ink.draft` cho hai công cụ này.
   - Công cụ `draw` / `signature` giữ nguyên xem trước bằng nét tự do.
   - Kích thước tối thiểu khi thả chuột giữ nguyên logic hiện tại (`PdfCanvas.tsx` hàm `pointerUp`).
3. GIỮ NGUYÊN:
   - dữ liệu `Annotation` (opacity highlight 0.38, màu);
   - `exportPdf.ts`;
   - khung chọn và tay nắm của W-8;
   - activity log.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/pdf-editor/PdfCanvas.tsx`, `src/pdf-editor/index.ts`;
  - `src/pdf-editor/annotationStyle.ts` (mới);
  - `src/pdf-editor/__tests__/annotationStyle.test.ts` (mới).
- KHÔNG sửa:
  - `exportPdf.ts` (F-12 đang sửa song song), `App.tsx`, `src/types.ts`;
  - CSS có sẵn, `server/`, `public/`.

  Nếu bắt buộc thêm CSS, tạo file mới `src/pdf-editor/annotations.css`, import trong `PdfCanvas.tsx`, dùng token trong `src/pace-theme.css`.
- Không thêm dependency.

## Tiêu chí hoàn thành
- K1 (test `annotationFill`):
  - highlight màu `#F5C84C` → `'#F5C84C'`;
  - `text`, `draw`, `image` → `undefined`.
- K2 (test `draftRect`):
  - `(0.5,0.5)→(0.2,0.3)` → `{x:0.2, y:0.3, width:0.3, height:0.2}`;
  - điểm ngoài `[0,1]` bị kẹp;
  - hai điểm trùng → `width = height = 0`.
- K3: `Select-String "annotationFill"` trong `PdfCanvas.tsx` có kết quả.
- K4: `npm run lint`, `npm run build` xanh. `vitest run` kết thúc, mọi test cũ pass.
- K5 (Claude kiểm tra khi QA, agent không làm). Trình duyệt 1280px, PDF giả:
  - kéo tạo highlight: trong lúc kéo thấy hình chữ nhật màu, thả ra thấy vệt màu;
  - `backgroundColor` tính được khác trong suốt;
  - chữ bên dưới vẫn đọc được;
  - đổi màu trong bảng màu rồi tạo highlight mới → đúng màu;
  - xuất PDF → vệt màu cùng vị trí;
  - 390px không vỡ.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/PdfCanvas.tsx -Pattern "annotationFill","draftRect"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/pdf-editor
git commit -m "fix(F-13): render highlight fill on screen and show rectangle preview while dragging"
git push -u origin fix/f13-highlight-visible
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Select-String: có cả `annotationFill` và `draftRect`.
- lint/build xanh; vitest kết thúc, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f13-highlight-visible
git rev-parse --short HEAD
git log --oneline -1 origin/fix/f13-highlight-visible
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- mô tả ngắn cách hiển thị xem trước cho từng công cụ;
- danh sách `TODO(verify)`.
