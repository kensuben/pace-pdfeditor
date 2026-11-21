# [W-14] Ẩn danh Word: người dùng nhập danh sách từ khoá → thay thế tất cả (thân văn bản, chữ đã xoá, comment, header/footer)

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/word-anonymizer/01-PLAN.md` (mục 8, quyết định Q-W3).
Tiền điều kiện: **W-13 đã merge vào `main`** (cùng sửa `textReplace.ts`, `anonymize.ts`, `WordAnonymizerPage.tsx`; từ khoá phải áp cho cả chữ đã xoá theo chế độ của W-13).
Nhánh: `feat/w14-keyword-replace-all` (tạo từ `main`) · Commit: `feat(W-14): user keyword replace-all rules with preview counts and residual check`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Kiểm thêm:
```powershell
git log --oneline -20 origin/main | Select-String "W-13"
```
Không thấy → **DỪNG**, báo lại. Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w14-keyword-replace-all
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình.
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề
1. Hiện tại người dùng chỉ thay được:
   - **pháp nhân/người đại diện** (`CustomEntity` có `kind: 'organization' | 'representative'`, `core/types.ts`, nhãn tự sinh "Pháp nhân A", "Người đại diện 1");
   - **6 loại thông tin nhạy cảm** tự nhận diện (`core/sensitive.ts`).
2. Các thông tin khác vẫn lộ, không có cách thay tự do:
   - chức vụ ("Giám đốc điều hành");
   - số giấy uỷ quyền ("Giấy Ủy Quyền số 01/2026/UQ …");
   - tên dự án, tên sản phẩm, mã hợp đồng, tên viết tắt nội bộ.
3. **Quyết định chủ dự án (Q-W3, 2026-11-21):** thêm chức năng nhập từ khoá → thay thế tất cả, trong module Ẩn danh Word.

## Logic cần đạt
1. **Kiểu** (`core/types.ts`):
   - `export interface KeywordRule { id: string; find: string; replace: string; ignoreDiacritics?: boolean }`;
   - `AnonymizeOptions.keywordRules?: KeywordRule[]`;
   - `AnonymizeReplacements.keywords: number`.
2. **Khớp từ khoá** (`core/textReplace.ts`, hàm thuần `findKeywordMatches(text, rules)`):
   - Không phân biệt hoa thường, so trên NFC, **nguyên từ** (không khớp giữa một từ dài hơn, dùng `\p{L}\p{N}` như `isWordChar`).
   - `ignoreDiacritics: true` → so sau khi bỏ dấu (gồm `đ/Đ → d/D`). Offset phải trỏ về **chuỗi gốc**: không bỏ dấu bằng cách đổi độ dài chuỗi rồi dùng offset cũ.
   - Từ khoá có khoảng trắng: khớp với 1 hoặc nhiều khoảng trắng/xuống dòng mềm trong văn bản.
   - Nhiều từ khoá chồng nhau: ưu tiên **dài hơn**.
   - `replace` rỗng → thay bằng `****`.
3. **Thứ tự ưu tiên** trong `replaceParagraphText`: **entity → từ khoá → thông tin nhạy cảm**. Phần đã bị lớp trước chiếm thì lớp sau không chạm (dùng cơ chế `subtractRanges` có sẵn).
4. **Phạm vi:** mọi chỗ đang áp entity hiện nay:
   - `word/*.xml` (thân văn bản, header/footer, footnotes/endnotes, `comments.xml`);
   - luồng `w:delText` theo `deletedTextMode` của W-13 (`mask` → áp; `remove`/`keep` → không áp).
5. **Xem trước:** hàm `countKeywordMatches(zip, rules, deletedTextMode)` trả về số lần khớp theo từng rule và theo nhóm (`body`, `deleted`, `comments`, `headerFooter`). Gọi sau khi người dùng ngừng gõ ~400ms.
6. **Kiểm tra sót** (`scanResidual`): thêm `keywordRules` vào `ScanResidualOptions`. Mỗi `find` còn sót (theo cùng cách khớp) → phát hiện, trạng thái tối thiểu `WARN`. Không báo sót nếu chuỗi `find` chỉ xuất hiện **bên trong** phần đã thay bằng `replace` của rule khác (ví dụ ở K7). Thay thế chạy **một lượt** trên văn bản gốc; phần vừa thay không bị rule khác thay tiếp.
7. **Kiểm tra hợp lệ** (hiện lỗi ngay tại dòng, chặn nút chạy):
   - `find` sau `trim` < 2 ký tự;
   - trùng `find` (không phân biệt hoa thường);
   - `replace` chứa `find` của chính rule đó;
   - `find` trùng nhãn pháp nhân/người tham gia đang dùng.
8. **Giao diện** (`WordAnonymizerPage.tsx`), thẻ mới "**Thay thế từ khoá**" đặt **sau** thẻ "Pháp nhân & người đại diện":
   - Mỗi dòng gồm:
     - ô "Từ khoá";
     - ô "Thay bằng" (placeholder `**** (để trống)`);
     - checkbox "Bỏ qua dấu";
     - số lần khớp;
     - nút xoá dòng.
   - Nút "Thêm từ khoá".
   - Nút "Dán danh sách": textarea, mỗi dòng `từ khoá => thay bằng` (hoặc chỉ từ khoá) → thêm nhiều dòng. Dòng sai định dạng thì báo, không thêm.
   - Đổi danh sách sau khi đã chạy → hiện "Cấu hình đã thay đổi".
   - **Không lưu** danh sách vào `localStorage` hay gửi lên server (có thể chứa tên thật).
9. **Activity log:** chỉ ghi `keywordRuleCount` và `keywordReplacementCount`. **Không** ghi từ khoá hay giá trị thay.
10. GIỮ NGUYÊN: entity, thông tin nhạy cảm, chế độ chữ đã xoá của W-13, mọi test cũ.

## Ràng buộc
- Chỉ được sửa:
  - `src/word-anonymizer/core/types.ts`, `textReplace.ts`, `anonymize.ts`, `residual.ts`, `inspect.ts` (nếu đặt `countKeywordMatches` ở đây), `index.ts`;
  - `src/word-anonymizer/WordAnonymizerPage.tsx`, `word-anonymizer.css`;
  - `src/word-anonymizer/__tests__/fixtures.ts` (chỉ thêm);
  - test mới `src/word-anonymizer/__tests__/w14-*.test.ts(x)`.
- KHÔNG sửa `src/pdf-editor/**`, `server/`, `public/`, test có sẵn. Không thêm dependency.
- Dữ liệu test giả: `Giám đốc điều hành`, `Giấy Ủy Quyền số 01/2026/UQ-TEST`, `Dự án Mẫu Thử`, `Công ty TNHH Mẫu Thử`.

## Tiêu chí hoàn thành
- K1 (`findKeywordMatches`):
  - "Giám đốc" khớp "giám đốc", "GIÁM ĐỐC";
  - **không** khớp "Phó Giám đốcX";
  - khớp "Giám  đốc" (2 dấu cách).
- K2 (`ignoreDiacritics`):
  - rule "Giam doc" + bỏ dấu khớp "Giám đốc", offset trỏ đúng chuỗi gốc;
  - không bật bỏ dấu thì **không** khớp.
- K3 (ưu tiên):
  - entity "Công ty TNHH Mẫu Thử" + từ khoá "Mẫu Thử" → chỉ entity được thay, không còn mảnh "Mẫu Thử";
  - từ khoá "0912 345 678" → thay theo từ khoá, không bị che SĐT chồng lên.
- K4 (nhiều run + phạm vi):
  - từ khoá "Giấy Ủy Quyền số 01/2026/UQ-TEST" tách 3 run trong thân văn bản, có trong comment, header và `w:delText` (`mask`) → cả 4 chỗ được thay;
  - chế độ `keep` thì `w:delText` giữ nguyên.
- K5 (`replace` rỗng) → `****`.
- K6 (hợp lệ): 4 trường hợp ở mục 7 đều chặn chạy và hiện thông báo.
- K7 (`scanResidual`):
  - còn sót "Dự án Mẫu Thử" → `WARN`;
  - rule A "Alpha" → "Dự án Beta", rule B "Beta" → "Gamma"; văn bản gốc chỉ có "Alpha" → file kết quả chứa "Dự án Beta", `scanResidual` **không** báo sót "Beta" (chuỗi này chỉ nằm trong phần thay của rule A, không phải dữ liệu gốc).
- K8 (`countKeywordMatches`): số đếm theo nhóm khớp fixture.
- K9 (giao diện, jsdom):
  - thêm 2 dòng, dán danh sách 3 dòng (1 dòng sai);
  - thấy 4 dòng hợp lệ + 1 thông báo lỗi định dạng;
  - `localStorage` không có khoá nào chứa từ khoá.
- K10: `npm run lint`, `npm run build` xanh. `vitest run` kết thúc, mọi test cũ pass.
- K11 (Claude kiểm tra khi QA): file .docx giả có chức vụ, số giấy uỷ quyền, tên dự án ở thân văn bản + Track Changes + comment → thay đủ, residual `PASS`.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/word-anonymizer/core/types.ts -Pattern "KeywordRule"
Select-String -Path src/word-anonymizer/WordAnonymizerPage.tsx -Pattern "localStorage"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/word-anonymizer
git commit -m "feat(W-14): user keyword replace-all rules with preview counts and residual check"
git push -u origin feat/w14-keyword-replace-all
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc.
- Select-String `KeywordRule`: có kết quả.
- Select-String `localStorage` trong trang: **không** có dòng mới liên quan từ khoá; giải thích nếu có dòng cũ.
- lint/build xanh; vitest kết thúc, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w14-keyword-replace-all
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w14-keyword-replace-all
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- cách giữ offset khi bỏ dấu;
- thứ tự ưu tiên đã cài;
- danh sách `TODO(verify)`.
