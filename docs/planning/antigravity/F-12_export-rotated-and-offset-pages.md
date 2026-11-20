# [F-12] Xuất PDF: đặt đúng vị trí/hướng đối tượng trên trang đã xoay (/Rotate) và trang có MediaBox/CropBox lệch gốc

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (lỗi B18, B19).
Tiền điều kiện: W-7 đã merge vào `main` (PR #42). Có thể làm **song song với W-8** (W-8 không sửa `exportPdf.ts`).
Nhánh: `fix/f12-export-rotated-offset-pages` (tạo từ `main`) · Commit: `fix(F-12): map annotations through page rotation and crop/media box origin on export`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f12-export-rotated-offset-pages
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình.
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề (Claude đã chạy thử trên `main` @ `03d6d06`)
1. Annotation lưu toạ độ **tỉ lệ 0–1 theo khung trang đang hiển thị**: pdf.js viewport đã áp `/Rotate` và chỉ hiện vùng `CropBox ∩ MediaBox`.
2. `src/pdf-editor/exportPdf.ts` đổi sang toạ độ PDF theo kiểu `x*width`, `height - y*height`, dùng `p.getSize()`. Cách này coi như trang **không xoay** và **gốc toạ độ ở (0,0)**.
3. Kết quả thử trên trình duyệt (PDF giả 3 trang, mỗi trang đánh dấu highlight phủ lên dòng chữ):
   - **B18:** trang `/Rotate 90` → highlight xuất ra nằm ở góc dưới, thành vệt dọc, không phủ chữ;
   - **B19:** trang MediaBox `[100 100 700 500]` → highlight lệch chỗ và sai kích thước;
   - trang thường → đúng.
4. Lỗi áp dụng cho mọi loại đối tượng: highlight, chữ (gồm hình chữ nhật che của chữ thay thế), ảnh, nét vẽ/chữ ký. PDF scan và PDF xuất từ máy in ảo hay có `/Rotate` hoặc CropBox.
5. pdf.js tính khung hiển thị như sau (đã đọc `node_modules/pdfjs-dist/build/pdf.worker.mjs`, getter `view`): `CropBox ∩ MediaBox`, nếu giao rỗng thì lấy MediaBox. `PageViewport` có `convertToPdfPoint(x, y)` (`pdfjs-dist/types/src/display/page_viewport.d.ts:136`). Dùng hàm này làm **chuẩn so sánh trong test**.

## Logic cần đạt
1. **`src/pdf-editor/pageGeometry.ts`** (mới, hàm thuần):
   - `getPageView(page: PDFPage): { box: [x0, y0, x1, y1]; rotation: 0 | 90 | 180 | 270 }`.
     - `box` = `CropBox ∩ MediaBox`, giống pdf.js. Dùng `page.getCropBox()`, `page.getMediaBox()` của `pdf-lib` 1.17.1.
     - `rotation` = `((page.getRotation().angle % 360) + 360) % 360`. Không phải bội của 90 → ném lỗi `UNSUPPORTED_ROTATION:`.
   - `viewToPdf(view, u, v): { x: number; y: number }`: `(u, v)` tỉ lệ 0–1 theo khung **đang hiển thị** (gốc trên-trái), trả toạ độ không gian người dùng của PDF. Phải khớp `viewport.convertToPdfPoint(u*W, v*H)` của pdf.js (`scale: 1`) với sai số ≤ 0,01 pt cho cả 4 góc xoay.
   - `viewSizePt(view): { width: number; height: number }`: kích thước khung hiển thị (đổi chiều khi xoay 90/270).
2. **`exportPdf.ts`** dùng `pageGeometry` cho mọi loại đối tượng:
   - Highlight, hình chữ nhật che của chữ thay thế: đổi 4 góc qua `viewToPdf` → hình chữ nhật thẳng trục (với bội 90°).
   - Nét vẽ/chữ ký: đổi từng điểm.
   - Chữ:
     - điểm neo đổi qua `viewToPdf`;
     - vẽ với `rotate: degrees(rotation)` để chữ **đứng thẳng khi xem**;
     - độ rộng/căn lề tính theo chiều ngang của khung hiển thị;
     - gạch chân xoay theo.

     Chiều xoay đúng: agent tự kiểm bằng test K3, **không đoán**.
   - Ảnh: vẽ với `rotate` tương ứng sao cho ảnh **đứng thẳng khi xem** và phủ đúng hình chữ nhật hiển thị.
   - Kích thước pt đổi từ tỉ lệ theo `viewSizePt`, không dùng `p.getSize()`.
3. **Không đổi kết quả với trang thường** (xoay 0, gốc 0, không CropBox): lệnh vẽ sinh ra giống hệt trước khi sửa. Mọi test cũ (T6, T8, K2–K6 của F-11, `KNOWN ISSUE B1`) phải vẫn pass.
4. GIỮ NGUYÊN: cách chọn font của F-11, mã lỗi `FONT_LOAD_FAILED` / `MISSING_GLYPH`, kiểu `Annotation`.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/pdf-editor/exportPdf.ts`;
  - `src/pdf-editor/pageGeometry.ts` (mới), `src/pdf-editor/index.ts`;
  - `src/pdf-editor/__tests__/pageGeometry.test.ts`, `src/pdf-editor/__tests__/export-rotation.test.ts` (mới).
- KHÔNG sửa:
  - `PdfCanvas.tsx`, `App.tsx` (W-8 đang sửa song song);
  - `src/types.ts`, `engine/**`, CSS.
- Không thêm dependency.
- Test chạy với `// @vitest-environment node`, pdf.js `legacy` build. Đường dẫn file tính từ `import.meta.url`, không dùng `process.cwd()`.
- Đọc lệnh vẽ trong file xuất bằng `tokenizeContent` / `readPageContent` của `src/pdf-editor/engine/` (W-7). Dữ liệu giả.

## Tiêu chí hoàn thành
Ma trận trang fixture `M`:
- `rotation ∈ {0, 90, 180, 270}`;
- × MediaBox `{[0 0 600 400], [100 100 700 500]}`;
- × CropBox `{không có, [150 120 650 480] (trong MediaBox lệch)}`.

Tổng 16 trang, tạo bằng `pdf-lib` trong test.

- K1 (`viewToPdf`): với mọi trang trong `M` và 9 điểm `(u, v) ∈ {0, 0.5, 1}²`, khớp `viewport.convertToPdfPoint` của pdf.js (đọc lại chính file đó) sai số ≤ 0,01 pt. `viewSizePt` khớp `viewport.width/height`.
- K2 (highlight): annotation highlight `x=0.1, y=0.2, w=0.3, h=0.1` trên mọi trang `M` → xuất, tìm lệnh `re` của highlight trong content stream (lệnh cuối cùng, hoặc theo màu đặt riêng cho test). 4 góc của nó, sau khi đổi qua `viewport.convertToViewportPoint`, khớp hình chữ nhật hiển thị `(0.1W, 0.2H)–(0.4W, 0.3H)` sai số ≤ 0,05 pt.
- K3 (chữ đứng thẳng): annotation chữ `Test 01` (Helvetica, cỡ 12) tại `x=0.2, y=0.3` trên mọi trang `M` → `getTextContent` của file xuất. Item `Test 01` sau khi nhân `viewport.transform` có:
  - `a > 0`, `|b| < 1e-6`, `|c| < 1e-6`, `d < 0` (đứng thẳng trong không gian viewport, trục y hướng xuống);
  - toạ độ x trong `±0.5 pt` quanh `0.2W`.
- K4 (ảnh): ảnh PNG 2×1 (data URL hằng) tại `x=0.5, y=0.5, w=0.2, h=0.1` trên mọi trang `M` → tìm `cm` ngay trước `Do` của ảnh. Ảnh của hình vuông đơn vị qua `cm`, đổi sang viewport, phủ đúng hình chữ nhật hiển thị (≤ 0,05 pt); cạnh rộng 2 px của ảnh nằm theo chiều ngang khi xem.
- K5 (nét vẽ): 3 điểm `(0.1,0.1) (0.5,0.5) (0.9,0.2)` → các toạ độ `m/l` trong file xuất đổi sang viewport khớp `(uW, vH)` (≤ 0,05 pt), trên mọi trang `M`.
- K6 (không đổi trang thường): trên trang xoay 0, MediaBox `[0 0 600 400]`, không CropBox, chuỗi lệnh vẽ (sau `tokenizeContent`) của bộ annotation T6+T8 **giống hệt** khi xuất bằng code trước khi sửa. Lưu bản tham chiếu trong test dưới dạng chuỗi lệnh mong đợi. **Bản tham chiếu phải lấy bằng cách chạy test trên code CHƯA sửa** (viết test K6 trước, chạy với `exportPdf.ts` của `main` để in chuỗi lệnh, dán vào test, rồi mới sửa `exportPdf.ts`). Nêu rõ trong báo cáo đã làm theo thứ tự này.
- K7: `page.setRotation(degrees(45))` → `buildEditedPdf` reject, message bắt đầu `UNSUPPORTED_ROTATION:`.
- K8: `npm run lint`, `npm run build` xanh. `vitest run` kết thúc, mọi test cũ pass.
- K9 (Claude kiểm tra khi QA): file giả 3 trang (xoay 90 / MediaBox lệch / thường), đánh dấu phủ dòng chữ trên giao diện → PDF xuất phủ đúng dòng chữ ở cả 3 trang.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/exportPdf.ts -Pattern "getSize\(\)"
Select-String -Path src/pdf-editor/exportPdf.ts -Pattern "viewToPdf"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/pdf-editor
git commit -m "fix(F-12): map annotations through page rotation and crop/media box origin on export"
git push -u origin fix/f12-export-rotated-offset-pages
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Select-String `getSize()`: không có kết quả.
- Select-String `viewToPdf`: có kết quả.
- lint/build xanh; vitest kết thúc, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f12-export-rotated-offset-pages
git rev-parse --short HEAD
git log --oneline -1 origin/fix/f12-export-rotated-offset-pages
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`, ghi rõ số trang trong `M` đạt ở từng K;
- công thức `viewToPdf` cho 4 góc xoay;
- chiều `rotate` đã dùng cho chữ/ảnh và cách kiểm chứng;
- danh sách `TODO(verify)`.
