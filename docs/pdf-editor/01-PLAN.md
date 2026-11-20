# PDF Editor — Kế hoạch nâng cấp chỉnh sửa text & hình ảnh (mục tiêu: trải nghiệm gần Acrobat "Edit PDF")

Trạng thái: **bản nháp chờ chủ dự án duyệt** · Khảo sát trên `main` @ `947b062` · Người lập: Claude (planning/QA), người làm: Antigravity.

Quy ước trong tài liệu: **[DK]** = dữ kiện đã kiểm chứng trên code/chạy thử · **[GĐ]** = giả định · **[ĐX]** = đề xuất · **chưa xác minh** = cần spike/đọc tài liệu chính thức trước khi dựa vào.

---

## 1. Mục tiêu

Người dùng mở một PDF có sẵn (hoá đơn, hợp đồng, biểu mẫu) và:
1. Bấm vào **khối chữ có sẵn** → sửa trực tiếp như Word: nhiều dòng, tự xuống dòng, giữ font/cỡ/màu gần giống bản gốc, kéo di chuyển, kéo giãn khung.
2. Bấm vào **ảnh có sẵn** hoặc ảnh mới chèn → di chuyển, đổi kích thước bằng tay nắm, xoay, lật, thay ảnh, cắt, xoá.
3. File xuất ra **không còn nội dung cũ** ở những chỗ đã sửa/xoá (không chỉ bị che).
4. Thao tác mượt: khung bao (bounding box), tay nắm, phím mũi tên dịch chuyển, đường gióng, Undo/Redo đúng.

Ngoài phạm vi giai đoạn này: OCR nâng cao, chỉnh sửa vector/đường kẻ có sẵn, form field, ký số (đã có luồng riêng).

---

## 2. Hiện trạng (đọc code `src/App.tsx`, `src/types.ts`)

Toàn bộ PDF editor nằm trong `src/App.tsx` (878 dòng): component `PdfCanvas` (88–255) + state/handler trong `App` (257–876). Chưa có test nào cho PDF editor.

### 2.1 Cách "sửa chữ" đang chạy [DK]
- Nhận vùng chữ: `page.getTextContent()` (pdf.js) → gom fragment thành **dòng** (`App.tsx:143-172`). Không gom thành đoạn.
- Bấm vào dòng → `textarea` nổi lên (`:249`). Enter = lưu, không có nhiều dòng (`:244`).
- Lưu → tạo `Annotation` `type:'text', replaceOriginal:true` (`:564-575`).
- Xuất (`buildPdfBytes`, `:450-497`): **vẽ hình chữ nhật màu nền đè lên chữ cũ** (`:482-489`) rồi `drawText` chữ mới.

### 2.2 Vấn đề đã kiểm chứng

| # | Vấn đề | Bằng chứng | Hậu quả |
|---|---|---|---|
| B1 | **Chữ gốc vẫn nằm trong file xuất** | Chạy thử: PDF có `Customer: Hoc vien Test 01`, sửa thành `Customer: REDACTED` theo đúng cách `buildPdfBytes` → pdf.js trích ra **cả hai chuỗi** | Copy/tìm kiếm/AI đọc file vẫn thấy dữ liệu cũ. **Rủi ro lộ dữ liệu** khi người dùng tưởng đã sửa/xoá |
| B2 | Hình chữ nhật che đè đường kẻ, khung, nền màu | `:488` vẽ rect có padding; màu nền lấy mẫu "màu chiếm đa số" (`:206-227`) | Ô bảng/khung viền bị mất nét như hoá đơn trong ảnh chụp |
| B3 | Màu chữ luôn `#000000`; font chỉ đoán 3 họ Helvetica/Times/Courier | `:150`, `:155` | Chữ sửa khác màu/khác font bản gốc |
| B4 | Chữ có dấu tiếng Việt bị ép sang Noto Sans | `:456` | Lệch kiểu chữ so với văn bản xung quanh |
| B5 | Chữ dài hơn khung thì **thu nhỏ cỡ chữ** thay vì xuống dòng | `:478` | Chữ bé dần, không giống Acrobat (reflow) |
| B6 | Chỉ sửa được từng **dòng**, không có khối đoạn | `:159-172` | Sửa đoạn văn nhiều dòng phải sửa từng dòng |
| B7 | Chữ đã sửa / text box mới **không kéo di chuyển, không đổi kích thước** được; chỉ ảnh chèn mới kéo được | `:98-114`, `:250-251` | |
| B8 | Ảnh: chỉ phóng/thu ±10% bằng nút, không tay nắm, không xoay/lật/cắt/thay | `:394-403`, `:848` | |
| B9 | **Ảnh có sẵn trong PDF không chọn/sửa được** | Không có code nhận ảnh gốc | Khác biệt lớn nhất với Acrobat |
| B10 | Ảnh chèn tính chiều cao theo hệ số cố định `.77` (tỉ lệ trang Letter dọc) | `:512` | Méo ảnh trên trang ngang/A4 |
| B11 | Thêm chữ dùng `window.prompt` | `:197` | Trải nghiệm thô |
| B12 | Nút "Rotate view" không có `onClick` | `:858` | Nút chết |
| B13 | Thumbnail trang là hình giả, không render | `:836` | |
| B14 | Vùng chữ bỏ qua chữ xoay (chỉ dùng `tx[4]`, `tx[5]`) | `:146-154` | Khung sai vị trí với chữ xoay/trang xoay |
| B15 | Hiển thị một trang, không cuộn liên tục | `:862` | |

### 2.3 Thư viện hiện có [DK]
- `pdf-lib` 1.17.1 (MIT): tạo/ghi PDF, nhúng font/ảnh, đối tượng cấp thấp. **Không có bộ phân tích content stream** (chỉ có parser đối tượng: `PDFObjectParser`, `PDFParser`…). Muốn xoá/sửa chữ gốc phải tự viết tokenizer content stream.
- `pdfjs-dist` 6.1.200 (Apache-2.0): render, `getTextContent`, `getOperatorList` (có `OPS.paintImageXObject`), có `AnnotationEditorType` (bộ soạn **annotation** FreeText/Ink/Stamp — **không** sửa nội dung gốc).
- `@pdf-lib/fontkit` 1.1.1, font Be Vietnam Pro / Arimo / Noto Sans (subset tiếng Việt, woff).

---

## 3. So sánh với Acrobat "Edit PDF" (ảnh chụp chủ dự án gửi)

| Năng lực Acrobat | Hiện tại | Kế hoạch |
|---|---|---|
| Hiện khung bao mọi khối chữ/ảnh ("Show bounding boxes") | Chỉ viền vùng chữ khi hover | W-8 |
| Sửa khối đoạn nhiều dòng, tự reflow | Từng dòng, Enter = lưu | W-9 |
| Panel FORMAT: font, cỡ, màu, B/I/U, căn lề, giãn dòng, giãn chữ | Thanh định dạng cơ bản, chỉ cho text box mới | W-8 (panel), W-9 (áp cho chữ gốc) |
| Panel OBJECTS: lật, xoay, cắt, sắp lớp, thay ảnh | Không | W-10 |
| Di chuyển/đổi kích thước bằng tay nắm | Chỉ kéo ảnh chèn | W-8 |
| Sửa thật nội dung (xoá chữ/ảnh cũ khỏi file) | Che bằng hình chữ nhật (B1) | W-7 → W-9, W-10 |
| Thêm text, thêm ảnh, link, crop trang, header/footer, watermark | Thêm text (prompt), thêm ảnh | Thêm text: W-8. Còn lại: W-12 (tuỳ chọn) |

---

## 4. Lựa chọn kỹ thuật cho "sửa thật" (cần chủ dự án quyết — Q-P1)

| Phương án | Mô tả | Ưu | Nhược / rủi ro |
|---|---|---|---|
| **A. Tự viết engine content stream** trên `pdf-lib` [ĐX] | Tokenizer toán tử PDF; theo dõi trạng thái `q/Q`, `cm`, `BT/ET`, `Tm/Td/TD/T*`, `Tf`, `Tc/Tw/Tz/TL/Ts`; xoá toán tử vẽ chữ (`Tj/TJ/'/"`) trong vùng sửa; đổi ma trận `cm` trước `Do` để di chuyển/xoá ảnh | Không thêm dependency, giữ license MIT/Apache, xử lý tại trình duyệt, kiểm soát hoàn toàn | Khối lượng lớn; khó với chữ nằm trong Form XObject, font Type3, toán tử `TJ` chứa cả chữ cần giữ lẫn chữ cần xoá; cần bộ fixture tốt |
| B. MuPDF.js (Artifex, WebAssembly) | Có cơ chế redaction "áp dụng xoá vùng" | Xoá nội dung thật đã được kiểm nghiệm lâu năm | License **AGPL-3.0 hoặc thương mại** — cần pháp chế duyệt; bundle WASM lớn; API cụ thể **chưa xác minh** |
| C. SDK thương mại (Apryse WebViewer, Nutrient/PSPDFKit, Foxit…) | Có sẵn "content editing" gần Acrobat | Nhanh có tính năng đầy đủ | Chi phí license (chưa có báo giá), phụ thuộc nhà cung cấp, cần thẩm định bảo mật/dữ liệu |

**Đề xuất:** đi **A** nhưng chặn bằng **spike W-7** (2 nhánh việc nhỏ, đo trên fixture giả). Nếu spike cho thấy tỉ lệ xoá đúng thấp hoặc quá phức tạp → dừng, trình lại B/C kèm số liệu. Không đề xuất gửi PDF lên bất kỳ dịch vụ ngoài nào.

---

## 5. Kiến trúc đích [ĐX]

```
src/pdf-editor/
  PdfCanvas.tsx            render trang + lớp tương tác
  TextFormatBar.tsx        (tạm) → thay bằng PropertiesPanel ở W-8
  PropertiesPanel.tsx      FORMAT / OBJECTS như Acrobat (W-8)
  selection/               chọn, khung bao, 8 tay nắm, kéo/giãn/xoay, phím mũi tên, đường gióng (W-8)
  model.ts                 kiểu đối tượng: TextBlock, PageImage, Annotation; lịch sử (Undo/Redo)
  textExtraction.ts        gom fragment → dòng → khối đoạn; nhận font/cỡ/màu (W-6, W-9)
  imageExtraction.ts       nhận ảnh có sẵn từ operator list (W-10)
  engine/
    contentTokenizer.ts    đọc/ghi content stream (W-7)
    textRemoval.ts         xoá toán tử vẽ chữ trong vùng (W-7)
    imageTransform.ts      đổi/xoá ảnh gốc qua `cm … Do` (W-10)
  exportPdf.ts             dựng file xuất: engine sửa gốc + vẽ nội dung mới (W-6, W-9)
  pageOps.ts               chèn/xoá/di chuyển/xoay trang (W-6, W-11)
```

Nguyên tắc:
- Hàm xử lý PDF là **hàm thuần** (bytes vào → bytes ra), test được trên Node, tách khỏi React.
- Toạ độ lưu theo **đơn vị PDF (pt) của trang**, chỉ đổi sang pixel khi hiển thị (hiện đang lưu tỉ lệ 0–1 nên dễ sai khi trang xoay/khác cỡ).
- Fixture PDF **dựng bằng code** với dữ liệu giả (`Học viên Test 01`, `@example.com`); không commit PDF thật.
- Mỗi lần xuất, chạy **kiểm tra sót** (giống residual của Word Anonymizer): trích text file xuất, cảnh báo nếu chuỗi gốc của vùng đã sửa vẫn còn.

---

## 6. Lộ trình task (mỗi task = 1 nhánh = 1 commit, theo `docs/planning/antigravity/00_RULES.md`)

| ID | Nội dung | Phụ thuộc | Ghi chú |
|---|---|---|---|
| **W-6** | Tách PDF editor khỏi `App.tsx` thành module + test nền; **không đổi hành vi**; test "đặc tả" ghi nhận B1 | — | Prompt: `docs/planning/antigravity/W-6_pdf-editor-modularize.md` |
| **W-7** | Spike engine: tokenizer content stream + xoá chữ trong vùng trên fixture; báo cáo tỉ lệ đúng; **chưa nối UI** | W-6 | Cổng quyết định Q-P1 |
| **W-8** | Khung chọn & biến đổi đối tượng: bounding box, 8 tay nắm, kéo/giãn, Shift giữ tỉ lệ, phím mũi tên, đường gióng, panel thuộc tính; thay `window.prompt` (B7, B8, B10, B11) | W-6 | Áp cho text box mới, chữ đã sửa, ảnh chèn |
| **W-9** | Sửa chữ gốc kiểu Acrobat: gom khối đoạn, nhận màu/cỡ/font, editor nhiều dòng, reflow; xuất bằng engine (xoá chữ cũ thật, bỏ hình chữ nhật che) + kiểm tra sót (B1–B6, B14) | W-7 đạt, W-8 | Có thể tách W-9a (nhận khối + editor) / W-9b (xuất bằng engine) |
| **W-10** | Ảnh có sẵn: nhận, chọn, di chuyển, giãn, xoay, lật, thay, xoá, cắt; ảnh chèn có xoay/cắt/thay (B9) | W-7, W-8 | |
| **W-11** | Trải nghiệm xem: cuộn liên tục, thumbnail thật, zoom vừa trang/vừa bề rộng, xoay trang lưu vào file, render ảo hoá cho file nhiều trang (B12, B13, B15) | W-6 | Độc lập, có thể làm song song W-8 |
| W-12 | (tuỳ chọn) Tìm & thay thế chữ, watermark, header/footer, crop trang, link | W-9 | Chờ chủ dự án chọn |
| — | Cập nhật trang hướng dẫn `/huong-dan/` | Sau W-9, W-10 | Claude tự làm, chụp ảnh với dữ liệu giả |

Ước lượng độ khó (tương đối, **không phải cam kết thời gian**): W-6 thấp · W-7 cao · W-8 trung bình · W-9 cao · W-10 trung bình–cao · W-11 trung bình.

---

## 7. Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Xoá chữ gốc sai (xoá thừa chữ cần giữ, hoặc sót) | Cao | Spike W-7 đo trên fixture; kiểm tra sót khi xuất; mặc định cảnh báo nếu không xoá được |
| Chữ trong Form XObject / font Type3 / `TJ` dài cả dòng | Cao | W-7 báo cáo tỉ lệ; giai đoạn đầu chỉ cảnh báo, không âm thầm che |
| Font gốc là subset → không gõ được ký tự mới bằng font gốc | Trung bình | Dùng font thay thế gần nhất (Be Vietnam Pro/Arimo/Noto) và báo cho người dùng biết đã thay font |
| `App.tsx` lớn, sửa dễ vỡ | Trung bình | W-6 tách module + test trước khi thêm tính năng |
| Hiệu năng trang nhiều đối tượng | Trung bình | Tách lớp render, ảo hoá trang (W-11) |
| License khi chọn B/C | Trung bình | Pháp chế duyệt trước khi thêm dependency |

---

## 8. Quyết định cần chủ dự án

- **Q-P1** Engine: A (tự viết, có spike chặn) / B (MuPDF.js, AGPL) / C (SDK thương mại). Đề xuất: **A**.
- **Q-P2** Khi sửa/xoá chữ gốc mà engine **không xoá được** chữ cũ: (a) chặn xuất và báo lỗi, (b) cho xuất nhưng cảnh báo rõ trang nào còn chữ cũ, (c) che như hiện tại không báo. Đề xuất: **(b)**.
- **Q-P3** Thứ tự sau W-6: W-7 → W-8 → W-9 → W-10, W-11 song song. Có làm W-12 không, làm mục nào.
- **Q-P4** Điện thoại: chỉ xem + thao tác đơn giản, chỉnh sửa đầy đủ cho màn hình ≥ 1024px? Đề xuất: **có**.
