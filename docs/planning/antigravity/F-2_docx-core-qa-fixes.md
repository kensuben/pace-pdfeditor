# [F-2] Word Anonymizer core: sửa 8 lỗi QA của W-1 (nén, mention, revision trong comment, ngày giờ, email)

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: W-1 đã merge vào `main` (PR #7).
Nhánh: `fix/f2-docx-core-qa-fixes` (tạo từ `main`) · Commit: `fix(F-2): docx anonymizer core fixes for compression, mentions, dates and emails`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/fix/f2-docx-core-qa-fixes` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f2-docx-core-qa-fixes
npm ci
```

## Vấn đề
QA W-1 đã chạy thêm 7 tình huống ngoài bộ test, dùng dữ liệu giả. Kết quả:

1. **Không nén file đầu ra.** `anonymize.ts:434` gọi `zip.generateAsync({ type: 'blob', mimeType })` mà không truyền `compression`, nên JSZip mặc định lưu ở chế độ `STORE`. Đo thực tế: file 3 KB thành 721 KB.
2. **@mention người chưa từng bình luận bị lọt, và residual vẫn báo PASS.**
   - `inspect.ts` (mục "4. Scan word/_rels/comments.xml.rels", ~dòng 145): email `mailto:` không khớp ai thì bị bỏ qua, không thêm vào danh sách danh tính.
   - `anonymize.ts:87-117`: text mention chỉ được thay khi trùng tên một tác giả đã biết.
   - Hậu quả: comment chứa `<w:hyperlink r:id="rId1"><w:t>@Giảng viên Test 09</w:t></w:hyperlink>` với rel `mailto:giangvien.test09@example.com` vẫn giữ nguyên tên, còn rel bị đổi thành `nguoi-gop-y-1@…`.
3. **Tracked change bên trong comment không được ẩn danh.** `inspect.ts:76` và `anonymize.ts:196` loại `word/comments.xml` khỏi vòng quét `w:author` chung, nên `<w:ins w:author="…">` nằm trong comment vẫn giữ tên thật. Residual bắt được và báo FAIL, khiến người dùng bị khoá nút tải.
4. **Gán mention sai người.** `anonymize.ts:142` mặc định `matchedIndex = 1`, còn `anonymize.ts:158-169` đoán theo phần trước `@` của email. Đo thực tế: mention của "Người góp ý 2" bị đổi thành `nguoi-gop-y-1@…`.
5. **Namespace `w16du` sai.** `constants.ts:5` ghi `http://schemas.microsoft.com/office/word/2015/wordml/symex`; URI này thuộc `w16se`, không phải `w16du`. Hậu quả: `removeDates=true` vẫn để lại `w16du:dateUtc`.
6. **Email từ `presenceInfo` bị lưu nguyên chuỗi.** `inspect.ts:132`: `userId` có dạng `S::<email>::<guid>`, code chỉ kiểm `includes('@')` rồi gán cả chuỗi vào `email`. Vì vậy residual không tìm được email đứng riêng trong nội dung (đo thực tế: PASS, đúng ra phải WARN).
7. **Không có `TODO(verify)` nào**, dù có điểm chưa chắc như mục 5. Điều này vi phạm `00_RULES.md`.
8. **Thiếu test zip bomb theo dung lượng giải nén**; hiện chỉ có test theo số entry. Ngoài ra, `residual.ts` (`determineCategory`, ~dòng 103) chỉ coi `w:t` là văn bản, nên tên nằm trong `w:delText` (chữ đã xoá trong track changes) bị xếp vào metadata, gây FAIL giả.

## Logic cần đạt
1. **Nén**: `generateAsync` dùng `compression: 'DEFLATE'` (agent chọn `compressionOptions.level` và ghi rõ trong báo cáo).
2. **Mention theo link, không đoán theo tên**:
   - (a) Trong `word/comments.xml`, mention được xác định bằng `w:hyperlink` có `r:id` trỏ tới Relationship có `Target` bắt đầu bằng `mailto:` trong `word/_rels/comments.xml.rels`. Display text là nội dung các `w:t` trong hyperlink, bỏ ký tự `@` ở đầu.
   - (b) Ghép mention với danh tính đã biết theo thứ tự: email trùng khớp (không phân biệt hoa thường, so với email đã tách ở mục 6) → display text (sau `normalizeString`) trùng `author` → nếu không khớp, **tạo danh tính mới** loại `mentioned`.
   - (c) **Xoá** heuristic đoán theo phần trước `@` của email và fallback `matchedIndex = 1`.
   - (d) Khi `replaceMentions=true`: `w:t` đầu tiên trong hyperlink thành `@<label>`, các `w:t` còn lại trong hyperlink để rỗng; `Target` thành `mailto:<alias>@anonymized.invalid`. Giữ cách thay `@<tên>` dạng văn bản thường ngoài hyperlink như hiện tại.
3. **Loại danh tính và nhãn**:
   - `KnownIdentity` có thêm `kind: 'contributor' | 'mentioned'`. `contributor` là người có comment, revision, hoặc nằm trong `people.xml` / `core.xml`.
   - `MappedIdentity` có thêm `alias` (dùng cho email ẩn danh, không cho người dùng sửa).
   - `buildDefaultMapping`:
     - `contributor` → `Người góp ý N` / `NG<N>` / alias `nguoi-gop-y-N`.
     - `mentioned` → **`Người được nhắc N` / `NN<N>` / alias `nguoi-duoc-nhac-N`** (mặc định, quyết định Q-F2a; chủ dự án có thể đổi sau).
   - Thứ tự đánh số: giữ như W-1 (comments → revisions → people → core). `mentioned` đánh số riêng theo thứ tự xuất hiện.
4. **Revision trong comment**: vòng quét `@w:author` (mọi phần tử, theo namespace) áp dụng cho **cả** `word/comments.xml`, ở cả `inspect` (đếm revision) và `anonymize`. Không đếm trùng chính `w:comment@w:author`.
5. **Ngày giờ**: sửa URI `w16du`. Khi `removeDates=true`, xoá mọi thuộc tính có localName `dateUtc` mà namespace URI bắt đầu bằng `http://schemas.microsoft.com/office/word/`, để không phụ thuộc vào một URI cụ thể. Ghi `// TODO(verify): URI w16du` kèm nguồn đã đối chiếu (file Word 365 test do người vận hành tạo, hoặc tài liệu [MS-DOCX] của Microsoft). Không xác minh được thì ghi rõ trong báo cáo, **không bịa URI**.
6. **Tách email**: lấy email từ `w15:userId` / `w15:providerId` bằng regex email. `email` chỉ chứa địa chỉ email; `userId` giữ nguyên chuỗi gốc. Residual quét cả `email` lẫn `userId`.
7. **Residual**:
   - Thêm `w:delText` (và `w:instrText` nếu agent thấy hợp lý, ghi lý do) vào nhóm văn bản: trong `comments.xml` → `comment-text`, nơi khác → `body-text`.
   - Display text của danh tính `mentioned` là chuỗi cần quét.
8. **`TODO(verify)`**: đánh dấu mọi điểm OOXML chưa chắc (tối thiểu: URI `w16du`, cấu trúc mention `w:hyperlink` + `mailto`, `w16cex:dateUtc`), và liệt kê trong báo cáo.
9. **GIỮ NGUYÊN**: API 4 hàm công khai (chỉ được thêm field), các mã lỗi, giới hạn ZIP, quy tắc giữ nguyên byte của `commentsExtended.xml` / `commentsIds.xml` và các part không đổi, hành vi K1–K12 của W-1.

## Ràng buộc
- Chỉ sửa `src/word-anonymizer/core/*.ts` và `src/word-anonymizer/__tests__/*.ts`.
- Không thêm dependency.
- Không làm yếu hoặc xoá assertion của test W-1. Được cập nhật test cũ khi kiểu dữ liệu đổi (thêm `kind`, `alias`); ghi rõ trong báo cáo.
- Test mới dùng dữ liệu giả theo quy ước (`Học viên Test 01`, `giangvien.test09@example.com`). Không cần đổi fixture cũ.
- Mục "username Windows trong đường dẫn" (QA #9) **ngoài phạm vi**, để task sau.

## Tiêu chí hoàn thành
Mỗi K là ít nhất một test mới trong `src/word-anonymizer/__tests__/`:
- K1: Fixture nén `DEFLATE` có `word/document.xml` khoảng 500 KB chữ lặp → output `byteLength` ≤ 1,5 × input.
- K2: Mention người chưa bình luận (`@Giảng viên Test 09` + `mailto:giangvien.test09@example.com`) → có danh tính `kind: 'mentioned'`, nhãn `Người được nhắc 1`; `comments.xml` không còn tên; rel = `mailto:nguoi-duoc-nhac-1@anonymized.invalid`; residual `PASS`. Cùng fixture với `replaceMentions=false` → residual **không** PASS.
- K3: `<w:ins w:author="Học viên Test 01">` bên trong `w:comment` → đã thay nhãn; residual `PASS`; `revisionCount` tăng đúng 1.
- K4: Comment của người thứ 2 mention chính người thứ 2 bằng email không giống tên (`mailto:vanthikhach@example.com`, display text trùng author) → rel = alias của **người thứ 2**. Mention có email lạ và display text lạ → danh tính `mentioned` mới, không gán vào người số 1.
- K5: `removeDates=true` trên fixture có `w16du:dateUtc` (URI agent đã xác minh) và một `dateUtc` thuộc namespace Word khác → không còn thuộc tính `dateUtc` nào; `w:date` cũng đã xoá.
- K6: `presenceInfo w15:userId="S::hocvien.test03@example.com::00000000-0000-0000-0000-000000000000"` → `identity.email === 'hocvien.test03@example.com'`; comment chứa email đó → residual `WARN`, category `comment-text`.
- K7: Tên tác giả nằm trong `w:delText` ở `document.xml` → residual `WARN`, category `body-text` (không phải `FAIL`).
- K8: Một entry giải nén 400 MB (toàn byte 0, nén DEFLATE) → `ZIP_BOMB` trong < 5 s, không hết bộ nhớ.
- K9: Toàn bộ test W-1 (K1–K12) vẫn pass; `npm run lint`, `npm test`, `npm run build` xanh.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path src/word-anonymizer/core/anonymize.ts -Pattern "matchedIndex = 1|emailPrefix"
Select-String -Path src/word-anonymizer/core/constants.ts -Pattern "2015/wordml/symex"
Select-String -Path src/word-anonymizer/core/anonymize.ts -Pattern "DEFLATE"
Select-String -Path src/word-anonymizer/core/*.ts -Pattern "TODO\(verify\)"
npm run lint; npm test; npm run build
git add src/word-anonymizer
git commit -m "fix(F-2): docx anonymizer core fixes for compression, mentions, dates and emails"
git push -u origin fix/f2-docx-core-qa-fixes
git log --oneline -1 origin/fix/f2-docx-core-qa-fixes
```
Kỳ vọng:
- `git diff --stat` chỉ có file trong `src/word-anonymizer/`.
- Lệnh Select-String thứ 1 và 2 không có kết quả.
- Lệnh thứ 3 có ít nhất 1 dòng.
- Lệnh thứ 4 có ít nhất 3 dòng.
- lint/test/build xanh.
- Dòng cuối in commit vừa push.

## Báo cáo
Output `git rev-parse` của Bước A + 2 output git ở đầu, rồi theo `00_RULES.md`, thêm:
- Bảng `K | tên test | pass`.
- Kích thước input/output của test K1.
- URI `w16du` đã dùng và nguồn đối chiếu (hoặc ghi "chưa xác minh").
- Thay đổi kiểu dữ liệu ảnh hưởng tới W-2 (`kind`, `alias`).
