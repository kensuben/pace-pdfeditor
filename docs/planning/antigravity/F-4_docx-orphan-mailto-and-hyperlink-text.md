# [F-4] Word Anonymizer core: ẩn danh link mailto không được mention, bỏ đoán theo email, thay tên trong hyperlink thường

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: F-2 đã merge vào `main` (PR #11). Có thể làm song song W-2 (W-2 không sửa `core/`).
Nhánh: `fix/f4-docx-orphan-mailto` (tạo từ `main`) · Commit: `fix(F-4): anonymize orphan mailto rels, drop email-prefix guessing, handle text in web hyperlinks`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/fix/f4-docx-orphan-mailto` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f4-docx-orphan-mailto
npm ci
```

## Vấn đề
QA F-2 phát hiện 3 điểm (dữ liệu giả):
1. **Link `mailto:` "mồ côi" bị lọt.** "Mồ côi" là Relationship trong `word/_rels/comments.xml.rels` có `Target="mailto:…"` nhưng không có `w:hyperlink` nào trong `comments.xml` trỏ tới.
   - `inspect.ts` (mục "Scan for @mention hyperlinks", ~dòng 119–160) chỉ thêm danh tính từ link được hyperlink trỏ tới, nên email mồ côi không vào danh sách danh tính.
   - Hậu quả: email thật còn nguyên trong rels mà residual vẫn **PASS**. Đo thực tế: `mailto:vanthikhach@example.com` và `mailto:nguoila.test@example.com` còn nguyên, residual PASS.
2. **Còn đoạn đoán theo phần trước `@` của email.** `anonymize.ts:228–273` ("Also process any unhandled mailto…") so `userPart` với tên tác giả bằng `includes`. Điều này vi phạm yêu cầu F-2 (Logic 2c) và có thể gán email sang nhầm người.
3. **Bỏ qua text trong mọi hyperlink.** `anonymize.ts:286` bỏ qua mọi `w:t` có ông nội là `w:hyperlink`, kể cả link web thường. Khi bật `replaceNamesInCommentText`, tên nằm trong link web không được thay. Ngoài ra, cách kiểm tra theo đúng 2 cấp cha sẽ sai nếu `w:t` nằm sâu hơn.

## Logic cần đạt
1. **Inspect**: mọi Relationship `mailto:` trong `comments.xml.rels` mà **không** có `w:hyperlink` nào trỏ tới → tạo danh tính `kind: 'mentioned'`, `author` = địa chỉ email (chữ thường), `email` = địa chỉ đó. Riêng nếu email trùng email của danh tính đã có, thì dùng lại danh tính đó, không tạo mới.
2. **Anonymize**: xoá toàn bộ khối đoán theo email (`anonymize.ts:228–273`). Mọi Relationship `mailto:` (có hay không có hyperlink trỏ tới) được đổi `Target` theo `alias` của danh tính tương ứng, tìm bằng email trùng khớp. Không tìm được danh tính thì **không đoán**: đổi thành `mailto:nguoi-khac@anonymized.invalid` và ghi thêm cảnh báo vào `report.warnings`.
3. **Text trong hyperlink**:
   - Chỉ bỏ qua `w:t` thuộc `w:hyperlink` là **mention đã xử lý** (hyperlink trỏ tới rel `mailto:` và đã được thay nhãn). Xác định bằng cách đi lên tổ tiên gần nhất là `w:hyperlink`, không dựa vào số cấp cha cố định.
   - Text trong hyperlink web thường (`http…`) vẫn đi qua bước thay `@<tên>` và thay tên (khi bật option).
4. GIỮ NGUYÊN: API công khai, `kind`/`alias`, nhãn `Người được nhắc N`, mọi hành vi đã đạt ở W-1/F-2.

## Ràng buộc
- Chỉ sửa `src/word-anonymizer/core/inspect.ts`, `src/word-anonymizer/core/anonymize.ts` và `src/word-anonymizer/__tests__/*.ts`. Sửa file core khác chỉ khi bắt buộc; ghi lý do.
- Không thêm dependency. Không làm yếu assertion cũ.
- Test mới dùng dữ liệu giả (`Học viên Test 01`, `@example.com`).

## Tiêu chí hoàn thành
- K1: `comments.xml.rels` có 2 rel `mailto:` mồ côi (`vanthikhach@example.com`, `nguoila.test@example.com`) → inspect có 2 danh tính `mentioned`; output không còn 2 email đó ở bất kỳ part nào; residual `PASS`. Cùng fixture với `replaceMentions=false` → residual **không** PASS.
- K2: Rel mồ côi có email trùng email của một người góp ý (lấy từ `people.xml`) → `Target` = alias của người đó; không tạo danh tính `mentioned` mới.
- K3: `replaceNamesInCommentText=true`; comment có `<w:hyperlink r:id="rIdWeb">` trỏ `https://example.com` với text chứa tên `Học viên Test 01` → tên đã được thay; mention `mailto:` trong cùng comment vẫn chỉ có đúng một `@<nhãn>` (không thay 2 lần).
- K4: Toàn bộ test W-1/F-2 (26 test) vẫn pass; `npm run lint`, `npm test`, `npm run build` xanh.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path src/word-anonymizer/core/anonymize.ts -Pattern "userPart|unhandled mailto|parentElement\?\.parentElement"
npm run lint; npm test; npm run build
git add src/word-anonymizer
git commit -m "fix(F-4): anonymize orphan mailto rels, drop email-prefix guessing, handle text in web hyperlinks"
git push -u origin fix/f4-docx-orphan-mailto
git log --oneline -1 origin/fix/f4-docx-orphan-mailto
```
Kỳ vọng:
- `git diff --stat` chỉ có file trong `src/word-anonymizer/`.
- Select-String không có kết quả.
- lint/test/build xanh, tổng số test ≥ 29.
- Dòng cuối in commit vừa push.

## Báo cáo
Output `git rev-parse` của Bước A + 2 output git ở đầu, rồi theo `00_RULES.md` + bảng `K | tên test | pass`.
