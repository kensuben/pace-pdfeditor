# [W-11] PDF Editor: cuộn liên tục nhiều trang, thumbnail thật, zoom vừa trang/vừa chiều rộng, xoay trang lưu vào file

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (lỗi B12, B13, B15; quyết định Q-P4).
Tiền điều kiện: **W-8, F-12 và F-13 đã merge vào `main`**. W-11 sửa cùng file với W-8/F-13 (`App.tsx`, `PdfCanvas.tsx`). Xoay trang cần F-12 để file xuất đúng.
Nhánh: `feat/w11-continuous-scroll-view` (tạo từ `main`) · Commit: `feat(W-11): continuous virtualized page scroll, real thumbnails, fit zoom presets, persistent page rotation`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Kiểm thêm:
```powershell
git log --oneline -30 origin/main | Select-String "W-8","F-12","F-13"
```
Phải thấy **cả ba** (commit hoặc merge PR có `W-8`, `F-12` và `F-13`). Thiếu → **DỪNG**, báo lại. Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w11-continuous-scroll-view
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình.
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề (đọc trên `main` @ `03d6d06`; số dòng có thể lệch sau W-8, agent tự đối chiếu)
1. **Chỉ hiển thị một trang** (B15): `App.tsx:609` render một `PdfCanvas` với `pageNumber={page}`. Phải bấm trang trước/sau hoặc thumbnail mới đổi trang.
2. **Thumbnail là hình giả** (B13): `App.tsx:583`, `thumb-paper` gồm icon + 3 vạch, không render nội dung trang.
3. **Zoom hạn chế:**
   - slider 50–250% (`App.tsx:613`);
   - nút `zoom-value` có `ChevronDown` nhưng **không có `onClick`**;
   - không có "Vừa chiều rộng" / "Vừa trang";
   - không có Ctrl + lăn chuột;
   - mở file luôn đặt `zoom = 1` (`App.tsx:220`).
4. **Nút "Rotate view" không có `onClick`** (B12, `App.tsx:605`).
5. **Undo sau thao tác trang** (chèn/di chuyển/xoá trang, `App.tsx:285-326`) chỉ đưa toạ độ annotation về cũ, **không** đưa `bytes` PDF về cũ. Annotation có thể bị gán sai trang sau khi Undo.

## Logic cần đạt
1. **Cuộn liên tục có ảo hoá** (component mới `src/pdf-editor/PageList.tsx`):
   - Mọi trang xếp dọc, khoảng cách 16px, mỗi trang một khung có **kích thước thật** (lấy từ `getViewport({ scale: zoom, rotation })` của từng trang) để thanh cuộn đúng ngay từ đầu.
   - Chỉ render canvas + lớp annotation (`PdfCanvas`) cho trang **nằm trong hoặc cách vùng nhìn ≤ 1 màn hình** (`IntersectionObserver`, `rootMargin` ~100%). Trang khác chỉ là khung giữ chỗ.
   - Khi trang ra khỏi vùng này: huỷ render đang chạy, giải phóng canvas (`width = height = 0`).
   - Tối đa 2 trang render đồng thời. Trích chữ (`getTextContent`) cũng chỉ chạy cho trang đã hiện.
   - Mọi công cụ (Chọn, Thêm chữ, Đánh dấu, Vẽ, Chữ ký, khung chọn/tay nắm của W-8) hoạt động trên **mọi trang** đang hiện; `onAdd` dùng đúng số trang của khung đó.
   - Chọn đối tượng ở trang khác thì bỏ chọn đối tượng cũ.
2. **Trang hiện tại** (`page`): trang có diện tích hiển thị lớn nhất, cập nhật khi cuộn (giới hạn tần suất ≤ 10 lần/giây). Ô nhập số trang, nút trước/sau, click thumbnail → cuộn tới đầu trang đó (`scrollIntoView` hoặc đặt `scrollTop`). Thao tác trang (chèn/di chuyển/xoá/xoay) vẫn áp cho `page` như hiện tại. Activity log `navigation.page_changed` chỉ ghi khi người dùng chủ động chuyển trang (nhập số, bấm nút, bấm thumbnail), **không** ghi khi cuộn.
3. **Thumbnail thật** (`src/pdf-editor/ThumbnailList.tsx`):
   - render trang ở bề rộng 120px CSS (nhân `devicePixelRatio`, tối đa 2), lazy theo `IntersectionObserver` trong sidebar;
   - cache theo `(phiên bản bytes, số trang, góc xoay)`, xoá cache khi bytes đổi (chèn/di chuyển/xoá/xoay trang, mở file khác);
   - thumbnail trang hiện tại có viền nổi bật và tự cuộn vào vùng nhìn trong sidebar.
4. **Zoom:**
   - Dải 25–400%.
   - Nút `zoom-value` mở menu: 50, 75, 100, 125, 150, 200, 300, 400%, "Vừa chiều rộng", "Vừa trang". Menu điều khiển được bằng bàn phím, Esc đóng, có `role="menu"` + `role="menuitem"`.
   - Ctrl/Cmd + lăn chuột trong vùng tài liệu: zoom (bước ×1.1), **giữ điểm dưới con trỏ đứng yên**.
   - Ctrl/Cmd `+` / `-` / `0`: tăng/giảm/vừa chiều rộng (`preventDefault` để trình duyệt không zoom cả trang).
   - Đổi zoom bằng nút/menu giữ trang hiện tại ở đầu vùng nhìn.
   - Mở file: mặc định "Vừa chiều rộng" nếu trang 1 rộng hơn vùng nhìn, ngược lại 100%.
   - Activity log `view.zoom_changed` giữ như cũ, ghi tối đa 1 lần cho mỗi thao tác (lăn chuột liên tục chỉ ghi 1 lần sau khi dừng ~500ms).
5. **Xoay trang lưu vào file** (thay nút "Rotate view", nhãn "Xoay trang", icon `RotateCw`):
   - Xoay **trang hiện tại** 90° theo chiều kim đồng hồ: `page.setRotation(degrees(góc cũ + 90))` qua hàm thuần mới `rotatePage(bytes, pageIndex, delta)` trong `src/pdf-editor/pageOps.ts`; nạp lại như `moveCurrentPage`.
   - Annotation trên trang đó (toạ độ theo khung hiển thị) phải đổi theo để **giữ vị trí trên nội dung trang**:
     - highlight: `(x, y, w, h) → (1 - y - h, x, h, w)`;
     - nét vẽ/chữ ký: điểm `(x, y) → (1 - y, x)`;
     - chữ và ảnh: **giữ đứng thẳng**, giữ `width/height` (tỉ lệ theo khung mới, quy đổi theo pt để kích thước thật không đổi), tâm đổi theo công thức điểm ở trên.

     Viết hàm thuần `rotateAnnotationsCw(annotations, page, oldViewPt, newViewPt)`.
   - Activity log mới: `page.rotated` / "Xoay trang", metadata `{ page, angle }`.
6. **Undo/Redo với thao tác trang:**
   - Sau mỗi thao tác chèn/di chuyển/xoá/xoay trang, lịch sử được **đặt lại**: `history = [annotations sau thao tác]`, `historyIndex = 0`. Hiện thông báo ngắn trên `statusbar`: "Thao tác trang không hoàn tác được", ~4 giây.
   - Không đổi cách Undo/Redo với annotation.
7. **Q-P4:**
   - < 1024px: cuộn liên tục, zoom, thumbnail vẫn hoạt động;
   - sidebar thumbnail mặc định **đóng** ở < 768px;
   - không có thao tác chỉnh sửa đầy đủ (đã quy định ở W-8).
8. **Hiệu năng:** PDF 100 trang (dựng bằng `pdf-lib` trong test/fixture) cuộn từ đầu đến cuối không treo; tại một thời điểm có **≤ 6 canvas** với `width > 0` trong vùng tài liệu.
9. GIỮ NGUYÊN:
   - logic xuất PDF;
   - khung chọn/tay nắm/phím tắt của W-8;
   - OCR (vẫn chạy cho `page` hiện tại);
   - Ký số;
   - các chuỗi activity log cũ.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/App.tsx`, `src/pdf-editor/PdfCanvas.tsx`, `src/pdf-editor/pageOps.ts`, `src/pdf-editor/index.ts`;
  - mới: `src/pdf-editor/PageList.tsx`, `src/pdf-editor/ThumbnailList.tsx`, `src/pdf-editor/ZoomMenu.tsx`, `src/pdf-editor/viewer.css`, `src/pdf-editor/viewMath.ts`;
  - `src/pdf-editor/__tests__/view-*.test.ts` (mới).
- KHÔNG sửa:
  - `exportPdf.ts`, `pageGeometry.ts`, `engine/**`, `selection/**` (trừ khi bắt buộc để chạy được trên nhiều trang; khi đó ghi lý do);
  - `src/types.ts`, CSS có sẵn, `server/`, `public/`.
- Không thêm dependency (không dùng thư viện virtual list).

## Tiêu chí hoàn thành
- K1 (`viewMath.pickCurrentPage`): danh sách diện tích hiển thị `[0, 120, 300, 40]` → trang 3; tất cả 0 → giữ trang cũ.
- K2 (`viewMath.fitZoom`):
  - khung 1000×700, trang 600×800 pt: "Vừa chiều rộng" = `(1000 - padding) / 600`;
  - "Vừa trang" = `min((1000 - padding)/600, (700 - padding)/800)`;
  - padding là hằng số export, test dùng chính hằng số đó;
  - kết quả kẹp trong 0,25–4.
- K3 (`viewMath.zoomAroundPoint`): zoom ×1.1 tại con trỏ → điểm nội dung dưới con trỏ có cùng toạ độ màn hình trước/sau (sai số ≤ 0,5px).
- K4 (`rotateAnnotationsCw`):
  - highlight `(0.1, 0.2, 0.3, 0.1)` → `(0.7, 0.1, 0.1, 0.3)`;
  - điểm `(0.1, 0.2)` → `(0.8, 0.1)`;
  - xoay 4 lần liên tiếp → về giá trị ban đầu (sai số ≤ 1e-9);
  - chữ/ảnh giữ kích thước pt thật trên trang 600×400 pt (sai số ≤ 1e-6).
- K5 (`rotatePage`): PDF 2 trang, xoay trang 1 → `getRotation().angle === 90`, trang 2 vẫn 0; xoay thêm 3 lần → về 0 (lưu 0 hoặc 360 đều chấp nhận, pdf.js hiển thị đúng).
- K6: sau thao tác trang, `historyIndex === 0` và `history.length === 1`. Viết test trên hàm thuần hoặc reducer mà agent tách ra; ghi rõ cách test.
- K7: `Select-String` cho thấy `zoom-value` có `onClick`; nút xoay trang có `onClick`; không còn `thumb-paper` placeholder.
- K8: `npm run lint`, `npm run build` xanh. `vitest run` kết thúc, mọi test cũ pass.
- K9 (Claude kiểm tra khi QA):
  - 1280px:
    - PDF giả 100 trang cuộn mượt, ≤ 6 canvas hoạt động;
    - số trang trên `statusbar` đổi theo cuộn;
    - thumbnail thật;
    - menu zoom + Ctrl+lăn giữ điểm dưới con trỏ;
    - thêm/kéo/giãn đối tượng ở trang 2 và 50 hoạt động;
    - xoay trang có highlight → xuất PDF highlight vẫn phủ đúng chữ.
  - 768px và 390px: cuộn/zoom hoạt động, sidebar đóng mặc định ở 390px, không tràn ngang.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/App.tsx -Pattern "thumb-paper","Rotate view"
Select-String -Path src/App.tsx,src/pdf-editor/*.tsx -Pattern "page.rotated"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/App.tsx src/pdf-editor
git commit -m "feat(W-11): continuous virtualized page scroll, real thumbnails, fit zoom presets, persistent page rotation"
git push -u origin feat/w11-continuous-scroll-view
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Select-String `thumb-paper` / `Rotate view`: không có kết quả.
- Select-String `page.rotated`: có kết quả.
- lint/build xanh; vitest kết thúc, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w11-continuous-scroll-view
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w11-continuous-scroll-view
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- cách ảo hoá (`rootMargin`, giới hạn render đồng thời, giải phóng canvas);
- công thức xoay annotation;
- danh sách `TODO(verify)`.
