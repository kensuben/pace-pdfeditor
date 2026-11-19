# [W-5] Ẩn danh Word: thay tên pháp nhân / người đại diện do người dùng nhập, tự che email và số điện thoại bằng `****`

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: **W-4 đã merge** vào `main` (cùng sửa `WordAnonymizerPage.tsx`). Không phụ thuộc F-9 (F-9 chỉ sửa `server/`).
Nhánh: `feat/w5-entities-contact-masking` (tạo từ `main`) · **2 commit theo thứ tự** (quyết định của chủ dự án: gộp core + UI vào một task, mỗi phần một commit):
1. `feat(W-5a): core text replacement for custom entities and email/phone masking`
2. `feat(W-5b): UI for entity fields and detected contacts`

Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push, KHÔNG gộp 2 phần vào 1 commit.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w5-entities-contact-masking
npm ci
```

## Vấn đề
- Hiện công cụ chỉ ẩn danh **người bình luận / người sửa / người được @nhắc** và metadata. Tên công ty (pháp nhân), tên người đại diện, email, số điện thoại nằm **trong thân văn bản** (hợp đồng, đề xuất, biên bản) vẫn giữ nguyên. Người dùng phải tự sửa tay trước khi đưa lên AI.
- `src/word-anonymizer/core/types.ts:54-60` (`AnonymizeOptions`) chỉ có 5 tuỳ chọn. Chỉ `replaceNamesInCommentText` thay chuỗi, và chỉ trong `comments.xml`, theo từng `w:t` riêng lẻ (`core/anonymize.ts`). Tên bị Word tách thành nhiều run (do định dạng hoặc kiểm tra chính tả) sẽ không được thay.
- `core/residual.ts:34-38`: chỉ quét tên/email/userId của người tham gia.
- Trang hướng dẫn (`public/huong-dan/`) đang ghi rõ thân văn bản **không** được ẩn danh. Task này **không** sửa trang hướng dẫn; Claude sẽ cập nhật sau QA.

## Quyết định của chủ dự án
- **Q-W5a:** pháp nhân và người đại diện do **người dùng nhập tay**. Không tự nhận diện bằng AI/NER; công cụ chỉ thay đúng những gì người dùng khai báo.
- **Q-W5b:** email và số điện thoại được **tự phát hiện**, mặc định **che toàn bộ bằng `****`**. Người dùng xem danh sách và có thể bỏ chọn từng mục để giữ lại (ví dụ hotline công khai).
- **Q-W5c:** áp dụng cho **toàn bộ nội dung chữ** của tài liệu: thân văn bản, header, footer, footnote, endnote, text box, bình luận, và **chữ đã xoá trong Track Changes** (`w:delText`, vẫn nằm trong file dù không hiển thị).
- **Q-W5d:** danh sách pháp nhân, người đại diện và danh sách email/số điện thoại phát hiện được là **dữ liệu nhạy cảm**. Chỉ giữ trong bộ nhớ trang; không lưu `localStorage`, không ghi log, không gửi lên server.

---

## Phần A — Core (`src/word-anonymizer/core/`) · commit `W-5a`

### Logic cần đạt
1. **Kiểu dữ liệu** (`types.ts`):
   - `EntityKind = 'organization' | 'representative'`.
   - `CustomEntity { id: string; kind: EntityKind; label: string; values: string[] }`. `values` là các cách viết của cùng một đối tượng, vd. `["Công ty TNHH Mẫu Thử", "Mẫu Thử Co., Ltd", "Cty Mẫu Thử"]`.
   - `AnonymizeOptions` thêm `customEntities: CustomEntity[]` (mặc định `[]`), `maskEmails: boolean` (mặc định `true`), `maskPhones: boolean` (mặc định `true`), `keepContacts: string[]` (mặc định `[]`, các giá trị đã chuẩn hoá mà người dùng chọn giữ).
2. **Phát hiện liên hệ** (`contacts.ts`, mới):
   - `findContacts(text)` trả danh sách `{ kind: 'email' | 'phone', value, normalized }`.
   - **Email:** mẫu email thông thường, không phân biệt hoa thường. **Bỏ qua** địa chỉ `@anonymized.invalid` (do chính công cụ sinh ra cho mention).
   - **Số điện thoại Việt Nam** (đánh dấu `TODO(verify)` cho các đầu số):
     - Di động: `0` hoặc `+84` / `84`, theo sau 9 chữ số bắt đầu bằng `3|5|7|8|9`.
     - Cố định: `0` hoặc `+84` / `84`, theo sau 10 chữ số bắt đầu bằng `2`.
     - Giữa các nhóm số được có **một** ký tự phân cách: dấu cách, `.`, `-`; cho phép ngoặc quanh mã vùng.
     - Không khớp nếu dính liền chữ số hoặc chữ cái ở hai đầu.
     - `normalized` = chỉ chữ số, đổi tiền tố `84` thành `0`.
   - **Không** coi là số điện thoại: số tiền (`1.000.000.000`), ngày (`19.11.2026`), mã số thuế dạng `0101234567-001`, chuỗi dài hơn 12 chữ số.
3. **Kiểm tra file** (`inspect.ts`): `InspectionReport` thêm `contacts: { emails: {value, normalized, count}[]; phones: {value, normalized, count}[] }`, quét trên toàn bộ nội dung chữ ở mục Q-W5c và trên `Target` có `mailto:` / `tel:` trong mọi file `.rels`.
4. **Bộ thay chữ theo đoạn** (`textReplace.ts`, mới) — phần quan trọng nhất:
   - Với mỗi `w:p`: ghép nội dung các node chữ (`w:t` và `w:delText`, giữ đúng thứ tự trong tài liệu) thành một chuỗi, tìm vị trí cần thay, rồi **ánh xạ ngược** vào từng node.
   - Chuỗi thay thế đặt vào node chứa ký tự đầu của đoạn khớp; phần còn lại của đoạn khớp bị xoá khỏi các node sau.
   - Không đụng tới node không liên quan. Không đổi định dạng (`w:rPr`). Giữ `xml:space="preserve"` khi node có khoảng trắng ở đầu/cuối.
   - Khớp **không phân biệt hoa thường**, sau khi chuẩn hoá Unicode NFC. **Giữ dấu tiếng Việt**: "Nguyễn" khác "Nguyen".
   - Khớp **nguyên từ**: không thay "ABC" bên trong "ABCD" hay "XABC". Ranh giới là ký tự không phải chữ/số theo Unicode (`\p{L}\p{N}`).
   - Nhiều mẫu chồng nhau → ưu tiên **chuỗi dài nhất** trước ("Công ty TNHH Mẫu Thử Việt Nam" trước "Mẫu Thử").
5. **Áp dụng** (`anonymize.ts`):
   - Với mọi part ở Q-W5c (gồm `comments.xml`): thay mọi `values` của `customEntities` bằng `label`; nếu `maskEmails` thì thay email bằng `****`; nếu `maskPhones` thì thay số điện thoại bằng `****`. Bỏ qua giá trị có `normalized` nằm trong `keepContacts`.
   - **Link:**
     - `Target="mailto:<email bị che>"` trong mọi `.rels` → `mailto:masked@anonymized.invalid`.
     - `Target="tel:<số bị che>"` → `tel:****`.
     - Field code `HYPERLINK "mailto:…"` trong `w:instrText` và `w:fldSimple/@w:instr` → che tương tự.
   - **Metadata:** giá trị trùng `values` của pháp nhân/người đại diện trong `docProps/core.xml`, `app.xml`, `custom.xml` → thay bằng `label`.
   - Không đổi hành vi hiện có (mention, revision author, `people.xml`…). Thứ tự: chạy phần ẩn danh người tham gia hiện tại trước, rồi mới chạy bộ thay chữ.
   - `AnonymizeReport` thêm `replacements: { entities: number; emails: number; phones: number }` (chỉ đếm, không chứa giá trị).
6. **Residual** (`residual.ts`): `scanResidual` nhận thêm `extraTargets: string[]` (mọi `values` của entity + email/số điện thoại đã chọn che, dạng gốc và `normalized`). Còn sót trong chữ → `WARN`; còn sót trong metadata hoặc `.rels` → `FAIL` (như hiện tại).
7. **Kiểm tra cấu hình** (`mapping.ts`): `validateEntities(entities, mapping)`:
   - `label` không rỗng, không trùng nhau, không trùng nhãn người tham gia.
   - Mỗi `value` dài ≥ 2 ký tự sau trim.
   - Một `value` không thuộc 2 entity khác nhau.
   - Lỗi trả message tiếng Việt.

### Tiêu chí phần A (test trong `src/word-anonymizer/__tests__/`, dữ liệu giả)
- A1: "Công ty TNHH Mẫu Thử" bị Word tách thành 3 run (`Công ty ` / `TNHH Mẫu` / ` Thử`, run giữa in đậm) → kết quả `Pháp nhân A`; số `w:r` và `w:rPr` của các run ngoài đoạn khớp không đổi.
- A2: Khớp không phân biệt hoa thường: `CÔNG TY TNHH MẪU THỬ` → thay. `Cong ty TNHH Mau Thu` (không dấu) → **không** thay. Residual vẫn báo `WARN` nếu chuỗi không dấu có trong `extraTargets`.
- A3: Entity `Mẫu Thử` không thay bên trong `Mẫu Thửnghiệm`. Có cả `Công ty TNHH Mẫu Thử` và `Mẫu Thử` → chuỗi dài được thay trọn, không bị thay 2 lần.
- A4: Tên người đại diện `Người Đại Diện Test 01` nằm ở header, footnote, text box, bình luận, và `w:delText` → tất cả được thay; residual `PASS`.
- A5: Email `lienhe.test@example.com` trong thân văn bản, trong rels `mailto:` và trong field code `HYPERLINK "mailto:..."` → đều bị che; residual `PASS`. Địa chỉ `nguoi-gop-y-1@anonymized.invalid` không bị đụng.
- A6: Số điện thoại **được che**: `0912345678`, `0912 345 678`, `091.234.5678`, `+84 912 345 678`, `(024) 3123 4567`, `02431234567`. **Không che**: `1.000.000.000`, `19.11.2026`, `0101234567-001`, `12345678901234`, `A0912345678B`.
- A7: `keepContacts` chứa `0912345678` → mọi cách viết của số đó (cùng `normalized`) được giữ nguyên; các số khác vẫn bị che.
- A8: `maskEmails=false` / `maskPhones=false` → không che loại tương ứng. Không có entity nào và tắt cả 2 → output giống hệt hành vi trước W-5 (so với test cũ).
- A9: `validateEntities` báo lỗi cho: nhãn trùng với `Người góp ý 1`, `value` 1 ký tự, cùng `value` ở 2 entity.
- A10: Chạy lần 2 trên file đã xử lý → không đổi thêm. `report.replacements` có số đếm, không chứa giá trị gốc.
- A11: Toàn bộ test cũ (W-1, F-2, F-4, W-2, F-5…) vẫn pass.

---

## Phần B — UI (`src/word-anonymizer/WordAnonymizerPage.tsx`) · commit `W-5b`

### Logic cần đạt
1. **Thẻ mới "Pháp nhân & người đại diện"**, đặt sau 2 bảng người tham gia, trước "Tùy chọn ẩn danh":
   - Hai nhóm: **Pháp nhân** (nhãn mặc định `Pháp nhân A`, `Pháp nhân B`…) và **Người đại diện** (`Người đại diện 1`, `2`…).
   - Mỗi dòng gồm: ô **Tên gốc** (textarea, mỗi dòng một cách viết), ô **Nhãn thay thế** (sửa được), nút xoá dòng. Nút "+ Thêm pháp nhân" / "+ Thêm người đại diện".
   - Hiện lỗi từ `validateEntities` ngay cạnh dòng tương ứng; có lỗi thì khoá nút "Ẩn danh tài liệu".
   - Ghi chú dưới thẻ: *"Công cụ chỉ thay đúng các tên bạn nhập (không phân biệt hoa/thường, giữ dấu). Hãy nhập đủ các cách viết, ví dụ tên viết tắt, tên tiếng Anh."*
2. **Thẻ mới "Email & số điện thoại"**:
   - 2 công tắc `maskEmails`, `maskPhones` (mặc định bật).
   - Danh sách email và số điện thoại phát hiện được (từ `inspection.contacts`), mỗi mục có số lần xuất hiện và **checkbox "Che"** (mặc định chọn). Bỏ chọn → thêm `normalized` vào `keepContacts`.
   - Không phát hiện mục nào → hiện "Không tìm thấy email hoặc số điện thoại".
3. Mọi thay đổi ở 2 thẻ trên gọi `resetStaleResults()` (giống các tuỳ chọn hiện có).
4. **Kết quả:** khối kết quả hiện thêm dòng "Đã thay N tên pháp nhân/người đại diện, che N email, N số điện thoại" từ `report.replacements`.
5. **File mapping JSON** (khi người dùng bật): thêm mục `entities` (nhãn ↔ tên gốc). Giữ nguyên cảnh báo hiện có.
6. **Log** `word_anonymizer.completed` thêm 3 số: `entityReplacements`, `emailsMasked`, `phonesMasked`. Không ghi tên hay giá trị.
7. "Xoá khỏi bộ nhớ" xoá luôn danh sách entity và lựa chọn giữ/che.
8. Dòng nhắc cố định đổi thành: *"Kiểm tra lại nội dung trước khi upload — công cụ chỉ thay các tên bạn khai báo và email/số điện thoại nhận diện được; các thông tin định danh khác (CCCD, mã số thuế, địa chỉ…) cần tự kiểm tra."* Giữ link "Xem hướng dẫn" của W-4.

### Tiêu chí phần B
- B1: Upload fixture giả có pháp nhân + người đại diện + 2 email + 3 số điện thoại → thẻ "Email & số điện thoại" liệt kê đủ 5 mục với số lần đúng. Thêm 1 pháp nhân (2 cách viết) và 1 người đại diện → chạy → file tải về chứa nhãn, không còn tên gốc, email, số điện thoại; residual `PASS`.
- B2: Bỏ chọn 1 số điện thoại → chạy → số đó còn nguyên trong file, các số khác bị che.
- B3: Nhập nhãn trùng `Người góp ý 1` → hiện lỗi, nút chạy bị khoá. Sửa entity sau khi đã chạy → kết quả cũ bị xoá, hiện dòng nhắc chạy lại.
- B4: Log `word_anonymizer.completed` có `entityReplacements`, `emailsMasked`, `phonesMasked` và **không** chứa chuỗi tên/email/số nào từ fixture. `localStorage` / `sessionStorage` không chứa tên entity.
- B5: 390/768/1280px: 2 thẻ mới không tràn khung, trang không cuộn ngang. Đính kèm 3 ảnh chụp.
- B6: `npm run lint`, `npm test`, `npm run build` xanh.

---

## Ràng buộc
- Phần A chỉ sửa/tạo trong `src/word-anonymizer/core/` và `src/word-anonymizer/__tests__/`.
- Phần B chỉ sửa: `src/word-anonymizer/WordAnonymizerPage.tsx`, `src/word-anonymizer/word-anonymizer.css`, `src/word-anonymizer/__tests__/WordAnonymizerPage.test.tsx`.
- Không sửa `server/`, `public/huong-dan/`, `src/App.tsx`. Không thêm dependency.
- Fixture dựng bằng JSZip trong test, dữ liệu rõ ràng là giả: `Công ty TNHH Mẫu Thử`, `Người Đại Diện Test 01`, `@example.com`, số điện thoại mẫu như trên. Không commit file Word thật.
- Lint/test/build xanh **sau từng commit**.

## Chứng minh + commit + push (PowerShell)
Sau phần A, rồi sau phần B:
```powershell
npm run lint; npm test; npm run build
git add src/word-anonymizer
git commit -m "<message của phần tương ứng>"
```
Sau khi xong cả 2 phần:
```powershell
git log --oneline -3
git diff --stat main...HEAD
Select-String -Path src/word-anonymizer/WordAnonymizerPage.tsx -Pattern "localStorage|sessionStorage"
git push -u origin feat/w5-entities-contact-masking
```
Kỳ vọng:
- `git log` có đúng 2 commit `W-5a`, `W-5b` trên `main`.
- `git diff --stat` chỉ có file trong Ràng buộc.
- Select-String không có kết quả.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w5-entities-contact-masking
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w5-entities-contact-masking
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Output Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md`, thêm:
- Bảng `Phần | K | tên test | pass` (A1–A11, B1–B6).
- Danh sách mẫu số điện thoại đã hỗ trợ và các `TODO(verify)`.
- 3 ảnh chụp ở 390/768/1280px.
