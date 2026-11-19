# [W-5] Ẩn danh Word: thay tên pháp nhân / người đại diện do người dùng nhập, che một phần email, số điện thoại, CCCD, MST, số tài khoản, địa chỉ

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: **W-4 đã merge** vào `main` (cùng sửa `WordAnonymizerPage.tsx`). Không phụ thuộc F-9 (F-9 chỉ sửa `server/`).
Nhánh: `feat/w5-entities-sensitive-masking` (tạo từ `main`) · **2 commit theo thứ tự** (quyết định của chủ dự án: gộp core + UI vào một task, mỗi phần một commit):
1. `feat(W-5a): core text replacement for custom entities and partial masking of sensitive data`
2. `feat(W-5b): UI for entity fields and detected sensitive data`

Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push, KHÔNG gộp 2 phần vào 1 commit.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w5-entities-sensitive-masking
npm ci
```

## Vấn đề
- Hiện công cụ chỉ ẩn danh **người bình luận / người sửa / người được @nhắc** và metadata. Trong thân văn bản (hợp đồng, đề xuất, biên bản), các thông tin sau vẫn giữ nguyên, người dùng phải tự sửa tay trước khi đưa lên AI:
  - tên công ty (pháp nhân), tên người đại diện;
  - email, số điện thoại;
  - CCCD/CMND, mã số thuế, số tài khoản, địa chỉ.
- `src/word-anonymizer/core/types.ts:54-60` (`AnonymizeOptions`) chỉ có 5 tuỳ chọn.
- Chỉ `replaceNamesInCommentText` thay chuỗi, và chỉ trong `comments.xml`, theo từng `w:t` riêng lẻ (`core/anonymize.ts`). Tên bị Word tách thành nhiều run (do định dạng hoặc kiểm tra chính tả) sẽ không được thay.
- `core/residual.ts:34-38`: chỉ quét tên/email/userId của người tham gia.
- Trang hướng dẫn (`public/huong-dan/`) đang ghi thân văn bản **không** được ẩn danh. Task này **không** sửa trang hướng dẫn; Claude sẽ cập nhật sau QA.

## Quyết định của chủ dự án
- **Q-W5a — nhập tay, không dùng AI:** pháp nhân và người đại diện do **người dùng nhập**. Không tự nhận diện bằng AI/NER; công cụ chỉ thay đúng những gì được khai báo.
- **Q-W5b — che một phần để dễ đối chiếu:** email, số điện thoại, CCCD/CMND, mã số thuế, số tài khoản, địa chỉ được **tự phát hiện** và **che một phần** theo bảng ở Phần A mục 3. Người dùng xem danh sách và bỏ chọn được từng mục để giữ nguyên.
- **Q-W5c — không đụng chữ đã xoá:** **không** sửa chữ đã xoá trong Track Changes (`w:delText`), cho cả pháp nhân/người đại diện lẫn dữ liệu nhạy cảm. Thay vào đó, **cảnh báo** người dùng nếu phần chữ đã xoá có chứa các thông tin này (xem Phần A mục 6).
- **Q-W5d — không lưu, không log:** danh sách pháp nhân/người đại diện và danh sách dữ liệu phát hiện được là **dữ liệu nhạy cảm**. Chỉ giữ trong bộ nhớ trang; không `localStorage`/`sessionStorage`, không ghi log, không gửi lên server.

---

## Phần A — Core (`src/word-anonymizer/core/`) · commit `W-5a`

### Logic cần đạt

1. **Kiểu dữ liệu** (`types.ts`):
   - `EntityKind = 'organization' | 'representative'`.
   - `CustomEntity { id: string; kind: EntityKind; label: string; values: string[] }`. `values` là các cách viết của cùng một đối tượng, vd. `["Công ty TNHH Mẫu Thử", "Mẫu Thử Co., Ltd", "Cty Mẫu Thử"]`.
   - `SensitiveKind = 'email' | 'phone' | 'nationalId' | 'taxCode' | 'bankAccount' | 'address'`.
   - `AnonymizeOptions` thêm:
     - `customEntities: CustomEntity[]` (mặc định `[]`);
     - `maskKinds: Record<SensitiveKind, boolean>` (mặc định tất cả `true`);
     - `keepValues: string[]` (mặc định `[]`): các giá trị `normalized` người dùng chọn giữ.

2. **Phát hiện** (`sensitive.ts`, mới): `findSensitive(text)` trả về danh sách `{ kind, value, normalized, start, end }`.
   - Phát hiện trên **chuỗi ghép của cả đoạn** (xem mục 4), không trên từng `w:t`.
   - Chỗ nào đánh dấu "từ khoá": số chỉ được nhận là loại đó khi trong **cùng đoạn**, **trước** số, cách tối đa **40 ký tự**, có từ khoá tương ứng (không phân biệt hoa thường, có và không dấu). Dùng từ khoá để tránh che nhầm số tiền, mã hợp đồng.
   - Một vị trí khớp nhiều loại → ưu tiên theo thứ tự: `nationalId`, `taxCode`, `bankAccount` (loại có từ khoá) rồi mới đến `phone`.
   - Mọi mẫu đánh dấu `TODO(verify)` và liệt kê trong báo cáo.

3. **Bảng phát hiện và cách che** (dùng `*`):

   | Loại | Cách phát hiện | Ví dụ gốc | Sau khi che |
   |---|---|---|---|
   | `email` | Mẫu email thông thường. **Bỏ qua** `@anonymized.invalid` (do công cụ sinh cho mention) | `lienhe.test@example.com` | `l****@e****.com`: giữ ký tự đầu phần trước `@`, ký tự đầu tên miền và nhãn cuối (`.com`, `.vn`) |
   | `phone` | **Di động:** `0`/`+84`/`84` + 9 chữ số bắt đầu `3\|5\|7\|8\|9`. **Cố định:** `0`/`+84`/`84` + 10 chữ số bắt đầu `2`. Giữa các nhóm số cho phép **một** ký tự cách (dấu cách, `.`, `-`), cho phép ngoặc quanh mã vùng. Không dính liền chữ/số ở hai đầu | `+84 912 345 678` | `09******78`: đưa về dạng `0…`, giữ 2 chữ số đầu và 2 cuối, ký tự giữa thành `*` |
   | `nationalId` | 12 chữ số (CCCD) hoặc 9 chữ số (CMND), **có từ khoá**: `CCCD`, `CMND`, `căn cước`, `chứng minh`, `số định danh`, `ID card` | `CCCD số: 001234567890` | `CCCD số: *********890` (giữ 3 chữ số cuối) |
   | `taxCode` | 10 chữ số, hoặc 10 chữ số + `-` + 3 chữ số, **có từ khoá**: `MST`, `mã số thuế`, `mã số doanh nghiệp`, `tax code` | `MST: 0101234567-001` | `MST: *******567-001` (giữ 3 chữ số cuối của phần 10 số và hậu tố chi nhánh) |
   | `bankAccount` | 6–19 chữ số, có thể chia nhóm bằng dấu cách hoặc `-`, **có từ khoá**: `STK`, `số tài khoản`, `tài khoản số`, `account no`, `account number` | `STK: 1234 5678 9012` | `STK: ********9012` (giữ 4 chữ số cuối, bỏ dấu cách) |
   | `address` | Phần chữ **sau** nhãn `Địa chỉ`, `Trụ sở`, `Địa chỉ trụ sở`, `Địa chỉ thường trú`, `Nơi cư trú`, `Address` + dấu `:`, tới hết đoạn | `Địa chỉ: Số 1 Đường Test, Phường Mẫu, Quận Thử, Hà Nội` | `Địa chỉ: ****, ****, ****, Hà Nội` (tách theo dấu phẩy, giữ đoạn cuối — tỉnh/thành; chỉ một đoạn thì thành `****`) |

   **Không** được che: số tiền (`1.000.000.000`), ngày (`19.11.2026`), số hợp đồng không có từ khoá, chuỗi > 19 chữ số, `A0912345678B`.

4. **Bộ thay chữ theo đoạn** (`textReplace.ts`, mới) — phần quan trọng nhất:
   - Với mỗi `w:p`: ghép nội dung các node `w:t` (theo thứ tự trong tài liệu) thành một chuỗi; tìm các vị trí cần thay (entity + dữ liệu nhạy cảm); rồi **ánh xạ ngược** vào từng node.
   - Chuỗi thay thế đặt vào node chứa ký tự đầu của đoạn khớp; phần còn lại của đoạn khớp bị xoá khỏi các node sau.
   - Không đụng tới node không liên quan; không đổi định dạng (`w:rPr`); giữ `xml:space="preserve"` khi node có khoảng trắng ở đầu/cuối.
   - **Không** đưa `w:delText` vào chuỗi ghép và không sửa nó (Q-W5c).
   - Entity: khớp **không phân biệt hoa thường** sau chuẩn hoá NFC, **giữ dấu** ("Nguyễn" ≠ "Nguyen"), **nguyên từ** (ranh giới là ký tự ngoài `\p{L}\p{N}`), ưu tiên **chuỗi dài nhất** khi chồng nhau.
   - Entity được thay **trước** dữ liệu nhạy cảm. Một vị trí đã thay thì không xử lý lại.

5. **Áp dụng** (`anonymize.ts`):
   - Với `word/document.xml`, header, footer, footnote, endnote, `comments.xml`, và text box trong các part đó: thay entity bằng `label`; che dữ liệu nhạy cảm có `maskKinds[kind] === true` và `normalized` không nằm trong `keepValues`.
   - **Link:**
     - `Target="mailto:<email bị che>"` trong mọi `.rels` → `mailto:masked@anonymized.invalid`.
     - `Target="tel:<số bị che>"` → `tel:` + dạng đã che.
     - Field code `HYPERLINK "mailto:…"` trong `w:instrText` và `w:fldSimple/@w:instr` → che tương tự.
   - **Metadata:** giá trị trùng `values` của entity trong `docProps/core.xml`, `app.xml`, `custom.xml` → thay bằng `label`.
   - Không đổi hành vi hiện có (mention, revision author, `people.xml`…). Thứ tự: chạy phần ẩn danh người tham gia hiện tại trước, rồi mới chạy bộ thay chữ.
   - `AnonymizeReport` thêm `replacements: { entities: number; byKind: Record<SensitiveKind, number> }` (chỉ đếm, không chứa giá trị).

6. **Kiểm tra file và cảnh báo chữ đã xoá** (`inspect.ts`):
   - `InspectionReport` thêm `sensitive: { kind, value, normalized, count }[]`, quét phần chữ ở mục 5 và `Target` `mailto:`/`tel:` trong mọi `.rels`.
   - Thêm `deletedTextHits: { kind: SensitiveKind | 'entity', count }[]` khi quét riêng `w:delText`. Hàm có nhận danh sách entity, hoặc thêm hàm `inspectDeletedText(input, entities)` để gọi lại khi entity thay đổi.
   - Có kết quả → `warnings` thêm: *"Tài liệu có chữ đã xoá trong Track Changes chứa thông tin cần che. Công cụ không xử lý phần này — hãy Accept/Reject All Changes trong Word trước khi upload."*

7. **Residual** (`residual.ts`):
   - `scanResidual` nhận thêm `extraTargets: string[]`: mọi `values` entity + giá trị gốc của dữ liệu nhạy cảm đã chọn che.
   - Còn sót trong chữ → `WARN`; còn sót trong metadata hoặc `.rels` → `FAIL` (như hiện tại).
   - Còn sót **chỉ** trong `w:delText` → category mới `deleted-text`, mức `WARN` (không `FAIL`).
   - Cập nhật kiểu `ResidualCategory`.

8. **Kiểm tra cấu hình** (`mapping.ts`): `validateEntities(entities, mapping)`:
   - `label` không rỗng, không trùng nhau, không trùng nhãn người tham gia.
   - Mỗi `value` dài ≥ 2 ký tự sau trim.
   - Một `value` không thuộc 2 entity khác nhau.
   - Lỗi trả message tiếng Việt.

### Tiêu chí phần A (test trong `src/word-anonymizer/__tests__/`, dữ liệu giả)
- A1: "Công ty TNHH Mẫu Thử" bị tách thành 3 run (`Công ty ` / `TNHH Mẫu` / ` Thử`, run giữa in đậm) → kết quả `Pháp nhân A`; số `w:r` và `w:rPr` của các run ngoài đoạn khớp không đổi.
- A2: `CÔNG TY TNHH MẪU THỬ` → thay. `Cong ty TNHH Mau Thu` (không dấu) → **không** thay.
- A3: Entity `Mẫu Thử` không thay bên trong `Mẫu Thửnghiệm`. Có cả `Công ty TNHH Mẫu Thử` và `Mẫu Thử` → chuỗi dài được thay trọn, không bị thay 2 lần.
- A4: `Người Đại Diện Test 01` nằm ở header, footnote, text box, bình luận → đều được thay. Cùng tên nằm trong `w:delText` → **giữ nguyên**, `warnings` có cảnh báo chữ đã xoá, residual `WARN` với category `deleted-text`.
- A5: Email `lienhe.test@example.com` trong thân văn bản, trong rels `mailto:` và trong field `HYPERLINK "mailto:..."` → thân văn bản thành `l****@e****.com`, link thành `mailto:masked@anonymized.invalid`; residual `PASS`. `nguoi-gop-y-1@anonymized.invalid` không bị đụng.
- A6: Số điện thoại **được che** thành dạng `0X******YY`: `0912345678`, `0912 345 678`, `091.234.5678`, `+84 912 345 678`, `(024) 3123 4567`, `02431234567`. **Không che**: `1.000.000.000`, `19.11.2026`, `12345678901234567890`, `A0912345678B`.
- A7: `CCCD số: 001234567890` → `*********890`. `Số định danh cá nhân 001234567890` → che. Chuỗi `001234567890` **không** có từ khoá trong 40 ký tự trước → **không** che.
- A8: `MST: 0101234567-001` → `*******567-001`. `Mã số thuế 0101234567` → `*******567`. `0101234567-001` không có từ khoá → không che, và **không** bị nhận nhầm là số điện thoại.
- A9: `Số tài khoản: 1234 5678 9012` → `********9012`. `STK 0912345678` → nhận là `bankAccount` (có từ khoá), không phải `phone`.
- A10: `Địa chỉ: Số 1 Đường Test, Phường Mẫu, Quận Thử, Hà Nội` → `Địa chỉ: ****, ****, ****, Hà Nội`. `Trụ sở: Tòa nhà Test` → `Trụ sở: ****`. Đoạn không có nhãn địa chỉ → không đụng.
- A11: `keepValues` chứa normalized của `0912345678` → mọi cách viết của số đó được giữ nguyên; số khác vẫn bị che. `maskKinds.address=false` → địa chỉ giữ nguyên.
- A12: Không entity và mọi `maskKinds` = `false` → output giống hệt hành vi trước W-5 (so với test cũ).
- A13: `validateEntities` báo lỗi cho: nhãn trùng `Người góp ý 1`, `value` 1 ký tự, cùng `value` ở 2 entity.
- A14: Chạy lần 2 trên file đã xử lý → không đổi thêm (giá trị đã che không bị nhận diện lại). `report.replacements` chỉ có số đếm.
- A15: Toàn bộ test cũ (W-1, F-2, F-4, W-2, F-5…) vẫn pass.

---

## Phần B — UI (`src/word-anonymizer/WordAnonymizerPage.tsx`) · commit `W-5b`

### Logic cần đạt
1. **Thẻ mới "Pháp nhân & người đại diện"**, đặt sau 2 bảng người tham gia, trước "Tùy chọn ẩn danh":
   - Hai nhóm: **Pháp nhân** (nhãn mặc định `Pháp nhân A`, `Pháp nhân B`…) và **Người đại diện** (`Người đại diện 1`, `2`…).
   - Mỗi dòng: ô **Tên gốc** (textarea, mỗi dòng một cách viết), ô **Nhãn thay thế** (sửa được), nút xoá dòng. Nút "+ Thêm pháp nhân" / "+ Thêm người đại diện".
   - Lỗi từ `validateEntities` hiện ngay cạnh dòng; có lỗi thì khoá nút "Ẩn danh tài liệu".
   - Ghi chú: *"Công cụ chỉ thay đúng các tên bạn nhập (không phân biệt hoa/thường, giữ dấu). Hãy nhập đủ các cách viết: tên viết tắt, tên tiếng Anh…"*
2. **Thẻ mới "Thông tin nhạy cảm phát hiện được"**:
   - 6 công tắc theo loại (Email, Số điện thoại, CCCD/CMND, Mã số thuế, Số tài khoản, Địa chỉ), mặc định bật.
   - Danh sách nhóm theo loại. Mỗi mục hiện: giá trị gốc, **dạng sau khi che** (xem trước), số lần xuất hiện, checkbox **"Che"** (mặc định chọn). Bỏ chọn → thêm `normalized` vào `keepValues`.
   - Ghi chú: *"Danh sách được nhận diện theo mẫu, có thể sót hoặc nhận nhầm. Hãy xem lại trước khi chạy."*
   - Không phát hiện gì → "Không tìm thấy thông tin nhạy cảm theo mẫu".
3. **Cảnh báo chữ đã xoá:** khi `deletedTextHits` có kết quả (tính lại khi danh sách entity thay đổi), hiện cảnh báo vàng của mục A.6 ngay trên nút chạy.
4. Mọi thay đổi ở 2 thẻ mới gọi `resetStaleResults()` (giống các tuỳ chọn hiện có).
5. **Kết quả:** hiện thêm dòng "Đã thay N tên pháp nhân/người đại diện; che N email, N số điện thoại, N CCCD/CMND, N MST, N số tài khoản, N địa chỉ" từ `report.replacements`.
6. **File mapping JSON** (khi người dùng bật): thêm `entities` (nhãn ↔ tên gốc) và `masked` (dạng che ↔ giá trị gốc). Giữ nguyên cảnh báo hiện có.
7. **Log** `word_anonymizer.completed` thêm `entityReplacements` và 6 số đếm theo loại. Không ghi tên hay giá trị.
8. "Xoá khỏi bộ nhớ" xoá luôn entity, danh sách phát hiện, lựa chọn giữ/che.
9. Dòng nhắc cố định đổi thành: *"Kiểm tra lại nội dung trước khi upload — công cụ chỉ thay các tên bạn khai báo và thông tin nhạy cảm nhận diện được theo mẫu; chữ đã xoá trong Track Changes không được xử lý."* Giữ link "Xem hướng dẫn" của W-4.

### Tiêu chí phần B
- B1: Upload fixture giả (pháp nhân, người đại diện, 2 email, 3 số điện thoại, 1 CCCD, 1 MST, 1 STK, 1 địa chỉ) → thẻ phát hiện liệt kê đủ, đúng loại, đúng số lần, hiện đúng dạng sau khi che. Thêm 1 pháp nhân (2 cách viết) và 1 người đại diện → chạy → file tải về đúng như bảng Phần A mục 3; residual `PASS`.
- B2: Bỏ chọn 1 số điện thoại và tắt loại "Địa chỉ" → chạy → số đó và địa chỉ còn nguyên, phần còn lại bị che.
- B3: Fixture có chữ đã xoá chứa email → hiện cảnh báo chữ đã xoá; chạy xong residual `WARN` (category `deleted-text`), nút tải **không** bị khoá.
- B4: Nhãn trùng `Người góp ý 1` → hiện lỗi, nút chạy bị khoá. Sửa entity sau khi đã chạy → kết quả cũ bị xoá, hiện dòng nhắc chạy lại.
- B5: Log `word_anonymizer.completed` chỉ có số đếm, **không** chứa chuỗi tên/email/số nào từ fixture. `localStorage` / `sessionStorage` không chứa tên entity hay giá trị phát hiện.
- B6: 390/768/1280px: 2 thẻ mới không tràn khung, trang không cuộn ngang. Đính kèm 3 ảnh chụp.
- B7: `npm run lint`, `npm test`, `npm run build` xanh.

---

## Ràng buộc
- Phần A chỉ sửa/tạo trong `src/word-anonymizer/core/` và `src/word-anonymizer/__tests__/`.
- Phần B chỉ sửa: `src/word-anonymizer/WordAnonymizerPage.tsx`, `src/word-anonymizer/word-anonymizer.css`, `src/word-anonymizer/__tests__/WordAnonymizerPage.test.tsx`.
- Không sửa `server/`, `public/huong-dan/`, `src/App.tsx`. Không thêm dependency.
- Fixture dựng bằng JSZip trong test, dữ liệu rõ ràng là giả: `Công ty TNHH Mẫu Thử`, `Người Đại Diện Test 01`, `@example.com`, CCCD/MST/STK/số điện thoại như ví dụ ở trên, địa chỉ `Số 1 Đường Test…`. Không commit file Word thật.
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
Select-String -Path src/word-anonymizer/core/*.ts -Pattern "delText"
git push -u origin feat/w5-entities-sensitive-masking
```
Kỳ vọng:
- `git log` có đúng 2 commit `W-5a`, `W-5b` trên `main`.
- `git diff --stat` chỉ có file trong Ràng buộc.
- Select-String `localStorage|sessionStorage` không có kết quả.
- Select-String `delText` chỉ xuất hiện ở phần **đọc/cảnh báo/residual**, không có chỗ ghi đè nội dung; giải thích từng dòng trong báo cáo.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w5-entities-sensitive-masking
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w5-entities-sensitive-masking
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Output Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md`, thêm:
- Bảng `Phần | K | tên test | pass` (A1–A15, B1–B7).
- Danh sách mẫu và từ khoá đã cài cho từng loại, kèm các `TODO(verify)`.
- 3 ảnh chụp ở 390/768/1280px.
