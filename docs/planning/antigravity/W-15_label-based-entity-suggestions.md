# [W-15] Ẩn danh Word: tự gợi ý pháp nhân, người đại diện, chức vụ, số giấy uỷ quyền từ các nhãn trong hợp đồng; người dùng duyệt rồi mới thêm

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Bối cảnh: `docs/word-anonymizer/01-PLAN.md` (mục 8, quyết định Q-W2).
Tiền điều kiện: **W-13 và W-14 đã merge vào `main`** (gợi ý đọc cả chữ đã xoá; gợi ý loại "từ khoá" thêm vào danh sách của W-14).
Nhánh: `feat/w15-label-entity-suggestions` (tạo từ `main`) · Commit: `feat(W-15): suggest entities and keywords from contract field labels for user review`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Kiểm thêm:
```powershell
git log --oneline -30 origin/main | Select-String "W-13","W-14"
```
Phải thấy **cả hai**. Thiếu → **DỪNG**, báo lại. Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w15-label-entity-suggestions
npm ci
```
Lệnh an toàn:
- Không dùng `npx` với package ngoài `package.json`.
- Không chạy dev server, không mở trình duyệt, không chụp màn hình.
- Lệnh chạy lâu phải có giới hạn thời gian (mẫu ở cuối file).

## Vấn đề
1. Hợp đồng PACE có khối thông tin các bên theo mẫu cố định (ảnh người dùng gửi, đã thay bằng dữ liệu giả):
   ```
   BÊN A:      KHÁCH HÀNG CÔNG TY TNHH MẪU THỬ
   Đại diện:   Bà NGƯỜI ĐẠI DIỆN TEST 01        Chức vụ: Giám đốc
   Địa chỉ:    Số 1 Đường Test, Phường Mẫu, Hà Nội
   Điện thoại: 024 0000 0000
   Mã số thuế: 0101234567
   BÊN B:      VIỆN ĐÀO TẠO MẪU THỬ
   Đại diện:   Ông NGƯỜI ĐẠI DIỆN TEST 02       Chức vụ: Giám đốc điều hành
               (Theo Giấy Ủy Quyền số 01/2026/UQ-TEST ngày 05/01/2026)
   ```
   Khối này thường nằm trong bảng hoặc dùng tab, và hay nằm trong chữ đã xoá (Track Changes).
2. Địa chỉ / Điện thoại / MST đã được tự che (`core/sensitive.ts`, W-5, F-10).
3. **Tên pháp nhân và người đại diện** người dùng phải **tự gõ** vào thẻ "Pháp nhân & người đại diện" (`WordAnonymizerPage.tsx`, `handleAddEntity` `:320-334`). Dễ sót. Chức vụ và số giấy uỷ quyền thì không có cách nào ngoài từ khoá (W-14).
4. **Quyết định chủ dự án (Q-W2, 2026-11-21):** tự gợi ý theo nhãn, **người dùng duyệt** (bỏ chọn được) rồi mới thêm. **Không** tự thay khi chưa duyệt.

## Logic cần đạt
1. **Hàm thuần** `src/word-anonymizer/core/entitySuggest.ts`:
   ```ts
   suggestFromLabels(paragraphs: { text: string; source: 'body' | 'deleted' }[]):
     { kind: 'organization' | 'representative' | 'keyword';
       value: string;
       hint: 'party' | 'representative' | 'position' | 'authorization' | 'contractNo';
       count: number;
       sources: ('body' | 'deleted')[] }[]
   ```
2. **Quy tắc nhận nhãn** (không phân biệt hoa thường, có/không dấu):
   - Nhãn phải đứng **đầu đoạn** (sau khoảng trắng hoặc số thứ tự như `1.`, `a)`), **hoặc** đứng sau một ký tự tab.
   - Nhãn phải có `:` hoặc tab theo sau.
   - Câu thường như "Bên A có trách nhiệm thanh toán" → **không** nhận.
3. **Các loại nhãn và cách lấy giá trị:**
   - **Bên** (`hint: 'party'`, `kind: 'organization'`):
     - nhãn: `Bên A|B|C|D`, `Bên mua`, `Bên bán`, `Bên thuê`, `Bên cho thuê`, `Bên giao`, `Bên nhận`, `Bên cung cấp`, `Bên sử dụng`;
     - giá trị: phần còn lại của đoạn;
     - nếu giá trị chứa một trong các từ `CÔNG TY`, `TỔNG CÔNG TY`, `TẬP ĐOÀN`, `VIỆN`, `TRUNG TÂM`, `NGÂN HÀNG`, `TRƯỜNG`, `HỢP TÁC XÃ`, `CHI NHÁNH`, `VĂN PHÒNG`, `HỘ KINH DOANH` → cắt bỏ phần đứng trước từ đó (ví dụ "KHÁCH HÀNG CÔNG TY…" → "CÔNG TY…").
   - **Đại diện** (`hint: 'representative'`, `kind: 'representative'`):
     - nhãn: `Đại diện`, `Người đại diện`, `Đại diện bởi`, `Đại diện theo pháp luật`;
     - giá trị: đến trước nhãn `Chức vụ` / tab tiếp theo / hết đoạn;
     - bỏ danh xưng đầu: `Ông`, `Bà`, `Ông/Bà`, `Mr`, `Mrs`, `Ms` (có hoặc không dấu chấm). Danh xưng giữ lại trong văn bản, chỉ phần tên bị thay.
   - **Chức vụ** (`hint: 'position'`, `kind: 'keyword'`): nhãn `Chức vụ`; giá trị đến tab tiếp theo / hết đoạn.
   - **Giấy uỷ quyền** (`hint: 'authorization'`, `kind: 'keyword'`): cụm `Giấy (ủy|uỷ) quyền số` (có/không dấu) **ở bất kỳ vị trí nào** trong đoạn; giá trị là **mã số** ngay sau, đến trước ` ngày`, `)`, `,` hoặc hết đoạn.
   - **Số hợp đồng** (`hint: 'contractNo'`, `kind: 'keyword'`): `Hợp đồng số` hoặc `Số hợp đồng:`; giá trị là mã số theo cùng quy tắc.
4. **Lọc kết quả:**
   - Cắt khoảng trắng/dấu câu ở hai đầu.
   - Bỏ giá trị < 3 ký tự, giá trị chỉ gồm `.` `…` `_` `-` (chỗ trống của mẫu hợp đồng).
   - Gộp trùng theo NFC + không phân biệt hoa thường; `count` = số lần xuất hiện.
5. **Nguồn đoạn văn:**
   - `inspect` dựng danh sách đoạn từ mọi `w:p` trong `word/document.xml` (kể cả trong bảng), header/footer;
   - mỗi đoạn tạo 2 bản: chữ hiện tại (`w:t`, `source: 'body'`) và chữ đã xoá (`w:delText`, `source: 'deleted'`) nếu có. Nối `w:tab` thành ký tự `\t`;
   - thêm `suggestions` vào `InspectionReport`.
6. **Giao diện** (`WordAnonymizerPage.tsx`), trong thẻ "Pháp nhân & người đại diện":
   - Khối "**Gợi ý từ nhãn trong tài liệu (N)**", chỉ hiện khi có gợi ý. Mỗi dòng gồm:
     - checkbox;
     - loại (Pháp nhân / Người đại diện / Chức vụ / Số giấy uỷ quyền / Số hợp đồng);
     - giá trị (font chữ thường, không monospace);
     - số lần;
     - nhãn nhỏ "trong chữ đã xoá" nếu chỉ có `source: 'deleted'`.
   - Mặc định **tick sẵn** mọi loại, **trừ** "Chức vụ".
   - Nút "**Thêm các mục đã chọn**":
     - Pháp nhân / Người đại diện → thêm `CustomEntity` mới với nhãn tự sinh theo `handleAddEntity` ("Pháp nhân A/B…", "Người đại diện 1/2…"), `values: [value]`. Nếu giá trị đã có trong entity nào thì bỏ qua;
     - Chức vụ / Số giấy uỷ quyền / Số hợp đồng → thêm `KeywordRule` (W-14) với `replace` lần lượt `[Chức vụ]`, `[Số giấy uỷ quyền]`, `[Số hợp đồng]`. Trùng `find` thì bỏ qua.
   - Sau khi thêm, các dòng đã thêm biến khỏi danh sách gợi ý. Có nút "Bỏ qua tất cả" để ẩn khối.
   - **Không** tự thêm, không tự thay khi người dùng chưa bấm.
7. **Activity log:** `suggestionCount`, `acceptedCount` (số). Không ghi giá trị.
8. **Hiệu năng:** tài liệu 2.000 đoạn → `suggestFromLabels` < 100 ms. Không dùng regex lồng có nguy cơ backtracking.
9. GIỮ NGUYÊN: phát hiện thông tin nhạy cảm, entity nhập tay, từ khoá W-14, chế độ chữ đã xoá W-13.

## Ràng buộc
- Chỉ được sửa/tạo:
  - `src/word-anonymizer/core/entitySuggest.ts` (mới), `inspect.ts`, `types.ts`, `index.ts`;
  - `src/word-anonymizer/WordAnonymizerPage.tsx`, `word-anonymizer.css`;
  - `src/word-anonymizer/__tests__/fixtures.ts` (chỉ thêm);
  - test mới `src/word-anonymizer/__tests__/w15-*.test.ts(x)`.
- KHÔNG sửa `anonymize.ts`, `textReplace.ts`, `residual.ts` (gợi ý chỉ là đầu vào cho cơ chế có sẵn), `src/pdf-editor/**`, test có sẵn.
- Không thêm dependency. Dữ liệu test giả như mục Vấn đề 1.

## Tiêu chí hoàn thành
- K1: với 8 dòng ở mục Vấn đề 1 (mỗi dòng 1 đoạn, nhãn và giá trị cách nhau bằng `\t`), `suggestFromLabels` trả **đúng**:
  - pháp nhân `CÔNG TY TNHH MẪU THỬ`, `VIỆN ĐÀO TẠO MẪU THỬ`;
  - người đại diện `NGƯỜI ĐẠI DIỆN TEST 01`, `NGƯỜI ĐẠI DIỆN TEST 02` (không có "Bà"/"Ông");
  - chức vụ `Giám đốc`, `Giám đốc điều hành`;
  - giấy uỷ quyền `01/2026/UQ-TEST`;
  - **không** gợi ý Địa chỉ / Điện thoại / MST.
- K2: "Bên A có trách nhiệm thanh toán", "Đại diện các bên thống nhất", "Bên A: ........" → không gợi ý.
- K3: không dấu ("BEN A:", "Dai dien:", "Giay uy quyen so 02/UQ-TEST") vẫn nhận.
- K4 (nguồn): cùng khối nằm trong `w:delText` → gợi ý có `sources: ['deleted']`. Có ở cả hai nguồn → `count` cộng dồn, `sources` có cả hai.
- K5: tên lặp 3 lần → 1 gợi ý, `count = 3`.
- K6 (giao diện, jsdom, fixture docx K1):
  - hiện 7 gợi ý, "Chức vụ" không tick;
  - bấm "Thêm các mục đã chọn" → 2 pháp nhân ("Pháp nhân A", "Pháp nhân B"), 2 người đại diện, 1 từ khoá `[Số giấy uỷ quyền]`;
  - chạy ẩn danh → file kết quả không còn tên pháp nhân / người đại diện / mã giấy uỷ quyền;
  - residual `PASS`.
- K7 (hiệu năng): 2.000 đoạn → < 100 ms (trung vị 3 lần, có làm nóng).
- K8: `npm run lint`, `npm run build` xanh. `vitest run` kết thúc, mọi test cũ pass.
- K9 (Claude kiểm tra khi QA): file .docx giả theo mẫu hợp đồng (bảng + tab + Track Changes) → gợi ý đúng, duyệt → thêm → chạy → file sạch.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
git status --porcelain
Select-String -Path src/word-anonymizer/core/entitySuggest.ts -Pattern "export function suggestFromLabels"
npm run lint; npm run build
$p = Start-Process npx -ArgumentList 'vitest','run' -NoNewWindow -PassThru
if (-not $p.WaitForExit(300000)) { Stop-Process -Id $p.Id -Force; Write-Output 'TIMEOUT' }
git add src/word-anonymizer
git commit -m "feat(W-15): suggest entities and keywords from contract field labels for user review"
git push -u origin feat/w15-label-entity-suggestions
```
Kỳ vọng:
- `git diff --stat`: chỉ file trong Ràng buộc (không có `anonymize.ts`, `textReplace.ts`, `residual.ts`).
- Select-String: có kết quả.
- lint/build xanh; vitest kết thúc, không `TIMEOUT`.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin feat/w15-label-entity-suggestions
git rev-parse --short HEAD
git log --oneline -1 origin/feat/w15-label-entity-suggestions
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Ở đầu báo cáo: output Bước A, output `git push`, output Bước Z. Sau đó theo `00_RULES.md`, cộng thêm:
- bảng `K | tên test | pass`;
- danh sách nhãn đã hỗ trợ;
- cách cắt giá trị;
- danh sách `TODO(verify)`.
