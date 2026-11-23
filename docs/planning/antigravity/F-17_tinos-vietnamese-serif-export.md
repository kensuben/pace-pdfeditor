# [F-17] PDF Editor: chữ tiếng Việt kiểu Times New Roman xuất ra font có chân (Tinos) thay vì Arimo

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm (đặc biệt mục **Ba điều bắt buộc** và **Bước Y**).
Tiền điều kiện: F-16 đã merge (PR #72).
Nhánh: `fix/f17-tinos-vietnamese-serif` (tạo từ `main`) · Commit: `fix(F-17): bundle Tinos to export Vietnamese text in Times-style fonts`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi Bước Y in `PUSH OK` – dòng đó là dòng ĐẦU TIÊN của báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f17-tinos-vietnamese-serif
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Vấn đề (Claude đọc code trên `main` @ `afd19ab`)
1. Nhiều PDF xuất từ Word ở Việt Nam dùng Times New Roman.
   - W-9b/F-16 đã nhận đúng họ `Times Roman` cho chữ gốc.
   - Nhưng `resolveExportFontFamily` (`src/pdf-editor/fonts.ts` ~dòng 18-33) trả `Arimo` (font **không chân**) khi chữ có dấu:
     ```ts
     if (effective === 'Times Roman') return hasUnicode ? 'Arimo' : 'Times Roman'
     ```
   - Font chuẩn `Times-Roman` của PDF chỉ có bảng mã WinAnsi, không vẽ được tiếng Việt có dấu.
   - Hậu quả: sửa một dòng tiếng Việt trong hợp đồng/công văn font Times → dòng mới thành chữ không chân, lệch hẳn văn bản xung quanh.
2. App chỉ đóng gói Be Vietnam Pro + Arimo (`src/pdf-editor/fonts/`, nguồn ghi ở `SOURCES.md`, F-11). Không có font có chân hỗ trợ tiếng Việt.
3. **Tinos** (dự án googlefonts/Tinos) có cùng kích thước chữ với Times New Roman. Claude đã kiểm ngày 2026-11-23:
   - `google/fonts/ofl/tinos/METADATA.pb` ghi `license: "OFL"`, `category: "SERIF"`;
   - file `OFL.txt` của repo là SIL Open Font License 1.1 (cùng giấy phép với Be Vietnam Pro, Arimo đang dùng);
   - 4 file TTF đều có đủ ký tự tiếng Việt (đo bằng `@pdf-lib/fontkit` trên 134 ký tự có dấu + `“”‘’–—…•`: thiếu 0).

## Logic cần đạt
1. **Thêm 5 file** vào `src/pdf-editor/fonts/`. Tải đúng URL, **kiểm SHA256 trùng bảng**; lệch → DỪNG, báo lại.

   | File | URL nguồn | SHA256 |
   |---|---|---|
   | Tinos-Regular.ttf | https://raw.githubusercontent.com/googlefonts/Tinos/main/fonts/ttf/Tinos-Regular.ttf | 60A0E8EF0C04DD5DD69FFE91025FA2AE5836CBD35600A82BA031977557E2CB61 |
   | Tinos-Italic.ttf | https://raw.githubusercontent.com/googlefonts/Tinos/main/fonts/ttf/Tinos-Italic.ttf | 5942266ED398B155D7DC23E36833E7EC6BE988F2439BDBEB8EF1BEDE808EAA91 |
   | Tinos-Bold.ttf | https://raw.githubusercontent.com/googlefonts/Tinos/main/fonts/ttf/Tinos-Bold.ttf | 393269DBAB8899F938DB19783ECA5EAC92EB431F7AE0AB45B8349CA895F1A06B |
   | Tinos-BoldItalic.ttf | https://raw.githubusercontent.com/googlefonts/Tinos/main/fonts/ttf/Tinos-BoldItalic.ttf | A5DE79F0FE863EA0954757ACB3D47B3CCD0A930CE3DD5B97230CD3866790A06E |
   | OFL-Tinos.txt | https://raw.githubusercontent.com/googlefonts/Tinos/main/OFL.txt | CB3382D4643E8B02C12E322C220A3C76A5020D667E4FD4E7C75E744CCA6CAA6B |

   - Thêm 5 dòng vào bảng trong `SOURCES.md` (cùng định dạng, license `OFL-1.1`).
   - Thêm dòng `Ngày tải (Tinos): <ngày tải thật>`.
2. **`fonts.ts`**:
   - `EXPORT_FONT_FILES` thêm `Tinos` (4 biến thể, đúng tên file ở mục 1);
   - `resolveExportFontFamily`:
     - kiểu trả về thêm `'Tinos'`;
     - `requested === 'Tinos'` → `'Tinos'`;
     - `'Times Roman'` + chữ có ký tự > 127 → **`'Tinos'`** (thay cho `'Arimo'`);
     - `'Times Roman'` chỉ ASCII → vẫn `'Times Roman'` (font chuẩn, như cũ);
     - Helvetica / Courier / Noto Sans / mặc định: **giữ nguyên** như hiện tại.
   - `styleFromBaseFont`: tên chứa `tinos` → `family: 'Times Roman'` (đặt trước nhánh Courier). Xuất ra sẽ tự thành Tinos khi có dấu.
3. **`exportPdf.ts`**:
   - import 4 file Tinos bằng `?url` (giống Be Vietnam Pro/Arimo) và thêm vào `exportFontUrls`;
   - mọi chỗ kiểm `family === 'Be Vietnam Pro' || family === 'Arimo'` (~dòng 286 nạp font nhúng, ~dòng 332 kiểm `MISSING_GLYPH`) phải tính cả `'Tinos'`;
   - không đổi gì khác.
4. **Không** thêm Tinos vào danh sách chọn font trong panel/thanh định dạng, **không** đổi `cssFontStack` (bản xem trên Windows đã có Times New Roman). Ghi trong báo cáo nếu thấy cần.
5. GIỮ NGUYÊN: W-9a/b/c, F-16 (Be Vietnam Pro/Arimo), cách xuất các font khác, engine.

## Ràng buộc
- Chỉ được sửa/tạo:
  - 5 file mới trong `src/pdf-editor/fonts/` (mục 1) và `src/pdf-editor/fonts/SOURCES.md`;
  - `src/pdf-editor/fonts.ts`, `src/pdf-editor/exportPdf.ts`;
  - test mới `src/pdf-editor/__tests__/f17-*.test.ts`;
  - **test có sẵn được sửa đúng 1 chỗ**: `src/pdf-editor/__tests__/pdfEditor.test.ts`, test `K3: requested standard/Noto fonts with Vietnamese text S fall back to Arimo…` (~dòng 398-410):
    - **bỏ** `'Times Roman'` khỏi mảng `testFamilies`;
    - sửa comment dòng ~399 cho khớp: Times Roman đã chuyển sang Tinos, xem `f17-*`;
    - không đổi gì khác trong file.
- Test khác trượt → **DỪNG**, báo tên test + lý do, không tự sửa.
- Không thêm dependency npm (không dùng `@fontsource/tinos`).

## Tiêu chí hoàn thành
- K1: `Get-FileHash -Algorithm SHA256` của 5 file trùng bảng mục 1 (dán output).
- K2 (`resolveExportFontFamily`):
  - `('Times Roman', 'Học viên Test 01')` → `'Tinos'`;
  - `('Times Roman', 'Hoc vien Test 01')` → `'Times Roman'`;
  - `('Tinos', 'abc')` → `'Tinos'`;
  - `('Helvetica', 'Học viên')` → `'Arimo'`;
  - `('Courier', 'Học viên')` → `'Arimo'`;
  - `('Be Vietnam Pro', 'Học viên')` → `'Be Vietnam Pro'`.
- K3 (`styleFromBaseFont`):
  - `ABCDEF+Tinos-BoldItalic` → `{ Times Roman, true, true }`;
  - `TimesNewRomanPSMT` → `{ Times Roman, false, false }`.
- K4 (xuất, pdf.js thật):
  - annotation `fontFamily: 'Times Roman'`, chữ `Hợp đồng số 01/2026 – Học viên Test 01, Đường Test, Hà Nội`, 4 tổ hợp đậm/nghiêng;
  - với **mỗi** tổ hợp:
    - `BaseFont` trong file chứa `Tinos` (Regular/Bold/Italic/BoldItalic đúng biến thể);
    - không chứa `Arimo`;
    - pdf.js trích ra **đúng nguyên văn** chuỗi.
- K5 (hồi quy): `fontFamily: 'Times Roman'` chữ ASCII → `BaseFont` là `Times-Roman` (font chuẩn), không nhúng Tinos.
- K6 (W-9 hồi quy, pdf.js thật):
  - fixture pdf-lib dùng `StandardFonts.TimesRoman` vẽ `Hop dong so 01`;
  - sửa thành `Hợp đồng số 02` qua `buildReplacementAnnotation` → `buildEditedPdfWithReport`;
  - kết quả: chữ cũ mất, chữ mới vẽ bằng Tinos, `cleanedPages = [1]`.
- K7: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed**.
- K8 (Claude kiểm tra khi QA, agent không làm): PDF giả font Times → sửa dòng tiếng Việt → ô sửa và file xuất là chữ có chân, đúng dấu, copy ra đúng chữ.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Get-FileHash -Algorithm SHA256 src/pdf-editor/fonts/Tinos-*.ttf, src/pdf-editor/fonts/OFL-Tinos.txt | Format-Table Hash, Path -AutoSize
Select-String -Path src/pdf-editor/fonts.ts -Pattern "'Times Roman'\) return hasUnicode \? 'Arimo'"
Select-String -Path src/pdf-editor/exportPdf.ts -Pattern "Tinos"
git diff -- src/pdf-editor/__tests__/pdfEditor.test.ts
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- 5 hash trùng bảng.
- Select-String dòng `Times Roman → Arimo`: **không có** kết quả. `Tinos` có trong `exportPdf.ts`.
- Diff `pdfEditor.test.ts`: chỉ bỏ `'Times Roman'` khỏi mảng + sửa comment.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

Sau đó chạy **Bước Y** (`00_RULES.md`) với:
```powershell
$Branch = 'fix/f17-tinos-vietnamese-serif'
$Msg    = 'fix(F-17): bundle Tinos to export Vietnamese text in Times-style fonts'
$Paths  = @('src/pdf-editor/fonts', 'src/pdf-editor/fonts.ts', 'src/pdf-editor/exportPdf.ts', 'src/pdf-editor/__tests__')
$Expect = 1
```

## Báo cáo
Dòng đầu là `PUSH OK: …`. Sau đó theo `00_RULES.md` (output Bước A, toàn bộ output Bước Y, tổng kết vitest 2 lần), cộng thêm:
- bảng `K | tên test | pass`;
- output `Get-FileHash`;
- diff đúng của test cũ được phép sửa;
- tổng dung lượng 4 file TTF thêm vào;
- danh sách `TODO(verify)`.
