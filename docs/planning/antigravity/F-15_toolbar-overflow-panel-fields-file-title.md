# [F-15] PDF Editor: thanh công cụ không bao giờ che mất nút (thu gọn + menu "Thêm"), ô trong panel thuộc tính không vỡ dòng, tên file không đè nút

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md`.
Tiền điều kiện: W-8b, W-11 đã merge (PR #51, #48).
Nhánh: `fix/f15-toolbar-overflow-panel-title` (tạo từ `main`) · Commit: `fix(F-15): collapse toolbar into compact and overflow menu, fix properties field layout and file title overlap`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f15-toolbar-overflow-panel-title
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề (Claude đo trên Chromium khi chụp ảnh hướng dẫn, `main` @ `abda9fd`)
1. **Nút "Xoay trang" bị đẩy ra ngoài màn hình ở 1280px.**
   - Thanh công cụ (`src/App.tsx`, khối `<div className="toolbar">` ~dòng 806-855) cần `scrollWidth` 1143px nhưng `clientWidth` chỉ 1112px. Nút "Xoay trang" nằm ở x = 1279–1311 trên viewport 1280.
   - Lý do: `.toolbar` chỉ có `overflow-x:auto` ở `@media (max-width:800px)` (`src/styles.css`). Từ 801px trở lên, phần tràn bị khung cha cắt mất.
   - Nút "Xoay trang" đặt **cuối** thanh, tách khỏi nhóm thao tác trang (lên/xuống/xoá trang).
2. **Ô trong bảng Thuộc tính vỡ dòng/cắt chữ** (`src/pdf-editor/panel.css`):
   - `.properties-field input { width: 50px }` (~dòng 79-89) làm ô "Rộng" hiện `130.9` và `pt` xuống dòng;
   - ô cỡ chữ (`select.font-size`, `flex: 0 0 60px`, ~dòng 191) hiện cắt "1(" thay vì "16".
3. **Tên file đè lên nút "Mở file"** ở bề rộng trung bình: `.file-title` dùng `position:absolute; left:50%; transform:translateX(-50%)` (`src/styles.css`), không chừa chỗ cho `.top-actions`. Tên file dài càng dễ đè.

## Logic cần đạt
1. **Sắp lại thanh công cụ** (không đổi chức năng, không đổi `aria-label` hiện có):
   - Nhóm theo thứ tự:
     - [Công cụ];
     - [Màu];
     - — giãn cách —;
     - [Chèn ảnh, Chèn trang];
     - [Trang: lên, xuống, **Xoay trang**, xoá trang];
     - [Ký số, Scan OCR];
     - [Hiện khung bao];
     - [Xoá đối tượng, Undo, Redo].
   - "Xoay trang" chuyển về nhóm Trang.
2. **Không bao giờ che mất nút** (≥ 801px; ≤ 800px giữ cách cuộn ngang hiện có):
   - Theo dõi kích thước bằng `ResizeObserver` (hook mới `src/pdf-editor/useToolbarLayout.ts`). Tính chế độ hiển thị bằng hàm thuần `computeToolbarLayout(itemWidths, availableWidth, opts)`.
     - **Đủ chỗ:** hiển thị như hiện tại.
     - **Thiếu chỗ, bước 1 – `compact`:** nút có chữ (`Chèn ảnh`, `Chèn trang`, `Ký số`, `Scan OCR`) chỉ còn biểu tượng. Vẫn có `aria-label` + `title` đầy đủ.
     - **Vẫn thiếu, bước 2 – menu "Thêm":** các nhóm theo thứ tự ưu tiên ẩn dần vào một nút `⋯` (`aria-label="Thêm thao tác"`, `aria-haspopup="menu"`). Thứ tự ẩn: Ký số + Scan OCR → Hiện khung bao → nhóm Trang → Chèn ảnh/Chèn trang.
     - **Không bao giờ ẩn:** Công cụ, Màu, Xoá đối tượng, Undo, Redo.
   - Menu "Thêm":
     - `role="menu"`, mục `role="menuitem"` có biểu tượng + nhãn tiếng Việt;
     - mũi tên lên/xuống, Enter, Esc, click ra ngoài để đóng; focus trả về nút `⋯`;
     - mục bị vô hiệu (vd. không xoay được vì có chữ thay thế) vẫn hiện, ở trạng thái `aria-disabled` với `title` giải thích;
     - bấm mục nào thì gọi **đúng** handler hiện có.
3. **Bảng Thuộc tính:**
   - `.properties-grid-2x2` dùng `grid-template-columns: repeat(2, minmax(0, 1fr))`.
   - `.properties-field`: nhãn | ô nhập | đơn vị trên **một dòng**, `white-space: nowrap`. Ô nhập `flex: 1 1 auto; min-width: 0` (bỏ `width: 50px`).
   - Giá trị hiển thị tối đa 1 chữ số thập phân.
   - Phần **Định dạng chữ** trong panel chia hàng:
     - hàng 1: chọn font (rộng hết hàng);
     - hàng 2: cỡ chữ (đủ hiện 2 chữ số, ≥ 72px) + B/I/U;
     - hàng 3: căn lề + màu.

     Bản nổi ở màn hình < 1024px giữ nguyên.
4. **Tên file trên thanh trên cùng** (≥ 801px):
   - `.file-title` nằm **trong luồng flex** giữa `.view-switcher` và `.top-actions` (`flex: 1 1 auto; min-width: 0; justify-content: center`);
   - tên dài cắt bằng `…` (`text-overflow: ellipsis`), tên đầy đủ trong thuộc tính `title`;
   - không bao giờ đè lên nút. ≤ 800px giữ nguyên quy tắc hiện có.
5. GIỮ NGUYÊN:
   - mọi handler, phím tắt, activity log;
   - menu ⋯ ở thanh trên cùng trên điện thoại (W-5c) và các test `topbar-mobile`, `topbar-help`;
   - giao diện < 1024px của W-8b.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/App.tsx` (khối toolbar, `.file-title` + `title`);
  - `src/pdf-editor/useToolbarLayout.ts` (mới), `src/pdf-editor/ToolbarOverflowMenu.tsx` (mới), `src/pdf-editor/toolbar.css` (mới, import trong `App.tsx`);
  - `src/pdf-editor/panel.css`, `src/pdf-editor/PropertiesPanel.tsx` (chỉ bố cục/định dạng số), `src/pdf-editor/TextFormatBar.tsx` (chỉ class/bố cục, dùng chung cho bản nổi);
  - `src/pdf-editor/index.ts`;
  - test mới `src/pdf-editor/__tests__/f15-*.test.ts(x)`.
- KHÔNG sửa CSS có sẵn ngoài `src/pdf-editor/` (`styles.css`, `pace-theme.css`, `document-tools.css`, `topbar-mobile.css`). Ghi đè bằng `toolbar.css` với selector cụ thể hơn; giải thích trong báo cáo nếu bắt buộc phải khác.
- Không thêm dependency. UI tiếng Việt, dùng token trong `src/pace-theme.css`.
- KHÔNG sửa test có sẵn. Test cũ trượt → **DỪNG**, báo tên test + lý do.

## Tiêu chí hoàn thành
- K1 (`computeToolbarLayout`, hàm thuần):
  - đủ chỗ → `mode: 'full'`, không mục nào vào menu;
  - thiếu ít → `mode: 'compact'`, không mục nào vào menu;
  - thiếu nhiều → `mode: 'compact'` + menu chứa các nhóm **đúng thứ tự ẩn** ở mục 2;
  - Công cụ / Màu / Xoá / Undo / Redo **không bao giờ** vào menu, kể cả khi chỗ cực hẹp.
- K2 (jsdom): mở menu "Thêm" có nhóm Trang → bấm "Xoay trang" gọi đúng handler 1 lần. Esc đóng menu, focus về nút `⋯`. Mục bị vô hiệu không gọi handler.
- K3 (jsdom): `PropertiesPanel` với ảnh rộng 130.92 pt → ô Rộng hiển thị `130.9`.
- K4: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed** (gồm `topbar-mobile`, `topbar-help`).
- K5 (Claude kiểm tra khi QA, agent không làm):
  - ở 1024 / 1280 / 1440 / 1920px với PDF mở sẵn:
    - **mọi** nút của thanh công cụ hoặc nằm trọn trong viewport, hoặc nằm trong menu "Thêm";
    - không phần tử nào của `.toolbar` vượt mép phải viewport;
  - Xoay trang dùng được ở mọi bề rộng;
  - ô X/Y/Rộng/Cao không xuống dòng, cỡ chữ hiện đủ "16";
  - tên file 80 ký tự không đè nút nào (hộp bao không giao nhau) và có `title` đầy đủ;
  - 390 / 768px không đổi so với hiện tại.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/App.tsx -Pattern "useToolbarLayout","ToolbarOverflowMenu"
Select-String -Path src/pdf-editor/panel.css -Pattern "width: 50px"
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
git add src/App.tsx src/pdf-editor
git commit -m "fix(F-15): collapse toolbar into compact and overflow menu, fix properties field layout and file title overlap"
git push -u origin fix/f15-toolbar-overflow-panel-title
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Select-String `useToolbarLayout` / `ToolbarOverflowMenu`: có kết quả.
- Select-String `width: 50px`: **không có** kết quả.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f15-toolbar-overflow-panel-title
git rev-parse --short HEAD
git log --oneline -1 origin/fix/f15-toolbar-overflow-panel-title
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z, **dòng tổng kết vitest cả 2 lần**. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- ngưỡng/thuật toán chọn chế độ;
- danh sách mục trong menu "Thêm" theo từng mức;
- danh sách `TODO(verify)`.
