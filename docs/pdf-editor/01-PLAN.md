# PDF Editor — Kế hoạch nâng cấp chỉnh sửa text & hình ảnh (mục tiêu: trải nghiệm gần Acrobat "Edit PDF")

Trạng thái: **đã duyệt hướng đi (Q-P1…Q-P4 chốt ngày 2026-11-20)** · Khảo sát trên `main` @ `947b062` · Người lập: Claude (planning/QA), người làm: Antigravity.

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
| **B16** | **Chữ xuất bằng Be Vietnam Pro/Arimo/Noto Sans gần như mất**: file `@fontsource/*-vietnamese-*.woff` chỉ chứa ký tự có dấu, thiếu chữ Latin thường. Phát hiện khi QA W-6 (2026-11-20) | Chạy thử trên `main`: thêm `Học viên Test 01 - ghi chú` (font mặc định) → PDF chỉ còn `ọ` | **Lỗi production**, sửa ở **F-11** (đóng gói TTF đầy đủ Be Vietnam Pro + Arimo; Noto Sans không dùng được để xuất vì chữ trích ra bị chèn ký tự rác) |
| B17 | Bản xem trên màn hình của chữ font `Helvetica` hiện bằng font serif dự phòng trên máy không có Helvetica (Linux/Chromium), khác font khi xuất | Ảnh smoke test QA W-6 (2026-11-20): dòng đã sửa hiện kiểu Times | Xử lý ở W-9 (dùng Arimo cho bản xem Helvetica) |
| **B18** | Xuất PDF đặt sai vị trí/hướng đối tượng trên trang có `/Rotate` (90/180/270) | QA 2026-11-20: trang `/Rotate 90`, highlight phủ dòng chữ → PDF xuất thành vệt dọc ở góc dưới | Sửa ở **F-12** |
| **B19** | Xuất PDF lệch vị trí/kích thước trên trang có MediaBox/CropBox không bắt đầu ở gốc (0,0) | QA 2026-11-20: MediaBox `[100 100 700 500]` → highlight lệch, sai kích thước | Sửa ở **F-12** |
| **B20** | **Highlight không hiện trên màn hình** (khung `div.annotation.highlight` chỉ có `color`/`opacity`, nền trong suốt); file xuất vẫn có vệt màu. Có từ bản phát hành đầu | QA W-8 (2026-11-20): `backgroundColor` tính được `rgba(0,0,0,0)` trên cả `main` và W-8 | Sửa ở **F-13** |
| B21 | Chọn chữ làm thanh định dạng hiện ra, đẩy trang xuống 46px; bỏ chọn thì trang nhảy lên | QA W-8: toạ độ chữ 307px → 261px khi bỏ chọn | Xử lý ở W-8b (đưa định dạng vào panel bên phải) |
| **B22** | Chữ Helvetica bị nhận là Times: regex `/times\|serif/` khớp `sans-serif` của pdf.js (`textExtraction.ts:28`) | QA W-9a 2026-11-23: sửa dòng Helvetica → file xuất dùng Times-Roman | Sửa ở **W-9b** |
| **B23** | Chữ gốc Be Vietnam Pro sau khi sửa xuất bằng Arimo: `styleFromBaseFont` không nhận `BeVietnamPro` | QA W-9c 2026-11-23: đoạn "Điều 1" PDF mẫu | Sửa ở **F-16** |
| **B24** | Khung bao nét đứt của vùng đang sửa cắt ngang ô sửa | Ảnh hướng dẫn 26 | Sửa ở **F-16** |
| **B25** | Chữ tiếng Việt font Times sau khi sửa xuất bằng Arimo (không chân): `resolveExportFontFamily` Times + có dấu → Arimo vì font chuẩn Times-Roman không có tiếng Việt | Đọc code 2026-11-23 | Sửa ở **F-17** |
| **B26** | Dòng đơn sửa dài hơn chút bị ngắt thành 2 dòng: ngắt theo bề rộng chữ cũ dù bên phải còn trống | QA F-17 2026-11-23: `CÔNG VĂN SỐ 01/2026` | Sửa ở **F-18** |
| **B27** | Hai dòng "Kính gửi: …" / "Địa chỉ: …" bị gộp thành một khối; chọn hết rồi gõ thì mất dòng kia | QA F-17 2026-11-23 | Sửa ở **F-18** |

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
| Thêm text, thêm ảnh, link, crop trang, header/footer, watermark | Thêm text (prompt), thêm ảnh | Thêm text: W-8. Còn lại: W-12a–d |

---

## 4. Lựa chọn kỹ thuật cho "sửa thật" (đã chốt A — Q-P1)

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
| **W-6** | Tách PDF editor khỏi `App.tsx` thành module + test nền; **không đổi hành vi**; test "đặc tả" ghi nhận B1 | — | ✅ Đã merge (PR #38) |
| **F-11** | Sửa B16: nhúng font TTF đầy đủ khi xuất, báo lỗi rõ khi thiếu font/glyph | W-6 | ✅ Đã merge (PR #40) |
| **W-7** | Engine content stream: tokenizer, xoá thật chữ trong vùng, giữ vị trí chữ còn lại, báo `keptIntersecting` | W-6 | ✅ Đã merge (PR #42, gồm W-7b). Cổng Q-P1 **đạt** |
| **W-8** | Khung chọn, 8 tay nắm, kéo/giãn mọi loại đối tượng, phím mũi tên, thêm chữ gõ tại chỗ, chèn ảnh đúng tỉ lệ (B7, B8, B10, B11) | W-7 | ✅ Đã merge (PR #44) |
| **F-13** | Highlight hiện màu trên màn hình + xem trước dạng hình chữ nhật khi kéo (B20) | W-8 | ✅ Đã merge (PR #46) |
| **F-12** | Xuất đúng trên trang xoay / MediaBox-CropBox lệch gốc (B18, B19) | W-7 | ✅ Đã merge (PR #47) |
| **W-8b** | Panel thuộc tính, đường gióng/hút cạnh, nút "Hiện khung bao", sửa B21, zoom giữ điểm dưới con trỏ, sidebar ≤ 800px, highlight xuất `Multiply` | W-11 | ✅ Đã merge (PR #51, gồm W-8b2) |
| **F-15** | Thanh công cụ thu gọn + menu "Thêm" (nút Xoay trang bị đẩy ra ngoài ở 1280px), ô panel không vỡ dòng, tên file không đè nút | W-8b | Prompt: `docs/planning/antigravity/F-15_toolbar-overflow-panel-fields-file-title.md` |
| **F-15c** | Menu "Thêm thao tác" bị cắt và làm thanh công cụ cuộn dọc ở 1024px (overflow của `.toolbar` + focus không `preventScroll`) | F-15 | Prompt: `docs/planning/antigravity/F-15c_overflow-menu-clipping.md` |
| **W-9a** | Xuất PDF bằng engine: xoá thật chữ cũ khi sửa chữ có sẵn, chỉ che khi không xoá được (OCR, lệnh chạm vùng, Form XObject), kiểm tra sót sau xuất, cảnh báo theo trang trước khi tải/ký (B1, Q-P2) | W-7, F-12 | ✅ Đã merge (PR #64, squash) |
| **W-9b** | Nhận đúng font/đậm/nghiêng/màu của chữ có sẵn (đọc content stream), khung đúng cho chữ xoay (chưa cho sửa), font bản xem dùng Arimo thay Helvetica (B3, B14, B17, B22) | W-9a | ✅ Đã merge (PR #66, squash) |
| **W-9c** | Gom khối đoạn (không gộp ô bảng/biểu mẫu), ô sửa nhiều dòng, tự xuống dòng thay vì thu nhỏ chữ, xoá thật theo từng dòng của khối (B5, B6) | W-9b | ✅ Đã merge (PR #68, squash) |
| **F-16** | Nhận font Be Vietnam Pro / Arimo từ BaseFont để chữ sửa giữ đúng font; ẩn khung bao của vùng đang sửa (B23, B24) | W-9c | ✅ Đã merge (PR #72, squash) |
| **F-17** | Đóng gói font Tinos (OFL-1.1, cùng kích thước Times New Roman) để chữ tiếng Việt kiểu Times xuất ra font có chân thay vì Arimo (B25) | F-16 | ✅ Đã merge (PR #74) |
| **F-18** | Dòng đơn sửa dài hơn kéo sang phải tới chỗ trống trước khi xuống dòng; dòng "Nhãn: giá trị" không bị gộp thành khối (B26, B27) | F-17 | ✅ Đã merge (PR #76) |
| **F-18b** | Dòng rộng nhất trang khi sửa dài hơn được kéo tới lề phải (lề trái đối xứng) thay vì xuống dòng ngay (B26 còn sót) | F-18 | Prompt: `docs/planning/antigravity/F-18b_single-line-mirror-margin.md` |
| **W-10** | Ảnh có sẵn: nhận, chọn, di chuyển, giãn, xoay, lật, thay, xoá, cắt; ảnh chèn có xoay/cắt/thay (B9) | W-7, W-8 | |
| **W-11** | Cuộn liên tục có ảo hoá, thumbnail thật, menu zoom + vừa trang/vừa chiều rộng, xoay trang lưu vào file, đặt lại Undo sau thao tác trang (B12, B13, B15) | W-8, F-12, F-13 | ✅ Đã merge (PR #48, gồm W-11b) |
| W-12a–d | Tìm & thay thế chữ · watermark + header/footer · crop trang · link | W-9 | Đã duyệt (Q-P3) |
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

## 8. Quyết định của chủ dự án (2026-11-20)

- **Q-P1 = A.** Tự viết engine content stream trên `pdf-lib`, không thêm thư viện. Spike W-7 là cổng: không đạt thì trình lại B/C kèm số liệu.
- **Q-P2 = cảnh báo.** Không xoá được chữ cũ → vẫn cho xuất, nhưng hiện cảnh báo rõ **trang nào** còn chữ cũ trước khi tải về. Activity log chỉ ghi số trang/số vùng, không ghi nội dung.
- **Q-P3 = có W-12.** Thứ tự W-7 → W-8 → W-9 → W-10, W-11 song song. W-12 tách nhỏ khi tới lượt:
  - W-12a tìm & thay thế chữ (dùng engine của W-9);
  - W-12b watermark + header/footer;
  - W-12c crop trang;
  - W-12d link.
- **Q-P4 = đồng ý.** Màn hình < 1024px: xem, chuyển trang, zoom, thêm chữ/đánh dấu đơn giản; chỉnh sửa đầy đủ (khung chọn, tay nắm, panel thuộc tính, sửa chữ/ảnh gốc) từ ≥ 1024px.
