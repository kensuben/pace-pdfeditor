# [F-15c] PDF Editor: menu "Thêm thao tác" hiện đầy đủ, không làm thanh công cụ bị cuộn

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/planning/antigravity/F-15_toolbar-overflow-panel-fields-file-title.md`.
Tiền điều kiện: F-15 đã merge (PR #59).
Nhánh: `fix/f15c-overflow-menu-clipping` (tạo từ `main`) · Commit: `fix(F-15c): render overflow menu outside toolbar scroll container`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f15c-overflow-menu-clipping
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Vấn đề (Claude đo trên Chromium, `main` @ `3b97d1f`, viewport 1024×720, PDF mở sẵn)
Bấm nút ⋯ "Thêm thao tác":
- `.toolbar` bị **cuộn dọc**: `scrollTop` 0 → 77, `scrollHeight` 61 → 291. Toàn bộ nút của thanh công cụ trôi khỏi vùng nhìn, thanh trống trơn.
- Menu bị **cắt**: chỉ thấy ~1 mục ("Di chuyển trang xuống"). Các mục Xoay trang, Xoá trang, Ký số, Scan OCR, Hiện khung bao không bấm được.

Nguyên nhân (đọc code):
1. `src/pdf-editor/toolbar.css` ~dòng 34-36: `.toolbar { overflow-x: auto; }`. Theo CSS, khi một trục khác `visible` thì trục kia cũng thành `auto` (đo được `overflow-y: auto`).
   - `.toolbar-overflow-menu` (`position: absolute`, ~dòng 71) nằm **trong** `.toolbar` → bị khung cuộn này cắt.
2. `src/pdf-editor/ToolbarOverflowMenu.tsx`:
   - ~dòng 171/176 (focus mục đầu khi mở) và ~194/198 (mũi tên lên/xuống) gọi `.focus()` không có `preventScroll`;
   - trình duyệt cuộn `.toolbar` để đưa mục được focus vào tầm nhìn → các nút trôi mất.

## Logic cần đạt
1. **Menu ra khỏi khung cuộn:**
   - render phần tử `role="menu"` qua `createPortal(…, document.body)` (`react-dom`, đã có sẵn), `position: fixed`;
   - vị trí tính từ `getBoundingClientRect()` của nút ⋯:
     - mép phải menu thẳng mép phải nút; nếu tràn mép trái viewport thì đẩy vào cách mép 8px;
     - mép trên = đáy nút + 6px; nếu đáy menu vượt đáy viewport thì đặt menu **phía trên** nút;
   - khi cửa sổ `resize` hoặc có `scroll` (lắng nghe ở capture phase) lúc menu đang mở → đóng menu. Không cần tính lại vị trí.
   - `z-index` đủ cao để nằm trên panel thuộc tính và thumbnail (dùng giá trị hiện có, 100, nếu đủ; ghi rõ trong báo cáo).
2. **Focus không cuộn:** mọi `.focus()` trong `ToolbarOverflowMenu.tsx` dùng `{ preventScroll: true }`, kể cả khi trả focus về nút ⋯.
3. **Click ra ngoài:** menu nằm ở portal nên `menuRef.current.contains(target)` vẫn đúng. Kiểm tra lại: click vào một mục trong menu **không** bị tính là "ra ngoài" trước khi handler chạy.
4. GIỮ NGUYÊN:
   - `role`, `aria-haspopup`, `aria-expanded`, `aria-label`, `aria-disabled`, `title`;
   - phím mũi tên/Enter/Esc, focus trả về nút ⋯ khi đóng;
   - handler của từng mục, danh sách mục, các mức L0–L5 trong `useToolbarLayout.ts`;
   - `overflow-x: auto` của `.toolbar` (vẫn cần cho mức L5 / màn hẹp);
   - mọi test F-15, `topbar-mobile`, `topbar-help`.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/pdf-editor/ToolbarOverflowMenu.tsx`;
  - `src/pdf-editor/toolbar.css` (chỉ khối `.toolbar-overflow-*`);
  - test mới `src/pdf-editor/__tests__/f15c-*.test.tsx`.
- KHÔNG sửa `useToolbarLayout.ts`, `App.tsx`, CSS ngoài `src/pdf-editor/`, test có sẵn.
  Test cũ trượt → **DỪNG**, báo tên test + lý do, không tự sửa.
- Không thêm dependency.

## Tiêu chí hoàn thành
- K1 (jsdom): mở menu → phần tử `[role="menu"]` là con (trực tiếp hoặc gián tiếp) của `document.body` và **không** nằm trong `.toolbar`; có `style.position === 'fixed'`.
- K2 (jsdom): bấm mục "Xoay trang" gọi handler đúng 1 lần rồi menu đóng. Esc đóng menu, `document.activeElement` là nút ⋯. Mục `aria-disabled` không gọi handler.
- K3 (jsdom): mock `HTMLElement.prototype.focus` (spy) → mọi lần gọi trong menu có đối số `{ preventScroll: true }`.
- K4 (jsdom): phát sự kiện `resize` trên `window` khi menu mở → menu đóng.
- K5: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed** (gồm test F-15 cũ).
- K6 (Claude kiểm tra khi QA, agent không làm): 1024px, PDF mở sẵn, bấm ⋯ →
  - `.toolbar.scrollTop` vẫn 0, mọi nút thanh công cụ còn hiển thị;
  - đủ 7 mục, nằm trọn trong viewport, bấm được (Xoay trang xoay đúng trang);
  - menu nằm trên panel thuộc tính, không bị che.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/ToolbarOverflowMenu.tsx -Pattern "createPortal","preventScroll"
Select-String -Path src/pdf-editor/ToolbarOverflowMenu.tsx -Pattern "\.focus\(\)"
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
git add src/pdf-editor/ToolbarOverflowMenu.tsx src/pdf-editor/toolbar.css src/pdf-editor/__tests__
git commit -m "fix(F-15c): render overflow menu outside toolbar scroll container"
git push -u origin fix/f15c-overflow-menu-clipping
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Select-String `createPortal` / `preventScroll`: có kết quả.
- Select-String `\.focus\(\)` (focus không đối số): **không có** kết quả.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f15c-overflow-menu-clipping
git rev-parse --short HEAD
git log --oneline -1 origin/fix/f15c-overflow-menu-clipping
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z, **dòng tổng kết vitest cả 2 lần**. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- cách tính vị trí menu và trường hợp lật lên trên;
- giá trị `z-index` đã chọn;
- danh sách `TODO(verify)`.
