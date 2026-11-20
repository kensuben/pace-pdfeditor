# Báo cáo Spike Engine Content Stream (W-7)

> **Dự án:** PACE PDF Editor  
> **Nhiệm vụ:** Spike engine đọc/ghi content stream và xoá thật chữ trong vùng (Task W-7)  
> **Trạng thái:** Hoàn thành toàn bộ tiêu chí K1–K12  
> **Đề xuất quyết định:** **ĐI TIẾP (PROCEED)** vào các giai đoạn W-9 / W-10

---

## 1. Tóm tắt điều hành & Đề xuất quyết định

### Đề xuất: **ĐI TIẾP (PROCEED WITH OPTION A)**
Nhóm spike khuyến nghị đi tiếp phương án tự phát triển engine content stream nhẹ (Option A theo định hướng tại `docs/pdf-editor/01-PLAN.md` mục 4, 7, 8) và tích hợp vào các task W-9 (Sửa chữ gốc) và W-10 (Ảnh gốc).

### Lý do đề xuất:
1. **Khắc phục triệt để lỗi B1 (Bảo mật & Hiển thị):** Trước đây hệ thống chỉ vẽ hình chữ nhật che đè lên chữ cũ (chữ cũ vẫn nằm trong content stream và che mất khung viền bảng). Spike đã chứng minh việc xoá thật toán tử vẽ chữ trong content stream loại bỏ hoàn toàn chữ gốc khỏi PDF xuất ra mà không làm ảnh hưởng đến bất kỳ đường kẻ hay hình vẽ nào (K7).
2. **Độ chính xác cao trên fixture đa dạng:** Toàn bộ 7 fixture kiểm thử thực tế (F1–F7) đều đạt độ chính xác toạ độ $\le 0.01$ pt.
3. **Hỗ trợ đầy đủ tiếng Việt nhúng Type0 Identity-H:** Đọc chính xác độ rộng glyph từ bảng `/W` của `DescendantFonts` (Be Vietnam Pro), tính toán bounding box không phụ thuộc phỏng đoán (`approximate === false`).
4. **Hỗ trợ xoá một phần mảng `TJ` (K9):** Đã hiện thực thành công quy tắc mức 2, thay thế phần tử chuỗi bị xoá bằng kerning âm bù trừ, bảo toàn vị trí toạ độ tuyệt đối của các chữ phía trước và phía sau.
5. **Hiệu năng xuất sắc:** Thời gian xử lý trung vị trên trang nặng 5.000 toán tử `Tj` với 100 vùng xoá là **50.86 ms**, thấp hơn rất nhiều so với ngưỡng trần 300 ms.
6. **Không phát sinh dependency ngoài:** Engine được viết hoàn toàn bằng TypeScript thuần trên nền tảng `pdf-lib` có sẵn, chạy mượt mà trên môi trường Node/Browser mà không cần thêm bất kỳ thư viện bên ngoài nào.

---

## 2. Bảng kết quả Fixture (K3–K9)

| Fixture | Mô tả kịch bản | Kỳ vọng | Kết quả | Ghi chú |
|---|---|---|---|---|
| **F1 (K3)** | 3 dòng Helvetica: `Line A` / `Customer: Hoc vien Test 01` / `Line C`. Vùng xoá phủ dòng 2. | Dòng 2 biến mất hoàn toàn trong `getTextContent`. `Line A` và `Line C` giữ nguyên toạ độ (lệch $\le 0.01$ pt). | **PASS** | Xoá sạch `Tj`, không che đè màu. |
| **F2 (K4)** | 4 dòng viết tay liên kết qua `TL`, `T*` và toán tử `'`. Vùng xoá phủ dòng 2. | Dòng 2 bị xoá, `'` được thay bằng `T*` để bảo toàn bước nhảy dòng; dòng 3 và 4 giữ nguyên toạ độ ($\le 0.01$ pt). | **PASS** | Bảo toàn hiệu ứng xuống dòng chính xác. |
| **F3 (K5)** | CTM biến đổi tỷ lệ `q 2 0 0 2 0 0 cm` + `Tm` lồng nhau. | Toạ độ tính chuẩn theo không gian trang. Chỉ xoá chữ nằm trong vùng trang, giữ nguyên chữ ngoài vùng. | **PASS** | Nhân ma trận affine $T_m \times CTM$ chính xác. |
| **F4 (K6)** | Tiếng Việt nhúng `Type0 Identity-H` (Be Vietnam Pro). | Dòng tiếng Việt bị xoá thật. Độ rộng lấy từ `/W`, cờ `approximate === false`. | **PASS** | Phân tích đúng cấu trúc DescendantFonts CIDFontType2. |
| **F5 (K7)** | Ô bảng có viền hình chữ nhật (`re S`) và chữ `Cell 1`, `Cell 2`. Xoá chữ trong `Cell 1`. | `Cell 1` bị xoá. Số lượng toán tử vẽ đường kẻ/khung trong `getOperatorList` của pdf.js không đổi. | **PASS** | Khung viền bảng nguyên vẹn 100%. |
| **F6 (K8)** | Form XObject (`/Subtype /Form`) chứa chữ giao với vùng xoá. | Không crash. Ghi nhận `skipped: form-xobject: 1`. Chữ trong Form XObject được giữ an toàn. | **PASS** | Kiểm soát an toàn (fail-safe). |
| **F7 (K9)** | Mảng `TJ` mang `[(Name: ) -20 (Hoc vien Test 01)]`. Vùng xoá chỉ phủ phần tên. | `Name:` giữ nguyên toạ độ. `Hoc vien Test 01` bị xoá và thay bằng kerning âm bù trừ. | **PASS** | Đạt tiêu chuẩn mở rộng mức 2. |

---

## 3. Số liệu hiệu năng (K10)

Đo đạc trên trang PDF chứa **5.000 toán tử `Tj`** và **100 vùng xoá** phân bổ ngẫu nhiên trên trang (sau 1 lượt chạy làm nóng):

- **Lần đo 1:** 47.95 ms
- **Lần đo 2:** 50.86 ms
- **Lần đo 3:** 71.31 ms
- **Giá trị trung vị (Median):** **50.86 ms**
- **Ngưỡng yêu cầu:** < 300 ms (đạt tốc độ nhanh gấp ~6 lần yêu cầu).

---

## 4. Danh sách các trường hợp chưa hỗ trợ (Kế hoạch W-9 / W-10)

1. **Đệ quy vào Form XObject (`/Subtype /Form`):** Hiện tại engine phát hiện va chạm và bỏ qua an toàn (`skipped: form-xobject`), không cố chỉnh sửa luồng stream bên trong XObject.
2. **Font Type3 (User-defined glyphs):** Không phân tích glyph proc của Type3, bỏ qua an toàn (`skipped: type3-font`).
3. **Chữ xoay góc bất kỳ kết hợp ma trận xiên (Shear/Skew):** Bounding box hiện tại tính toán theo hộp bao trục chuẩn (AABB) của các đỉnh sau biến đổi affine. Với văn bản nghiêng góc phức tạp, vùng xoá cần căn chỉnh theo OBB (Oriented Bounding Box) ở các giai đoạn sau nếu có nhu cầu.
4. **Text Clipping Path (Text Rendering Mode 7):** Các trường hợp chữ dùng làm mặt nạ clipping chưa được xử lý chuyên biệt.

---

## 5. Danh sách TODO(verify)

1. **`TODO(verify): ISO 32000-1 mục 9.6.2.2 Standard 14 Fonts width table`**:
   - `pdf-lib` không cung cấp API đồng bộ công khai để tra cứu metrics font chuẩn khi chưa embed. Engine đã tận dụng `StandardFontEmbedder` tích hợp sẵn trong `pdf-lib` để lấy độ rộng glyph chính xác cho Helvetica, Times-Roman, Courier, và dự phòng 0.5 em (`approximate: true`) nếu gặp font không xác định.
2. **`TODO(verify): ISO 32000-1 mục 9.4.4 Text Space Details & Kerning Displacement`**:
   - Khi xoá một chuỗi con trong mảng `TJ` (hoặc thay thế toàn bộ lệnh chữ bằng `[n] TJ`), engine tính toán khoảng bù toạ độ theo chuẩn ISO 32000-1 mục 9.4.4 với công thức $n = -(tx \times 1000) / (Tfs \times Th)$, đảm bảo bước dịch chuyển ngang của các chữ phía sau trên cùng dòng được bảo toàn chính xác (độ lệch $\le 0.01$ pt với chữ thông thường và $\le 0.05$ pt khi kết hợp các tham số $Tc, Tw, Tz, Ts$).

---

## 6. Lỗi QA phát hiện & đã sửa (W-7b)

Trong đợt nghiệm thu W-7, QA dựng fixture pixel test và phát hiện 4 vấn đề kỹ thuật. Tất cả 4 lỗi đã được khắc phục triệt để và kiểm chứng bằng bộ test T-A1..T-Z:

1. **Vấn đề A – Mất độ tiến ngang khi xoá lệnh chữ:**
   - *Hiện tượng:* Khi xoá toán tử `Tj`, `TJ`, `'`, hoặc `"`, engine trước đây loại bỏ hoàn toàn toán tử khỏi stream. Nếu trên cùng dòng có lệnh chữ tiếp theo (không có `Td`), chữ tiếp theo bị kéo dồn sang trái (ví dụ mất 105 pt trong mẫu `Name: Hoc vien Test 01 , Ha Noi`).
   - *Khắc phục:* Lệnh chữ bị xoá toàn bộ được thay thế bằng toán tử chỉ dịch chuyển toạ độ `[n] TJ` với $n = -(tx \times 1000) / (Tfs \times Th)$, trong đó $tx$ là tổng độ tiến ngang trong không gian chữ (gồm $Tc$, $Tw$ cho khoảng trắng của font 1 byte, $Th = Tz/100$) theo ISO 32000-1 mục 9.4.4. Với `'`, xuất `T*` rồi `[n] TJ`. Với `"`, xuất `Tw, Tc, T*` rồi `[n] TJ`. Tuyệt đối không dùng `Td` vì làm biến đổi text line matrix ($Tlm$), gây sai lệch vị trí cho các lệnh `T*` tiếp theo. Nếu $Tfs = 0$ hoặc $Th = 0$, không xoá và đếm vào `skipped: zero-scale`.
   - *Kiểm chứng:* Test T-A1, T-A2, T-A3 (độ lệch $\le 0.01$ pt).

2. **Vấn đề B – Hỏng dữ liệu nhị phân ảnh inline:**
   - *Hiện tượng:* `serializeContent` dùng `TextDecoder('latin1')` rồi `TextEncoder('utf-8')` lên chuỗi dữ liệu ảnh inline, làm các byte $\ge 0x80$ bị biến đổi sai lệch (0xFF thành 0xC3 0xBF).
   - *Khắc phục:* Viết lại bộ tuần hoàn hoá bằng `ByteWriter` nhị phân, ghi trực tiếp ra `Uint8Array`. Chuỗi lệnh ASCII được encode byte-by-byte, dữ liệu ảnh inline được copy nguyên văn nhị phân (`Uint8Array.set`). Loại bỏ hoàn toàn `TextEncoder` và `TextDecoder` trong `contentTokenizer.ts`.
   - *Kiểm chứng:* Test T-B1 (dải byte 0x00..0xFF bảo toàn tuyệt đối 100% qua chu trình serialize và writePageContent).

3. **Vấn đề C – Sai lệch bù kerning khi xoá một phần TJ có $Tc, Tw, Tz$:**
   - *Hiện tượng:* Khi xoá chuỗi con trong mảng `TJ`, công thức cũ chưa tính chuẩn tác động của tham số giãn chữ ($Tc$), giãn từ ($Tw$), và tỉ lệ ngang ($Tz$).
   - *Khắc phục:* Sử dụng công thức chuẩn $n = -(tx \times 1000) / (Tfs \times Th)$ cho từng phần tử chuỗi bị xoá trong `TJ`.
   - *Kiểm chứng:* Test T-C1 (độ lệch $\le 0.05$ pt cho cả ca $Tc=1, Tz=80, Tw=5$ và ca $Tc=-0.5, Ts=3$).

4. **Vấn đề D – Thiếu cảnh báo chữ giao nhau chưa bị xoá (Q-P2):**
   - *Hiện tượng:* Báo cáo `RemovalReport` không theo dõi các lệnh chữ có bounding box giao nhau với vùng xoá nhưng không bị xoá (do tâm nằm ngoài vùng xoá, Type3 font, Form XObject, zero-scale).
   - *Khắc phục:* Bổ sung trường `keptIntersecting: number` vào `RemovalReport`. Bổ sung hàm thuần `pagesWithRemainingText(reports: Map<number, RemovalReport>): number[]` trả về danh sách trang có chữ còn sót (`keptIntersecting > 0` hoặc `skipped > 0`), sẵn sàng cho cảnh báo UI ở giai đoạn tiếp theo.
   - *Kiểm chứng:* Test T-D1 và T-Z.
