# [W-4] Thêm nút "Hướng dẫn" dẫn tới trang `/huong-dan/`

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: PR #25 đã merge (trang `public/huong-dan/index.html` có trên `main`). Không phụ thuộc F-8 (F-8 chỉ sửa `server/`), làm song song được.
Nhánh: `feat/w4-help-link` (tạo từ `main`) · Commit: `feat(W-4): add help link to user guide in topbar and word anonymizer`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w4-help-link
npm ci
```

## Vấn đề
- Trang hướng dẫn cho người dùng đã có tại `/huong-dan/` (`public/huong-dan/index.html`, mục lục có các anchor `#dang-nhap`, `#pdf`, `#word`, `#ket-qua`, `#truoc-khi-upload`, `#nhat-ky`, `#hoi-dap`), nhưng trong app **không có chỗ nào dẫn tới**. Người dùng phải tự biết URL.
- Topbar: `src/App.tsx:648-650` (`.top-actions`). Khi đã đăng nhập, `.account-menu` có nút Activity log (`.activity-button`), Administration (admin), user chip, đăng xuất. Khi chưa đăng nhập chỉ có nút `.microsoft-login`. Style ở `src/auth-styles.css:1` và `:3` (≤800px ẩn chữ trên nút).
- Trang Ẩn danh Word (`src/word-anonymizer/WordAnonymizerPage.tsx`) có dòng nhắc cố định `.fixed-reminder-callout` ("Kiểm tra lại nội dung tài liệu trước khi upload…") và thẻ yêu cầu đăng nhập `.auth-required-card`.

## Logic cần đạt
1. **Topbar**: thêm một link "Hướng dẫn" trong `.top-actions`, hiển thị **cả khi chưa và đã đăng nhập**, đặt ngay **trước** nút đăng nhập / `.account-menu`.
   - Là thẻ `<a href="/huong-dan/" target="_blank" rel="noopener">`, không dùng `window.open`.
   - Có `aria-label="Hướng dẫn sử dụng"` và `title` giống vậy.
   - Có icon từ `lucide-react` (đã cài sẵn). Ưu tiên `BookOpen`; nếu tên icon không tồn tại trong bản `lucide-react` đang pin thì chọn icon tương đương có sẵn, ghi rõ trong báo cáo. Không thêm thư viện icon khác.
   - > 800px: icon + chữ "Hướng dẫn". ≤ 800px: chỉ icon (cùng breakpoint với `.microsoft-login`), kích thước bấm tối thiểu 34×34px.
2. **Trang Ẩn danh Word**:
   - Trong `.fixed-reminder-callout`, thêm link "Xem hướng dẫn" tới `/huong-dan/#word` (mở tab mới).
   - Ngay cạnh khu vực kết quả residual (PASS/WARN/FAIL), thêm link nhỏ "Ý nghĩa kết quả" tới `/huong-dan/#ket-qua` (mở tab mới).
3. Không log sự kiện bấm link (không cần, tránh thêm log).
4. GIỮ NGUYÊN: thứ tự và hành vi các nút hiện có trên topbar, switcher PDF/Word, toàn bộ logic PDF editor và Ẩn danh Word. Không sửa `public/huong-dan/`.

## Ràng buộc
- Chỉ sửa:
  - `src/App.tsx` (chỉ phần topbar và import icon)
  - `src/word-anonymizer/WordAnonymizerPage.tsx` (chỉ 2 link ở mục 2)
  - CSS: `src/auth-styles.css` hoặc `src/word-anonymizer/word-anonymizer.css`, agent chọn và ghi rõ
  - `src/word-anonymizer/__tests__/WordAnonymizerPage.test.tsx`
  - Có thể thêm `src/__tests__/topbar-help.test.tsx`
- Không thêm dependency. Không dùng inline `<script>`; link là HTML thuần (CSP hiện tại không cho script inline).

## Tiêu chí hoàn thành
- K1: Chưa đăng nhập → topbar có link `a[href="/huong-dan/"][target="_blank"]` với `aria-label="Hướng dẫn sử dụng"`. Đã đăng nhập (dùng đăng nhập giả lập DEV) → vẫn có, nằm trước nút Activity log.
- K2: Trang Ẩn danh Word có link `/huong-dan/#word` trong dòng nhắc; sau khi chạy ẩn danh có link `/huong-dan/#ket-qua` cạnh kết quả. Có test tự động cho cả 2 link.
- K3: 1280px: topbar hiện icon + chữ "Hướng dẫn". 768px và 390px: chỉ icon, topbar không xuống dòng vỡ layout, trang không cuộn ngang. Đính kèm 3 ảnh chụp topbar (390/768/1280).
- K4: `npm run build` rồi `npm run preview`, mở `/huong-dan/` → trang hướng dẫn hiển thị (không bị SPA fallback trả về `index.html` của app).
- K5: `npm run lint`, `npm test`, `npm run build` xanh; mọi test cũ pass.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path src/App.tsx -Pattern 'href="/huong-dan/"'
Select-String -Path src/word-anonymizer/WordAnonymizerPage.tsx -Pattern '/huong-dan/#word|/huong-dan/#ket-qua'
Select-String -Path src/App.tsx,src/word-anonymizer/WordAnonymizerPage.tsx -Pattern 'window.open'
npm run lint; npm test; npm run build
git add src
git commit -m "feat(W-4): add help link to user guide in topbar and word anonymizer"
git push -u origin feat/w4-help-link
```
Kỳ vọng:
- `git diff --stat` chỉ có file trong Ràng buộc.
- Select-String thứ 1 có 1 dòng; thứ 2 có 2 dòng.
- Select-String `window.open` không có kết quả.
- lint/test/build xanh.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w4-help-link
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w4-help-link
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Output Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md`, thêm:
- Bảng `K | cách kiểm | kết quả`.
- Tên icon đã dùng.
- 3 ảnh chụp topbar.
