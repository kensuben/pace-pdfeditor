# [W-5d] Sửa W-5 trước khi merge: ranh giới địa chỉ, không bỏ sót vùng chồng nhau, an toàn với NFD, residual độc lập, quét email tuyến tính

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
**Ngoại lệ có chủ đích (quyết định của chủ dự án):** task này sửa tiếp **trên chính nhánh** `feat/w5-entities-sensitive-masking` (chưa merge), không tạo nhánh mới. Lý do: W-5 hiện tại để lọt số điện thoại/email mà vẫn báo PASS. Merge vào sẽ khiến người dùng tin vào kết quả sai.
Commit thêm: `fix(W-5d): address boundaries, no dropped overlaps, NFD-safe offsets, independent residual, linear email scan`
KHÔNG push `main`, KHÔNG force-push, KHÔNG rebase lịch sử đã push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
```powershell
git status --porcelain
```
Có dòng nào → **DỪNG**, báo lại; không reset/clean/stash. Không có:
```powershell
git fetch origin
git checkout feat/w5-entities-sensitive-masking
git pull --ff-only
npm ci
```
Không dùng `npx` với package không có trong `package.json` (tsx, ts-node…). Không dùng `cmd /c` với chuỗi nhiều dòng. Lệnh chạy lâu phải có giới hạn thời gian, ví dụ:
```powershell
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
```

## Vấn đề (QA W-5 trên Linux, dữ liệu giả)
Commit W-5c (thanh trên cùng trên điện thoại) **đạt**, không cần sửa. Các lỗi dưới đây nằm ở W-5a (`src/word-anonymizer/core/`).

1. 🔴 **Vùng địa chỉ nuốt cả phần sau của đoạn, làm lọt dữ liệu mà vẫn báo PASS.**
   - `core/sensitive.ts`, `findSensitive` mục "2. Address": phần địa chỉ lấy từ sau nhãn **tới hết đoạn** (chỉ dừng ở xuống dòng; trong Word một đoạn không có xuống dòng). Phần chọn vùng ở cuối hàm (sắp theo `kindPriority`, rồi **bỏ** mọi vùng chồng lên vùng đã chọn) loại số điện thoại/email nằm trong vùng địa chỉ.
   - `maskAddress` chỉ che các phần trước dấu phẩy cuối, giữ nguyên phần cuối.
   - Đo thực tế với đoạn `Địa chỉ: Số 1 Đường Test, Hà Nội; Điện thoại: 0912 345 678; Email: lienhe.test@example.com; Đại diện: Ông Người Đại Diện Test 01`:
     - **Không entity:** kết quả `Địa chỉ: ****, Hà Nội; Điện thoại: 0912 345 678; Email: lienhe.test@example.com; Đại diện: Ông Người Đại Diện Test 01`, residual **PASS**.
     - **Có entity người đại diện:** kết quả `Địa chỉ: Số 1 Đường Test, Hà Nội; Điện thoại: 0912 345 678; Email: lienhe.test@example.com; Đại diện: Ông Người đại diện 1`, `replacements.byKind` toàn 0, residual **PASS**. Vùng địa chỉ chồng lên vùng entity nên bị bỏ (`core/textReplace.ts`), kéo theo số điện thoại và email.
   - Residual chỉ kiểm những giá trị có trong danh sách phát hiện ban đầu (`extraTargets`), nên không biết số điện thoại/email đã bị bỏ sót.
2. 🔴 **Văn bản dạng NFD bị hỏng chữ.** `core/textReplace.ts`, `findEntityMatches`: vị trí tìm trên `text.normalize('NFC')`, nhưng được dùng để thay trên chuỗi gốc. Đo thực tế: `'Đại diện: Người Đại Diện Test 01 ký tên'.normalize('NFD')` với entity → **`Đại diệNgười đại diện 1n Test 01 ký tên`**. Vừa hỏng nội dung, vừa để lộ một phần tên.
3. 🟠 **Regex email chạy chậm theo bình phương độ dài.** `EMAIL_REGEX` (`[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}…`). Đo thực tế:

   | Chuỗi | Thời gian |
   |---|---|
   | `'a@'+'a.'.repeat(30000)` | 3.669 ms |
   | `'x'.repeat(50000)+'@'` | 2.439 ms |
   | `'a@b'+'.b'.repeat(20000)+'!'` | 1.504 ms |

   Trong lúc chạy, tab trình duyệt bị treo.
4. 🟡 Nhãn `Trụ sở chính:` không được nhận là địa chỉ (`ADDRESS_LABEL_REGEX` yêu cầu `:` ngay sau `Trụ sở`).

## Logic cần đạt
1. **Ranh giới địa chỉ** (`core/sensitive.ts`):
   - Vùng địa chỉ bắt đầu sau nhãn và dừng ở vị trí **đầu tiên** trong các trường hợp sau:
     - ký tự `;`;
     - xuống dòng;
     - ngay **trước** một nhãn khác: `Điện thoại`, `ĐT`, `Tel`, `Fax`, `Email`, `E-mail`, `Website`, `Đại diện`, `Người đại diện`, `Chức vụ`, `MST`, `Mã số thuế`, `STK`, `Số tài khoản`, `CCCD`, `CMND`. So khớp không phân biệt hoa thường, có và không dấu, nguyên từ, có hoặc không có `:` theo sau.
   - Độ dài tối đa 200 ký tự. Bỏ dấu câu và khoảng trắng ở cuối vùng.
   - Thêm nhãn mở đầu: `Trụ sở chính`, `Địa chỉ liên hệ`, `Địa chỉ giao dịch` (giữ các nhãn cũ).
2. **Không bỏ sót vùng chồng nhau** (`core/sensitive.ts` và `core/textReplace.ts`):
   - Thứ tự xử lý trong một đoạn:
     - (a) thay entity;
     - (b) phát hiện email, số điện thoại, CCCD, MST, STK trên phần chữ **ngoài** vùng entity;
     - (c) địa chỉ chỉ che những phần chữ nằm **ngoài** vùng entity và vùng ở bước (b).
   - Không có giá trị nào bị bỏ chỉ vì chồng lên vùng khác. Mọi giá trị phát hiện được đều bị che, trừ khi nằm trong `keepValues` hoặc `maskKinds` của loại đó tắt.
   - `report.replacements` đếm đúng từng loại.
3. **An toàn với NFD:** trước khi ghép chuỗi của đoạn, chuẩn hoá nội dung từng `w:t` về NFC và ghi lại node ở dạng NFC. Vị trí tìm và vị trí thay phải dùng **cùng một** chuỗi. Không dùng chuỗi đã chuẩn hoá chỉ để tìm.
4. **Residual độc lập** (`core/residual.ts`):
   - Sau khi ẩn danh, chạy lại `findSensitive` trên chữ của **file đầu ra** (mọi part đã xử lý: document, header, footer, footnote, endnote, comments, text box) và trên `Target` của `.rels`.
   - Còn giá trị chưa che, loại đó đang bật, không nằm trong `keepValues` → `WARN` nếu trong chữ, `FAIL` nếu trong metadata/`.rels`.
   - Không coi dạng đã che (`09******78`, `l****@e****.com`…) là giá trị gốc.
   - Bỏ qua `w:delText` (đã có cảnh báo riêng, category `deleted-text`).
   - `PASS` chỉ khi không còn gì.
5. **Quét email tuyến tính:**
   - Bỏ `EMAIL_REGEX`. Dò từng vị trí `@` bằng `indexOf`.
   - Từ mỗi `@`: mở rộng sang trái tối đa 64 ký tự hợp lệ (`[A-Za-z0-9._%+-]`), sang phải tối đa 253 ký tự hợp lệ (`[A-Za-z0-9.-]`) bằng vòng lặp.
   - Kiểm phần tên miền có ít nhất một dấu chấm, đuôi cuối 2–24 chữ cái, không bắt đầu/kết thúc bằng `.` hoặc `-`.
   - Giữ quy tắc bỏ qua `@anonymized.invalid`.
6. GIỮ NGUYÊN: W-5b, W-5c, định dạng che một phần đã đạt, không sửa `w:delText`, các mẫu không được che nhầm (số tiền, ngày, MST/CCCD không có từ khoá…).

## Ràng buộc
- Chỉ sửa `src/word-anonymizer/core/*` và `src/word-anonymizer/__tests__/*`.
- Không sửa giao diện, `src/App.tsx`, `server/`, `public/`. Không thêm dependency.
- Test dùng dữ liệu giả như trên. Không commit file Word thật.

## Tiêu chí hoàn thành (test tự động trong `src/word-anonymizer/__tests__/`)
- K1: Đoạn ở Vấn đề mục 1, **không** entity → `Địa chỉ: ****, Hà Nội; Điện thoại: 09******78; Email: l****@e****.com; Đại diện: Ông Người Đại Diện Test 01`. Residual `WARN` vì tên người chưa được khai báo, hoặc `PASS` nếu agent chứng minh tên không nằm trong danh sách cần kiểm; ghi rõ trong báo cáo.
- K2: Cùng đoạn, **có** entity `Người Đại Diện Test 01` → `Địa chỉ: ****, Hà Nội; Điện thoại: 09******78; Email: l****@e****.com; Đại diện: Ông Người đại diện 1`. `replacements` đếm 1 entity, 1 phone, 1 email, 1 address. Residual `PASS`.
- K3: Giả lập bỏ sót: chạy với `maskKinds.phone = true` nhưng chèn số điện thoại vào output trước khi `scanResidual` (hoặc test hàm residual trực tiếp) → residual **không** `PASS`.
- K4: `Trụ sở chính: Tòa nhà Test, 123 Đường Mẫu, Quận Thử, TP. Hồ Chí Minh. Điện thoại: 028 3823 4567` → địa chỉ thành dạng `****, ****, ****, TP. Hồ Chí Minh` và điện thoại thành `02*******67`.
- K5: `'Đại diện: Người Đại Diện Test 01 ký tên'.normalize('NFD')` với entity → kết quả, sau khi chuẩn hoá NFC để so sánh, đúng bằng `Đại diện: Người đại diện 1 ký tên`.
- K6: `findSensitive` trên mỗi chuỗi sau chạy < 50 ms: `'a@'+'a.'.repeat(30000)`, `'x'.repeat(50000)+'@'`, `'a@b'+'.b'.repeat(20000)+'!'`, `'a@'.repeat(20000)`. Email bình thường `lienhe.test@example.com`, `ten.test@sub.example.com.vn` vẫn được phát hiện đúng.
- K7: Toàn bộ test cũ (A1–A15, B1–B7, C1–C6 và các test trước W-5) vẫn pass. `npm run lint`, `npm test` (phải kết thúc), `npm run build` xanh.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat origin/feat/w5-entities-sensitive-masking
Select-String -Path src/word-anonymizer/core/sensitive.ts -Pattern "EMAIL_REGEX"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/word-anonymizer
git commit -m "fix(W-5d): address boundaries, no dropped overlaps, NFD-safe offsets, independent residual, linear email scan"
git push origin feat/w5-entities-sensitive-masking
```
Kỳ vọng:
- `git diff --stat` chỉ có file trong Ràng buộc.
- Select-String `EMAIL_REGEX` không có kết quả.
- lint/build xanh; vitest kết thúc, không in `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w5-entities-sensitive-masking
git rev-parse --short HEAD
git log --oneline -5 origin/feat/w5-entities-sensitive-masking
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`; `git log` phải có commit `W-5d` ngay trên `W-5c`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng.

## Báo cáo
Output Bước 0, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md` + bảng `K | tên test | pass` + thời gian chạy của các chuỗi ở K6.
