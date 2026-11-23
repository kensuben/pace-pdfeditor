# [F-18b] PDF Editor: dòng rộng nhất trang khi sửa dài hơn cũng được kéo tới lề phải trước khi xuống dòng

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm (mục **Ba điều bắt buộc** và **Bước Y**).
Tiền điều kiện: F-18 đã merge (PR #76).
Nhánh: `fix/f18b-single-line-mirror-margin` (tạo từ `main`) · Commit: `fix(F-18b): use mirrored left margin as right limit for single-line replacements`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi Bước Y in `PUSH OK` – dòng đó là dòng ĐẦU TIÊN của báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f18b-single-line-mirror-margin
npm ci
```
Lệnh an toàn: không dùng `npx` với package ngoài `package.json`; không chạy dev server, không mở trình duyệt; lệnh chạy lâu phải có giới hạn thời gian (mẫu ở phần Chứng minh).

## Vấn đề (Claude QA F-18 trên trình duyệt, PDF giả font Times 595pt, dữ liệu giả)
1. PDF có 3 dòng ở x=70pt; dòng rộng nhất là `Dia chi: So 1 Duong Test, Ha Noi`.
2. Sửa dòng này thành `Địa chỉ: Số 1 Đường Test, Hà Nội` → bản xem **và** file xuất thành `… Hà` / `Nội`, dù bên phải trang còn trống ~55%.
3. Nguyên nhân: `src/pdf-editor/textEdit.ts` dòng 19-24, 43:
   - khi không có vùng cùng hàng bên phải, giới hạn = `maxContentRight` = mép phải lớn nhất của các vùng trên trang;
   - dòng đang sửa **chính là** dòng rộng nhất → `maxWidth = region.width`, chữ có dấu rộng hơn một chút là bị ngắt.
4. Tài liệu ngắn, biểu mẫu, phiếu (không có đoạn văn chạy hết khổ) hay gặp trường hợp này.

## Logic cần đạt
1. Trong `buildReplacementAnnotation` (chỉ nhánh vùng một dòng, không có `lineRects`):
   - tính `minContentLeft` = nhỏ nhất `nb.x` của các vùng `source: 'native'` không xoay trong `neighbors` (gồm cả chính vùng, nếu có trong danh sách), không lớn hơn `region.x`;
   - `mirroredRight = 1 − max(minContentLeft, 0.03)`. Giả định lề phải bằng lề trái; 0.03 chặn trường hợp chữ sát mép trái (số trang, chú thích) làm lề phải bằng 0;
   - giới hạn khi **không** có vùng cùng hàng bên phải: `limit = max(maxContentRight, mirroredRight)`;
   - khi **có** vùng cùng hàng bên phải: **giữ nguyên** như F-18 (`min(nearestRightX − gap, …)`). Vùng bên phải luôn được ưu tiên, không bao giờ vượt qua nó;
   - `maxWidth = max(region.width, limit − region.x)` như cũ.
2. GIỮ NGUYÊN:
   - khối nhiều dòng (`maxWidth` undefined);
   - cách xuất, bản xem, `isLabelLine`;
   - toàn bộ test F-18 (K1 dùng dữ liệu có `minContentLeft = 0.1`, `maxContentRight = 0.9` → kết quả không đổi).

## Ràng buộc
- Chỉ được sửa: `src/pdf-editor/textEdit.ts`; test mới `src/pdf-editor/__tests__/f18b-*.test.ts`.
- KHÔNG sửa test có sẵn. Test cũ trượt → **DỪNG**, báo tên test + lý do.
- Không thêm dependency.

## Tiêu chí hoàn thành
- K1 (`buildReplacementAnnotation`):
  - 3 vùng một dòng, cùng `x = 70/595`, rộng nhất `width = 200/595`, sửa chính vùng rộng nhất;
  - kết quả: `maxWidth ≈ (1 − 70/595) − 70/595` (±0.01), không phải `200/595`.
- K2: như K1 nhưng có vùng cùng hàng bên phải ở `x = 0.5` → `maxWidth ≈ 0.5 − gap − 70/595`, giống F-18.
- K3: có vùng số trang ở `x = 0.01` → `mirroredRight` dùng `0.03`, tức `maxWidth ≈ 0.97 − region.x`.
- K4 (xuất, pdf.js thật):
  - fixture Times 13pt 3 dòng ở x=70 như Vấn đề;
  - sửa dòng rộng nhất thành `Địa chỉ: Số 1 Đường Test, Hà Nội` qua `buildReplacementAnnotation` → `buildEditedPdfWithReport`;
  - kết quả: **1 dòng** (pdf.js trích ra nguyên chuỗi trên một toạ độ y), `overflowPages = []`.
- K5: `npm run lint`, `npm run build` xanh. `vitest run` chạy **2 lần**, đều **0 failed** (gồm `f18-*`).
- K6 (Claude kiểm tra khi QA): PDF giả ở Vấn đề → bản xem và file xuất 1 dòng.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/pdf-editor/textEdit.ts -Pattern "mirroredRight","minContentLeft"
git diff --stat -- src/pdf-editor/__tests__/
npm run lint; npm run build
foreach ($i in 1..2) { $p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
  if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' } }
```
Kỳ vọng:
- `git diff --stat`: chỉ `textEdit.ts` + 1 file test `f18b-*` mới.
- `mirroredRight`, `minContentLeft` có kết quả.
- lint/build xanh; vitest 2 lần, 0 failed, không `TIMEOUT`.

Sau đó chạy **Bước Y** (`00_RULES.md`) với:
```powershell
$Branch = 'fix/f18b-single-line-mirror-margin'
$Msg    = 'fix(F-18b): use mirrored left margin as right limit for single-line replacements'
$Paths  = @('src/pdf-editor/textEdit.ts', 'src/pdf-editor/__tests__')
$Expect = 1
```

## Báo cáo
Dòng đầu là `PUSH OK: …`. Sau đó theo `00_RULES.md` (output Bước A, toàn bộ output Bước Y, tổng kết vitest 2 lần), cộng thêm bảng `K | tên test | pass` và danh sách `TODO(verify)`.
