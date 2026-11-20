# [W-8b] PDF Editor: panel thuộc tính bên phải, đường gióng khi kéo, nút "Hiện khung bao", trang không bị đẩy khi chọn chữ, zoom giữ đúng điểm dưới con trỏ

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (B21, quyết định Q-P4; mục W-8b trong lộ trình).
Tiền điều kiện: W-11 đã merge vào `main` (PR #48).
Nhánh: `feat/w8b-properties-panel-guides` (tạo từ `main`) · Commit: `feat(W-8b): properties panel, snapping guides, bounding-box toggle, no layout shift, anchored ctrl-wheel zoom`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w8b-properties-panel-guides
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề (Claude đã kiểm trên trình duyệt; số dòng đọc trên `main` @ `f67eac3`)
1. **B21: trang bị đẩy xuống khi chọn chữ.** `src/App.tsx:768` chèn `TextFormatBar` phía trên vùng tài liệu khi `tool==='text' || selectedText`. Thanh này cao 46px nên mỗi lần chọn/bỏ chọn chữ, trang nhảy xuống/lên 46px. Click theo toạ độ cũ sẽ trượt.
2. **Không có panel thuộc tính.**
   - Không nhập được vị trí/kích thước chính xác.
   - Không khoá tỉ lệ ảnh bằng nút, chỉ có giữ Shift.
   - Không chỉnh được độ mờ.

   Acrobat có panel FORMAT/OBJECTS bên phải.
3. **Không có đường gióng/hút cạnh khi kéo** (`src/pdf-editor/selection/SelectionFrame.tsx`). Khó căn thẳng hàng các đối tượng.
4. **Không có nút "Hiện khung bao"** để thấy mọi vùng chữ/đối tượng như "Show bounding boxes" của Acrobat.
5. **Ctrl/Cmd + lăn chuột: điểm dưới con trỏ bị trôi 13–23px** sau 3 nấc (QA W-11b).
   - `viewMath.zoomAroundPoint` coi toàn bộ nội dung co giãn đều.
   - Thực tế khoảng cách 16px giữa các trang **không** co giãn, và trang được **căn giữa** theo chiều ngang.
6. **Màn hình 768–800px: sidebar thumbnail nổi đè lên trang và thanh công cụ.**
   - CSS có sẵn `src/styles.css` `@media(max-width:800px)` đặt `.sidebar` thành `position:absolute`.
   - `App.tsx:282` lại mở sidebar mặc định khi `innerWidth >= 768`.
7. **Highlight trong file xuất làm chữ bên dưới nhạt đi.** `exportPdf.ts` vẽ hình chữ nhật đè lên chữ với `opacity` 0,38 ở chế độ thường. Trên màn hình thì dùng `mix-blend-mode: multiply` nên chữ vẫn đậm. `pdf-lib` 1.17.1 có `BlendMode.Multiply` và tuỳ chọn `blendMode` (`node_modules/pdf-lib/cjs/api/PDFPageOptions.d.ts`).

## Logic cần đạt
1. **Panel thuộc tính** (`src/pdf-editor/PropertiesPanel.tsx`, mới), cột bên phải vùng tài liệu, rộng ~260px, chỉ ở màn hình **≥ 1024px** (Q-P4). Panel không đẩy trang khi hiện/ẩn: luôn chiếm chỗ cố định khi đã mở tài liệu, nếu không có gì để chỉnh thì hiện "Chọn một đối tượng để chỉnh".
   - **VỊ TRÍ & KÍCH THƯỚC** (mọi đối tượng trừ `replaceOriginal`):
     - ô số X, Y, Rộng, Cao, đơn vị **pt**, gốc trên-trái của khung trang đang hiển thị;
     - đổi giá trị + Enter/rời ô → 1 bước Undo, activity `annotation.moved` (X/Y) hoặc `annotation.resized` (W/H);
     - nét vẽ/chữ ký: W/H co giãn các điểm theo `resizeFromHandle` của W-8.
   - **Khoá tỉ lệ** (checkbox): ảnh mặc định bật; khi bật, đổi W thì H đổi theo và ngược lại. Kéo tay nắm góc dùng theo checkbox này (giữ Shift để đảo tạm thời).
   - **Độ mờ**: thanh trượt 10–100%, áp cho highlight, ảnh, chữ.
   - **ĐỊNH DẠNG CHỮ** (khi chọn chữ hoặc công cụ Thêm chữ đang bật): **chuyển toàn bộ nội dung `TextFormatBar` vào panel**. Không còn `TextFormatBar` chèn phía trên trang ở ≥ 1024px.
   - `replaceOriginal`: panel hiện thông tin chỉ đọc + câu "Chữ thay thế chữ gốc chưa di chuyển được".
2. **< 1024px:** `TextFormatBar` hiện ở dạng **lớp nổi cố định phía dưới màn hình** (`position: fixed`, không chiếm chỗ trong bố cục). Chọn/bỏ chọn chữ không làm trang dịch chuyển.
3. **Đường gióng & hút cạnh** (≥ 1024px):
   - Khi kéo/giãn bằng khung chọn, hút về các đường sau trên **cùng trang**:
     - mép trái/phải/trên/dưới và đường giữa của các đối tượng khác;
     - đường giữa trang theo hai chiều.
   - Ngưỡng hút: 4px màn hình. Hiện đường gióng 1px (token màu nhấn) trong lúc kéo.
   - Giữ **Alt** khi kéo → tắt hút.
   - Hàm thuần `computeSnap(rect, candidates, thresholdNorm): { dx, dy, guides }` trong `src/pdf-editor/selection/snap.ts`.
4. **Nút "Hiện khung bao"** trên thanh công cụ (≥ 1024px), dạng bật/tắt:
   - khi bật, hiện viền nét đứt cho mọi annotation và mọi vùng chữ gốc của các trang đang render, kể cả khi không ở công cụ Chọn;
   - trạng thái nhớ trong `localStorage` (bọc `try/catch`, lỗi thì mặc định tắt).
5. **Zoom giữ điểm dưới con trỏ:**
   - Trước khi đổi zoom: xác định trang dưới con trỏ và toạ độ tương đối `(fx, fy)` của con trỏ trong trang đó.
   - Sau khi bố cục mới xong (`requestAnimationFrame`, đọc lại `getBoundingClientRect` của chính trang đó): chỉnh `scrollLeft/scrollTop` của `.page-list-scroll` để điểm `(fx, fy)` của trang đó nằm lại đúng dưới con trỏ.
   - Áp dụng cho Ctrl+lăn và Ctrl +/−.
   - Hàm thuần `anchorScrollDelta(beforeRect, afterRect, fx, fy, pointer)` để test.
6. **Sidebar:** mở mặc định chỉ khi `innerWidth > 800` (khớp ngưỡng CSS có sẵn). Hằng số `SIDEBAR_OVERLAY_MAX_WIDTH = 800` export từ `viewMath.ts`. Ở ≤ 800px, mở sidebar rồi chọn thumbnail → tự đóng sidebar.
7. **Highlight khi xuất:** `exportPdf.ts`, highlight vẽ với `blendMode: BlendMode.Multiply`. Mọi thứ khác giữ nguyên (vị trí theo F-12, màu, opacity).
8. GIỮ NGUYÊN: tay nắm và phím tắt của W-8, ảo hoá/thumbnail/xoay của W-11, logic font F-11, toạ độ F-12, các chuỗi activity log cũ.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/App.tsx`, `src/pdf-editor/PdfCanvas.tsx`, `src/pdf-editor/PageList.tsx`, `src/pdf-editor/TextFormatBar.tsx`, `src/pdf-editor/viewMath.ts`, `src/pdf-editor/index.ts`;
  - `src/pdf-editor/selection/**`;
  - `src/pdf-editor/exportPdf.ts` (**chỉ** thêm `blendMode` cho highlight);
  - mới: `src/pdf-editor/PropertiesPanel.tsx`, `src/pdf-editor/panel.css`;
  - `src/pdf-editor/viewer.css`;
  - `src/pdf-editor/__tests__/w8b-*.test.ts(x)` (mới).
- KHÔNG sửa:
  - `src/types.ts`, `engine/**`, `pageGeometry.ts`;
  - CSS có sẵn ngoài `src/pdf-editor/`, `server/`, `public/`.
- Không thêm dependency. UI tiếng Việt, dùng token trong `src/pace-theme.css`.

## Tiêu chí hoàn thành
- K1 (`computeSnap`):
  - hình chữ nhật cách mép trái đối tượng khác 0,003 (ngưỡng 0,005) → `dx` kéo về khớp, `guides` có 1 đường dọc;
  - cách 0,01 → không hút;
  - tâm gần đường giữa trang → hút về 0,5.
- K2 (`anchorScrollDelta`):
  - trang trước `{left: 100, top: 50, width: 595, height: 842}`, sau ×1.1 `{left: 70, top: 20, width: 654.5, height: 926.2}`, con trỏ `(400, 300)`;
  - `fx, fy` tính từ trang trước;
  - delta cuộn đưa điểm về đúng `(400, 300)` (sai số ≤ 0,5px).
- K3: chỉnh W ở panel cho ảnh 2:1 khi khoá tỉ lệ → H = W/2. Bỏ khoá → H giữ nguyên. Test trên hàm thuần áp giá trị panel lên annotation.
- K4: `exportPdf` → content stream của highlight có tham chiếu ExtGState với `/BM /Multiply`. Đọc bằng `pdf-lib` hoặc `tokenizeContent` + tra Resources.
- K5: `Select-String` cho thấy `App.tsx` không còn render `TextFormatBar` trực tiếp phía trên vùng tài liệu ở ≥ 1024px. Ghi rõ cách điều kiện hoá trong báo cáo.
- K6: `npm run lint`, `npm run build` xanh. `vitest run` kết thúc, mọi test cũ pass.
- K7 (Claude kiểm tra khi QA):
  - 1280px:
    - chọn/bỏ chọn chữ không làm trang dịch (sai số 0px);
    - panel nhập X/Y/W/H đúng pt;
    - khoá tỉ lệ;
    - thanh độ mờ;
    - kéo ảnh sát mép đối tượng khác thì hút và hiện đường gióng; Alt tắt hút;
    - nút "Hiện khung bao" hoạt động và được nhớ sau khi tải lại trang;
    - Ctrl+lăn 3 nấc: điểm dưới con trỏ lệch ≤ 2px;
    - xuất highlight thì chữ bên dưới vẫn đậm.
  - 800px và 768px: sidebar đóng mặc định, không đè trang.
  - 390px: thanh định dạng nổi ở đáy, không tràn ngang.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/App.tsx -Pattern "TextFormatBar"
Select-String -Path src/pdf-editor/exportPdf.ts -Pattern "BlendMode.Multiply"
Select-String -Path src/pdf-editor/viewMath.ts -Pattern "SIDEBAR_OVERLAY_MAX_WIDTH"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/App.tsx src/pdf-editor
git commit -m "feat(W-8b): properties panel, snapping guides, bounding-box toggle, no layout shift, anchored ctrl-wheel zoom"
git push -u origin feat/w8b-properties-panel-guides
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Select-String `BlendMode.Multiply` và `SIDEBAR_OVERLAY_MAX_WIDTH`: có kết quả.
- `TextFormatBar` trong `App.tsx`: chỉ còn ở nhánh màn hình nhỏ hoặc đã chuyển vào panel (giải thích trong báo cáo).
- lint/build xanh; vitest kết thúc, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w8b-properties-panel-guides
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w8b-properties-panel-guides
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- bố cục panel theo từng loại đối tượng;
- cách tính hút cạnh và giữ điểm khi zoom;
- danh sách `TODO(verify)`.
