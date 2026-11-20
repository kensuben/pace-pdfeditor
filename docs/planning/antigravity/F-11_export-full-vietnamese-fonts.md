# [F-11] Xuất PDF: nhúng font đầy đủ (Be Vietnam Pro, Arimo) để chữ tiếng Việt không bị mất

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/pdf-editor/01-PLAN.md` (mục 2.2, lỗi B16).
Tiền điều kiện: W-6 đã merge vào `main` (PR #38).
Nhánh: `fix/f11-export-full-fonts` (tạo từ `main`) · Commit: `fix(F-11): embed full Be Vietnam Pro and Arimo TTF on export, fail loudly on missing glyphs`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f11-export-full-fonts
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình (Claude kiểm tra trên trình duyệt khi QA).
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

### Tải font (bắt buộc kiểm tra SHA256)
Nguồn đã được Claude kiểm tra ngày 2026-11-20:
- Be Vietnam Pro: kho chính thức `google/fonts`, license OFL 1.1.
- Arimo: kho `googlefonts/Arimo`, license OFL 1.1.

Hash lệch → **DỪNG**, không dùng file đó, dán hash nhận được vào báo cáo.
```powershell
$dir = "src/pdf-editor/fonts"
New-Item -ItemType Directory -Force $dir | Out-Null
$bv = "https://raw.githubusercontent.com/google/fonts/main/ofl/bevietnampro"
$ar = "https://raw.githubusercontent.com/googlefonts/Arimo/main"
$files = @(
  @{ n="BeVietnamPro-Regular.ttf";    u="$bv/BeVietnamPro-Regular.ttf";    h="CD1EF6E9D7DB28AD5CDB88A65CCBE693870E60D340B791F349D248342B4FE4C3" },
  @{ n="BeVietnamPro-Italic.ttf";     u="$bv/BeVietnamPro-Italic.ttf";     h="A33EBB3F68E0E260A7D3874D64259AD309971A2DAF969E7CE5F444D70BCE535F" },
  @{ n="BeVietnamPro-Bold.ttf";       u="$bv/BeVietnamPro-Bold.ttf";       h="7F738FE5C43C8872807B20E2D30D42163618DE8A4DAF7F48A939ADAC32C16847" },
  @{ n="BeVietnamPro-BoldItalic.ttf"; u="$bv/BeVietnamPro-BoldItalic.ttf"; h="A2A65BDF9B251BEB3D658AE691889D71CE63C0290940C87CA60B449CEB0BDAEE" },
  @{ n="OFL-BeVietnamPro.txt";        u="$bv/OFL.txt";                     h="6B7F8F73609A25EA78C891E34CF37B06F8A676B7EA986E941E43B009110F2A85" },
  @{ n="Arimo-Regular.ttf";           u="$ar/fonts/ttf/Arimo-Regular.ttf";    h="41B22BC8F0B51F932825D37BC55B5EB6BA67DFE599A626E4AFF2B43B624F9F8C" },
  @{ n="Arimo-Italic.ttf";            u="$ar/fonts/ttf/Arimo-Italic.ttf";     h="FFDF690E4357A392E4EDCC3DF0B3ADB0302920F75E54F2E6EEC355AFBE7EDCBA" },
  @{ n="Arimo-Bold.ttf";              u="$ar/fonts/ttf/Arimo-Bold.ttf";       h="D7A8B187CF8444D4CFEE102E8EAE9E3043682FD5106D5D33ED677FE268A0E2BA" },
  @{ n="Arimo-BoldItalic.ttf";        u="$ar/fonts/ttf/Arimo-BoldItalic.ttf"; h="77C967D49D4EF4A63C39FBCD1E27892102E503E35A20983CB058430C4F268B34" },
  @{ n="OFL-Arimo.txt";               u="$ar/OFL.txt";                        h="C46FDA6859EFB80C0A3C1FAA868908A3D2FCB26EB7FD9602D73BEBEEC21BCA3A" }
)
foreach ($f in $files) {
  $out = Join-Path $dir $f.n
  Invoke-WebRequest -Uri $f.u -OutFile $out -UseBasicParsing -TimeoutSec 120
  $got = (Get-FileHash $out -Algorithm SHA256).Hash
  if ($got -ne $f.h) { Write-Output "HASH MISMATCH $($f.n) $got"; break } else { Write-Output "OK $($f.n)" }
}
```
Kỳ vọng: 10 dòng `OK …`, không có `HASH MISMATCH`.

## Vấn đề
1. **Lỗi B16 (production):** chữ xuất bằng font Be Vietnam Pro / Arimo / Noto Sans **gần như biến mất trong file PDF**.
   - Be Vietnam Pro là font mặc định của công cụ "Thêm chữ" (`src/App.tsx`, state `textStyle`).
   - Claude đã chạy thử trên `main`: thêm chữ `Học viên Test 01 - ghi chú` → xuất → PDF chỉ còn **một ký tự `ọ`**. Trên màn hình vẫn hiện đủ chữ, nên người dùng không biết file bị hỏng.
2. Nguyên nhân: `src/pdf-editor/exportPdf.ts:3-14` nhúng file `@fontsource/*/files/*-vietnamese-*.woff`. Đo bằng fontkit:
   - các file này **chỉ chứa ký tự có dấu** (ạ, ọ, ệ…);
   - thiếu toàn bộ chữ Latin thường: `H c v i ê n T e s t 0 1 A B C…`.
3. Noto Sans **không dùng được** để xuất. Claude đã thử bản hinted, unhinted và full (`notofonts`):
   - bản unhinted vỡ hình chữ;
   - bản hinted và full hiển thị đúng, nhưng chữ trích ra bị chèn ký tự rác sau các chữ có dấu nặng (`Học` → `Họ\u0003c`). Copy/tìm kiếm trong PDF sai.
4. Arimo có **độ rộng ký tự tương đương Arial/Helvetica**, nên là lựa chọn thay thế ít lệch bố cục nhất khi chữ Unicode đang đặt font Helvetica/Times/Courier.
5. `exportPdf.ts:62-73`: khi tải font lỗi, code (từ W-6) **lặng lẽ chuyển sang Helvetica**. Bản trước W-6 thì báo lỗi.
6. Test T9 (`src/pdf-editor/__tests__/pdfEditor.test.ts:413-451`, helper `getBeVietnamProTestFontBytes` `:48+`) **vá bảng ký tự của font trong test** (ép `ọ` vẽ bằng glyph `o`) để qua. Test này không kiểm tra đường chạy production và che mất lỗi B16.
7. Test dùng `process.cwd()` để tìm `node_modules` (`:26`, `:419`, `:466`) → chạy từ thư mục khác là trượt.

## Logic cần đạt
1. **File font:** 8 file TTF + 2 file OFL nằm ở `src/pdf-editor/fonts/`, tải theo đúng lệnh ở Bước 0. Thêm `src/pdf-editor/fonts/SOURCES.md`: bảng `file | URL nguồn | SHA256 | license`, ghi ngày tải.
2. **`src/pdf-editor/fonts.ts`** (mới):
   - `EXPORT_FONT_FILES: Record<'Be Vietnam Pro' | 'Arimo', Record<'regular' | 'italic' | 'bold' | 'bolditalic', string>>`: tên file TTF.
   - `resolveExportFontFamily(requested, text): 'Be Vietnam Pro' | 'Arimo' | 'Helvetica' | 'Times Roman' | 'Courier'`:
     - `Be Vietnam Pro` → `Be Vietnam Pro`;
     - `Arimo` → `Arimo`;
     - `Noto Sans` → `Arimo`;
     - `Helvetica` / `Times Roman` / `Courier`: nếu có ký tự mã > 127 → `Arimo`, ngược lại giữ nguyên (font chuẩn PDF, như hiện tại);
     - không có `fontFamily` → coi như `Helvetica` (như hiện tại).
3. **`exportPdf.ts`:**
   - Bỏ toàn bộ import `@fontsource/*.woff?url`. Import 8 file TTF bằng `?url` (Vite tự băm tên file trong `dist/assets/`).
   - Dùng `resolveExportFontFamily`. Biến thể (`regular/italic/bold/bolditalic`) chọn như cũ.
   - **Không fallback lặng lẽ:** tải hoặc nhúng font lỗi → ném `Error` với message bắt đầu bằng `FONT_LOAD_FAILED:`, kèm family + variant.
   - **Kiểm tra glyph trước khi vẽ:** với font nhúng, mọi ký tự (trừ khoảng trắng/xuống dòng) phải có trong `font.getCharacterSet()` (có trong `pdf-lib` 1.17.1, `PDFFont.d.ts:83`; hành vi với font chuẩn chưa xác minh → `TODO(verify)`). Thiếu ký tự → ném `Error` với message bắt đầu bằng `MISSING_GLYPH:`, kèm danh sách ký tự thiếu (tối đa 10, không trùng).
   - Giữ nguyên: nhúng `subset: true`, toạ độ, căn lề, gạch chân, hình chữ nhật che (B1 chưa sửa ở task này), ảnh, highlight, nét vẽ.
4. **`TextFormatBar.tsx`:** bỏ `<option>Noto Sans</option>`. Giữ `'Noto Sans'` trong kiểu `fontFamily` (`src/types.ts`) để annotation cũ trong phiên không lỗi; khi xuất đã map sang Arimo.
5. **`App.tsx` (chỉ khối `catch` của `exportPdf`, hiện ở `:259`):**
   - `alert` tiếng Việt: lỗi bắt đầu `FONT_LOAD_FAILED:` → "Không tải được phông chữ để xuất PDF. Kiểm tra mạng rồi thử lại."; lỗi bắt đầu `MISSING_GLYPH:` → "Phông chữ không hỗ trợ ký tự: …" (hiện các ký tự thiếu); lỗi khác → giữ thông báo hiện tại.
   - `log('document.export_failed', …)` thêm metadata `reason` = `font_load_failed` | `missing_glyph` | `unknown`. **Không** ghi ký tự hay nội dung tài liệu vào log.
6. **Test:**
   - Xoá helper `getBeVietnamProTestFontBytes` và T9 cũ.
   - Mọi đường dẫn file trong test tính từ `import.meta.url` (`fileURLToPath(new URL('../fonts/…', import.meta.url))`) hoặc `createRequire(import.meta.url).resolve('pdfjs-dist/package.json')`. Không dùng `process.cwd()`.
   - Font thật đọc từ `src/pdf-editor/fonts/` theo `EXPORT_FONT_FILES`, truyền vào `buildEditedPdf` qua `loadFontBytes`.
7. GIỮ NGUYÊN: font hiển thị trên màn hình (`src/main.tsx` vẫn dùng CSS Fontsource), chuỗi `action` của activity log, mọi test cũ khác (kể cả `KNOWN ISSUE B1`).

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/pdf-editor/fonts/*` (10 file tải + `SOURCES.md`);
  - `src/pdf-editor/fonts.ts`, `src/pdf-editor/exportPdf.ts`, `src/pdf-editor/TextFormatBar.tsx`, `src/pdf-editor/index.ts` (nếu cần export thêm);
  - `src/App.tsx` (**chỉ** khối `catch` của hàm `exportPdf`);
  - `src/pdf-editor/__tests__/*`.
- KHÔNG sửa `src/main.tsx`, `src/types.ts`, CSS, `nginx.conf`, `server/`, `public/`, `package.json`. Không thêm/xoá dependency (`@fontsource/*` vẫn dùng cho hiển thị).
- KHÔNG tải font từ nguồn khác ngoài 2 URL gốc ở Bước 0. Không chỉnh sửa file font.
- Dữ liệu test giả: `Học viên Test 01`, `Đường Ưu Đãi, Quận Mẫu`, `@example.com`.

## Tiêu chí hoàn thành
Chuỗi kiểm tra chung: `S = 'Học viên Test 01 – Đường Ưu Đãi, Quận Mẫu ₫'`.
Bộ ký tự `VN` = 89 chữ thường tiếng Việt (a à á ả ã ạ ă ằ ắ ẳ ẵ ặ â ầ ấ ẩ ẫ ậ b c d đ e è é ẻ ẽ ẹ ê ề ế ể ễ ệ g h i ì í ỉ ĩ ị k l m n o ò ó ỏ õ ọ ô ồ ố ổ ỗ ộ ơ ờ ớ ở ỡ ợ p q r s t u ù ú ủ ũ ụ ư ừ ứ ử ữ ự v x y ỳ ý ỷ ỹ ỵ) + chữ hoa tương ứng + `0-9` + `.,;:!?()-/@%&"'–₫`.

- K1: Test đọc 8 file TTF: SHA256 khớp `SOURCES.md`; fontkit có glyph cho **mọi** ký tự trong `VN`.
- K2: `buildEditedPdf` với 8 annotation (2 family × 4 biến thể), mỗi cái mang chuỗi `S` → pdf.js trích ra **đúng nguyên văn** `S` cho cả 8.
- K3: `fontFamily: 'Helvetica'` + chuỗi `S` → xuất bằng Arimo (BaseFont trong PDF chứa `Arimo`), trích ra đúng `S`. Tương tự với `Times Roman`, `Courier`, `Noto Sans`.
- K4: `fontFamily: 'Helvetica'` + `Customer: Test 02` (ASCII) → vẫn dùng font chuẩn `Helvetica` (BaseFont `Helvetica`). Đây là hành vi cũ, phải giữ nguyên.
- K5: `loadFontBytes` reject → `buildEditedPdf` reject, message bắt đầu `FONT_LOAD_FAILED:`. Không sinh file.
- K6: annotation `Be Vietnam Pro` chứa `Test 你好 😀` → reject, message bắt đầu `MISSING_GLYPH:` và chứa `你`.
- K7: `npm run build` → `dist/assets/` có đúng 8 file `*.ttf`; không còn file `*-vietnamese-*.woff` nào được `exportPdf` import (kiểm tra bằng Select-String trên source).
- K8: `npm run lint`, `npm run build` xanh. `vitest run` kết thúc, mọi test cũ pass; không còn `process.cwd()` trong `src/pdf-editor/__tests__/`.
- K9 (Claude kiểm tra khi QA, agent không cần làm): trên trình duyệt 1280px, thêm chữ `S` bằng font mặc định → xuất → PDF hiển thị đủ chữ; dropdown font không còn "Noto Sans".

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/exportPdf.ts -Pattern "@fontsource","vietnamese-.*woff"
Select-String -Path src/pdf-editor/__tests__/*.ts -Pattern "process.cwd\(\)","getBeVietnamProTestFontBytes"
Select-String -Path src/pdf-editor/TextFormatBar.tsx -Pattern "Noto Sans"
npm run lint; npm run build
(Get-ChildItem dist/assets -Filter *.ttf).Count
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/pdf-editor src/App.tsx
git commit -m "fix(F-11): embed full Be Vietnam Pro and Arimo TTF on export, fail loudly on missing glyphs"
git push -u origin fix/f11-export-full-fonts
```
Kỳ vọng:
- `git diff --stat` / `git status`: chỉ file trong Ràng buộc. Có 10 file font/license mới + `SOURCES.md`.
- 3 lệnh Select-String: **không có** kết quả.
- Số file `.ttf` trong `dist/assets`: `8`.
- lint/build xanh; vitest kết thúc, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f11-export-full-fonts
git rev-parse --short HEAD
git log --oneline -1 origin/fix/f11-export-full-fonts
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- 10 dòng `OK …` của bước tải font;
- bảng `K | tên test | pass`;
- tổng dung lượng 8 file TTF;
- danh sách `TODO(verify)`.
