# [W-7] Spike engine PDF: đọc/ghi content stream và xoá thật chữ trong vùng, đo tỉ lệ đúng trên fixture

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (mục 4, 7, 8 — Q-P1 = A).
Tiền điều kiện: W-6 đã merge vào `main` (thư mục `src/pdf-editor/` đã tồn tại).
Nhánh: `spike/w7-content-stream-engine` (tạo từ `main`) · Commit: `feat(W-7): content stream tokenizer and in-region text removal engine (spike, not wired to UI)`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b spike/w7-content-stream-engine
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình.
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề
1. Khi người dùng "sửa chữ", `buildEditedPdf` (W-6, `src/pdf-editor/exportPdf.ts`) chỉ vẽ hình chữ nhật màu nền đè lên chữ cũ. Chữ cũ **vẫn nằm trong file** (test `KNOWN ISSUE B1`). Hình chữ nhật đó còn che mất đường kẻ/khung bảng.
2. `pdf-lib` 1.17.1 không có bộ phân tích content stream. Đã kiểm tra trong `node_modules/pdf-lib/cjs`:
   - có `decodePDFRawStream(raw).decode()`, `context.flateStream(bytes)`, `PDFPageLeaf.Contents()` (trả `PDFStream | PDFArray`), `Resources()`;
   - **không có** tokenizer toán tử.
3. Chủ dự án chọn tự viết engine (Q-P1 = A). Task này là **spike có cổng**: viết engine tối thiểu, đo trên fixture giả, viết báo cáo số liệu. **Chưa nối vào giao diện, chưa sửa `exportPdf.ts`.**
4. Content stream do `pdf-lib` sinh ra có dạng sau (Claude đã chạy thử):
   ```
   q BT 0 0 0 rg /Helvetica-xxx 12 Tf 24 TL 1 0 0 1 72 700 Tm <437573…> Tj T* ET Q
   q BT /BeVietnamPro-Regular-xxx 12 Tf … <0000000100000002…> Tj T* ET Q
   q 0 0 0 rg 1 w [] 0 d 1 0 0 1 70 670 cm … 0 0 m 0 50 l 200 50 l 200 0 l h B Q
   ```
   - `Contents` là `PDFArray` gồm nhiều stream `/FlateDecode`.
   - Font chuẩn: `/Type1` + `/WinAnsiEncoding` (1 byte/ký tự).
   - Font tiếng Việt nhúng: `/Type0` + `/Identity-H` (2 byte/ký tự, độ rộng glyph lấy từ `/W` của DescendantFonts).

## Logic cần đạt
1. **`src/pdf-editor/engine/contentTokenizer.ts`**
   - `tokenizeContent(bytes: Uint8Array): ContentOp[]`, với `ContentOp = { operator: string; operands: Operand[] }`.
   - Operand hỗ trợ: số, name (`/X`, có escape `#xx`), chuỗi literal `( … )` (ngoặc lồng nhau, escape `\n \r \t \b \f \( \) \\ \ddd`, xuống dòng nối), chuỗi hex `< … >` (khoảng trắng, số lẻ chữ số), mảng `[ … ]`, dict `<< … >>`, `true/false/null`, comment `%…`.
   - Ảnh inline `BI … ID <nhị phân> EI` → **1 op** giữ nguyên bytes, không phân tích phần nhị phân.
   - Chuỗi lưu dạng **bytes gốc** (`Uint8Array`) kèm cờ hex/literal, để ghi lại không mất dữ liệu.
   - `serializeContent(ops): Uint8Array`: ghi lại. Không cần giữ nguyên khoảng trắng, nhưng `tokenize(serialize(tokenize(x)))` phải **bằng** `tokenize(x)`.
   - Gặp cú pháp lạ → ném `ContentSyntaxError` có vị trí byte, không treo, không lặp vô hạn.
2. **`src/pdf-editor/engine/pageContent.ts`**
   - `readPageContent(doc: PDFDocument, pageIndex): Uint8Array`: nối các stream của `Contents` (chèn `\n` giữa các stream), giải nén bằng `decodePDFRawStream`. Filter không hỗ trợ → ném lỗi có tên filter.
   - `writePageContent(doc, pageIndex, bytes)`: thay `Contents` bằng **một** stream mới tạo bằng `doc.context.flateStream(bytes)`. Stream cũ không còn được trang tham chiếu.
3. **`src/pdf-editor/engine/textGeometry.ts`**
   - Duyệt ops, theo dõi:
     - trạng thái đồ hoạ: stack `q/Q`, `cm` (CTM);
     - trạng thái chữ: `BT/ET`, `Tm`, `Td`, `TD`, `T*`, `TL`, `Tf`, `Tc`, `Tw`, `Tz`, `Ts`;
     - toán tử vẽ chữ: `Tj`, `TJ`, `'`, `"`.
   - Với mỗi toán tử vẽ chữ, tính **hộp bao trong toạ độ trang** (pt, gốc dưới-trái) theo đặc tả PDF (ma trận chữ × CTM). Độ rộng lấy như sau:
     - font simple (`/Widths` + `/FirstChar`);
     - font chuẩn 14 không có `/Widths` → dùng bảng độ rộng của `pdf-lib` (`StandardFonts`). Tên API cụ thể chưa xác minh, ghi `TODO(verify)`. Không có thì dùng 0.5 em;
     - font `Type0` `Identity-H` (`/W`, mặc định `/DW` hoặc 1000);
     - các trường hợp khác dùng 0.5 em và đánh dấu `approximate: true`.
   - Trả `TextShowInfo[] = { opIndex, bbox, fontResourceName, approximate }`.
4. **`src/pdf-editor/engine/textRemoval.ts`**
   - `removeTextInRegions(doc, pageIndex, regions: Rect[]) → RemovalReport`, với `Rect` theo pt, gốc dưới-trái.
   - Quy tắc mức 1 (bắt buộc): xoá cả toán tử vẽ chữ nếu **tâm hộp bao** nằm trong một region. Toán tử `'`/`"` khi bị xoá phải **giữ hiệu ứng xuống dòng** (thay bằng `T*`, với `"` thì thêm `Tw`/`Tc` tương ứng), để dòng sau không lệch.
   - Quy tắc mức 2 (**mở rộng, không bắt buộc**): `TJ` có một phần nằm trong region → bỏ đúng các glyph trong region. Thay chúng bằng số kerning âm tương đương độ rộng, để glyph phía sau giữ nguyên vị trí. Không làm được thì ghi rõ trong báo cáo.
   - **Không đụng** toán tử không phải chữ: đường kẻ, hình chữ nhật, ảnh, màu…
   - Không đệ quy vào Form XObject (`Do` trỏ tới `/Subtype /Form`) và font `Type3`. Chỉ đếm vào `skipped` nếu hộp bao của XObject/glyph giao với region.
   - `RemovalReport = { removedOps, partialOps, skipped: { reason: 'form-xobject' | 'type3-font' | 'approximate-width' | 'decode-error'; count }[], approximateOps }`.
5. Engine là **hàm thuần trên `PDFDocument`**, không phụ thuộc React/DOM. Chạy được trong `// @vitest-environment node`.

## Ràng buộc
- Chỉ tạo/sửa:
  - `src/pdf-editor/engine/**`;
  - `src/pdf-editor/__tests__/engine-*.test.ts`;
  - `docs/pdf-editor/W-7-spike-report.md`.
- KHÔNG sửa `exportPdf.ts`, `PdfCanvas.tsx`, `App.tsx`, CSS, `server/`, `public/`, test có sẵn. Không thêm dependency.
- Fixture dựng trong test bằng `pdf-lib`, dữ liệu giả. Content stream viết tay được phép, ghi thẳng bằng `doc.context.flateStream('…')` / `context.stream`.
- Font tiếng Việt trong test: đọc woff từ `node_modules/@fontsource/be-vietnam-pro/files/` bằng `fs`.
- Kiểm chứng bằng pdf.js: `pdfjs-dist/legacy/build/pdf.mjs`, `getTextContent` (chữ còn/mất) và `getOperatorList` (đếm toán tử vẽ hình/ảnh).
- Điểm chưa chắc về đặc tả PDF → `TODO(verify)` + dẫn mục trong ISO 32000-1 (ví dụ "9.4.4 Text Space Details"), không bịa.

## Tiêu chí hoàn thành
- K1 (tokenizer round-trip): các mẫu sau đều đạt `tokenize(serialize(tokenize(x))) == tokenize(x)`; trang ghi lại bằng `writePageContent` cho pdf.js `getTextContent` **giống hệt** trước khi ghi.
  - chuỗi literal có `\(`, `\)`, `\\`, `\053`, ngoặc lồng;
  - hex lẻ chữ số;
  - name `/A#20B`;
  - dict `BDC`;
  - inline image `BI /W 2 /H 2 /BPC 8 /CS /G ID <4 byte> EI`;
  - comment.
- K2: chuỗi rác/không đóng ngoặc → ném `ContentSyntaxError` trong < 50 ms, không treo.
- K3 (fixture F1, `drawText` thường): 3 dòng Helvetica `Line A` / `Customer: Hoc vien Test 01` / `Line C`; region phủ dòng 2 → pdf.js không còn `Hoc vien Test 01`; `Line A`, `Line C` còn nguyên và **cùng toạ độ** (lệch ≤ 0.01 pt).
- K4 (F2, viết tay `Td`/`TD`/`TL`/`T*`/`'`/`"`): xoá dòng giữa của 4 dòng nối nhau bằng `T*` và `'` → các dòng còn lại giữ nguyên toạ độ (≤ 0.01 pt).
- K5 (F3, `q 2 0 0 2 0 0 cm` + `Tm` lồng `q/Q`): region tính theo toạ độ **trang** → xoá đúng chữ đã scale; chữ ngoài vùng còn.
- K6 (F4, tiếng Việt `Type0 Identity-H`): dòng `Học viên Test 01` (Be Vietnam Pro) → xoá được; `approximate === false`.
- K7 (F5, bảng): ô có viền (`re S` hoặc `m l … S`) và chữ bên trong → sau khi xoá chữ, số toán tử vẽ đường/hình chữ nhật trong `getOperatorList` **không đổi**; chữ ô bên cạnh còn.
- K8 (F6, Form XObject chứa chữ trong region) → không crash; `skipped` có `form-xobject: 1`; chữ đó **vẫn còn** (đúng kỳ vọng spike).
- K9 (F7, mức 2, mở rộng): `TJ` `[(Name: ) -20 (Hoc vien Test 01)]`, region chỉ phủ phần tên → `Name:` còn, tên mất. Không làm → ghi "chưa hỗ trợ" trong báo cáo, test đánh dấu `it.skip` kèm lý do.
- K10 (hiệu năng): trang 5.000 toán tử `Tj`, xoá 100 region → < 300 ms (lấy trung vị 3 lần đo, có chạy làm nóng trước).
- K11: `docs/pdf-editor/W-7-spike-report.md` có:
  - bảng `fixture | kỳ vọng | kết quả | ghi chú`;
  - danh sách trường hợp chưa hỗ trợ;
  - số liệu K10;
  - danh sách `TODO(verify)`;
  - đề xuất **đi tiếp / không đi tiếp** kèm lý do.
- K12: `npm run lint`, `npm run build` xanh; vitest kết thúc; mọi test cũ pass (kể cả `KNOWN ISSUE B1`, vì task này chưa nối engine vào xuất file).

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path src/pdf-editor/engine/*.ts -Pattern "export function (tokenizeContent|serializeContent|readPageContent|writePageContent|removeTextInRegions)"
Select-String -Path src/pdf-editor/exportPdf.ts,src/App.tsx -Pattern "engine/"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/pdf-editor docs/pdf-editor/W-7-spike-report.md
git commit -m "feat(W-7): content stream tokenizer and in-region text removal engine (spike, not wired to UI)"
git push -u origin spike/w7-content-stream-engine
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Select-String thứ nhất: đủ 5 hàm.
- Select-String thứ hai (`engine/` trong `exportPdf.ts`, `App.tsx`): **không có** kết quả.
- lint/build xanh; vitest kết thúc, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin spike/w7-content-stream-engine
git rev-parse --short HEAD
git log --oneline -1 origin/spike/w7-content-stream-engine
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- số liệu K10;
- tóm tắt `W-7-spike-report.md` (đề xuất đi tiếp hay không);
- danh sách `TODO(verify)`.
