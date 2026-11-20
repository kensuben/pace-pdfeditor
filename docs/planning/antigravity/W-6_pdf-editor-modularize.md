# [W-6] PDF Editor: tách khỏi App.tsx thành module có test, KHÔNG đổi hành vi

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (mục 2, 5, 6).
Tiền điều kiện: F-10 đã merge vào `main` (PR #36).
Nhánh: `refactor/w6-pdf-editor-modules` (tạo từ `main`) · Commit: `refactor(W-6): extract pdf editor into modules with unit tests, no behavior change`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b refactor/w6-pdf-editor-modules
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude làm smoke test khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề
1. Toàn bộ PDF editor nằm trong `src/App.tsx` (878 dòng). Các phần nặng nhất:
   - `PdfCanvas` (`:88-255`);
   - gom fragment chữ thành dòng (`:143-172`);
   - xuất PDF `buildPdfBytes` (`:450-497`);
   - tạo annotation thay chữ `editTextRegion` (`:564-575`);
   - parse/gom kết quả OCR (`:593-609`);
   - thao tác trang: chèn/di chuyển/xoá (`:518-562`).
2. Không có test nào cho PDF editor. Các task nâng cấp tiếp theo (W-7…W-11, xem `01-PLAN.md`) sẽ sửa sâu vào những phần này. Thiếu test thì mọi thay đổi đều dễ gây lỗi ngầm.
3. Đã kiểm chứng: khi "sửa chữ", file xuất **vẫn chứa chữ gốc** (chỉ bị che bằng hình chữ nhật, `:482-489`). Task này **KHÔNG sửa** lỗi đó (để W-9 làm). Chỉ viết test đặc tả ghi nhận hành vi hiện tại.

## Logic cần đạt
1. Tạo thư mục `src/pdf-editor/` và **chuyển nguyên văn logic** (chỉ đổi chữ ký hàm để tách khỏi React state) sang các file sau.
   - `geometry.ts`:
     - `clamp`, `uid`;
     - `hexToRgb01(hex) → {r,g,b}` (0–1), thay cho các đoạn `parseInt(hex.slice…)/255` ở `:472` và `:484`.
   - `textExtraction.ts`:
     - `groupTextItemsIntoLines(items, styles, viewport, pageNumber): TextRegion[]` (logic `:143-172`, gồm khử trùng lặp `:158`). Vẫn dùng `pdfjs.Util.transform`.
     - `parseOcrTsv(tsv, page, canvasWidth, canvasHeight, makeId): TextRegion[]` (logic `:594-599`).
     - `groupOcrWordsIntoLines(words, page, makeId): TextRegion[]` (logic `:600-609`).
   - `textEdit.ts`: `buildReplacementAnnotation(region, nextText, neighbors, id): Annotation` (logic tính padding che `:566-571`).
   - `exportPdf.ts`:
     - `buildEditedPdf(bytes: Uint8Array, annotations: Annotation[], options?: { loadFontBytes?: (family: string, variant: string) => Promise<ArrayBuffer>; loadImageBytes?: (dataUrl: string) => Promise<ArrayBuffer> }): Promise<Uint8Array>`. Đây là logic `:450-497`.
     - Mặc định hai loader dùng `fetch` như hiện tại.
     - Các `import … ?url` của font chuyển theo sang file này.
   - `pageOps.ts`: hàm thuần nhận/trả bytes, tách khỏi state React.
     - `insertPdfPages(targetBytes, sourceBytes, afterPage) → {bytes, insertedCount}`;
     - `movePage(bytes, fromIndex, toIndex) → bytes`;
     - `deletePage(bytes, pageIndex) → bytes`;
     - các hàm remap annotation tương ứng: `:528`, `:543`, `:557`.
   - `TextFormatBar.tsx`, `IconButton.tsx`, `PdfCanvas.tsx`: chuyển component. **Props giữ nguyên.**
2. `src/App.tsx` chỉ còn: state, handler gọi các hàm trên, JSX. Handler vẫn gọi `log(...)` / `commit(...)` với **đúng chuỗi `action`, `description` và metadata như cũ**.
3. GIỮ NGUYÊN 100% hành vi: giao diện, CSS class, thứ tự render, phím tắt, Undo/Redo, activity log, kết quả file xuất (cùng toạ độ, cùng font, cùng hình chữ nhật che).

## Ràng buộc
- Chỉ được:
  - sửa `src/App.tsx`;
  - tạo file mới trong `src/pdf-editor/`;
  - tạo test trong `src/pdf-editor/__tests__/`.
- KHÔNG sửa:
  - `src/types.ts`, CSS, `src/word-anonymizer/`, `server/`, `public/`;
  - test có sẵn.
- Không thêm dependency.
- Không "tiện tay" sửa lỗi B1–B15 trong `01-PLAN.md`, không đổi tên CSS class, không format lại code ngoài phần di chuyển. Nếu bắt buộc phải đổi logic để tách được → ghi `TODO(verify)` và nêu trong báo cáo.
- Test dùng PDF **dựng bằng `pdf-lib` trong test**, dữ liệu giả (`Hoc vien Test 01`, `Học viên Test 01`, `@example.com`). Không commit file PDF.
- Test cần trích text từ PDF:
  - đặt `// @vitest-environment node` ở đầu file;
  - dùng `pdfjs-dist/legacy/build/pdf.mjs`.

  Nếu pdf.js đòi worker → ghi `TODO(verify)` + cách đã xử lý.
- Font tiếng Việt trong test: truyền `loadFontBytes` đọc file woff từ `node_modules/@fontsource/be-vietnam-pro/files/` bằng `fs`.

## Tiêu chí hoàn thành
- K1: `npm run lint`, `npm run build` xanh. `vitest run` kết thúc, mọi test cũ pass, có **ít nhất 10 test mới**:
  - T1 `groupTextItemsIntoLines`: 2 fragment cùng dòng, khoảng cách lớn → nối bằng 1 dấu cách; khoảng cách nhỏ → nối liền.
  - T2: fragment khác font hoặc khác bold → 2 dòng riêng.
  - T3: fragment trùng (cùng chữ, lệch < 0.002) → chỉ giữ 1.
  - T4 `parseOcrTsv`:
    - dòng level ≠ 5 bị bỏ;
    - confidence < 35 bị bỏ;
    - `groupOcrWordsIntoLines` gộp 2 từ cùng dòng, giữ confidence nhỏ nhất.
  - T5 `buildReplacementAnnotation`: có dòng phía trên rất sát → `maskPadTop` ≤ 25% khoảng cách. Không có dòng nào → bằng `height*0.08`.
  - T6 `buildEditedPdf`: fixture có chữ `Customer: Hoc vien Test 01`; annotation thay bằng `Customer: Test 02`.
    - File xuất mở được, số trang không đổi.
    - pdf.js trích ra có `Customer: Test 02`.
  - T7 **(đặc tả lỗi B1, tên test bắt đầu bằng `KNOWN ISSUE B1:`)**: cùng file ở T6 → pdf.js **vẫn trích ra** `Customer: Hoc vien Test 01`. Ghi comment: "W-9 sẽ đảo test này".
  - T8: highlight + ink (3 điểm) + ảnh PNG 1×1 (data URL hằng số trong test) → xuất không lỗi, số trang không đổi.
  - T9: text annotation `Học viên Test 01`, font `Be Vietnam Pro` (qua `loadFontBytes`) → pdf.js trích ra đúng `Học viên Test 01`.
  - T10 `pageOps`:
    - PDF 3 trang mỗi trang 1 chữ đánh dấu (`P1`, `P2`, `P3`): `movePage(0→1)` → thứ tự `P2, P1, P3`;
    - `deletePage(1)` → còn 2 trang;
    - `insertPdfPages` sau trang 1 → đúng thứ tự;
    - hàm remap annotation đổi `page` đúng cho cả 3 trường hợp.
- K2: `src/App.tsx` giảm ít nhất 250 dòng. Trong `App.tsx` **không còn**: `function PdfCanvas`, `getTextContent`, `drawRectangle`, `embedFont`, `split('\t')`.
- K3: `git diff main -- src/App.tsx` không đổi chuỗi `action:` / `description:` nào của activity log (chỉ di chuyển).
- K4: Không file nào ngoài phạm vi Ràng buộc bị sửa.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
(Get-Content src/App.tsx).Count
Select-String -Path src/App.tsx -Pattern "function PdfCanvas","getTextContent","drawRectangle","embedFont","split\('\\t'\)"
Select-String -Path src/pdf-editor/__tests__/*.ts -Pattern "KNOWN ISSUE B1"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/App.tsx src/pdf-editor
git commit -m "refactor(W-6): extract pdf editor into modules with unit tests, no behavior change"
git push -u origin refactor/w6-pdf-editor-modules
```
Kỳ vọng:
- `git diff --stat`: chỉ `src/App.tsx` và file trong `src/pdf-editor/`.
- Số dòng `App.tsx` ≤ 628.
- Select-String trên `App.tsx`: không có kết quả.
- Select-String `KNOWN ISSUE B1`: đúng 1 kết quả.
- lint/build xanh; vitest kết thúc, không in `TIMEOUT`, số test tăng ≥ 10.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin refactor/w6-pdf-editor-modules
git rev-parse --short HEAD
git log --oneline -1 origin/refactor/w6-pdf-editor-modules
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `T | tên test | pass`;
- số dòng `App.tsx` trước/sau;
- danh sách hàm đã tách, ghi file:dòng nguồn → file đích;
- mọi chỗ phải đổi logic để tách được (nếu có).
