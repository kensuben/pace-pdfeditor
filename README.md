# Paperly PDF Editor

MVP PDF editor dành cho end-user, chạy hoàn toàn trong trình duyệt. PDF được đọc và chỉnh sửa tại máy người dùng, không upload lên server.

## Chạy dự án

```bash
npm install
npm run dev
```

Build và kiểm tra:

```bash
npm run lint
npm run build
```

## Triển khai bằng Docker

### Docker Compose

Sao chép `deploy.env.example` thành `.env`, điền Microsoft Entra client ID rồi chạy:

```bash
docker compose up -d --build
```

Ứng dụng mặc định chạy tại `http://localhost:8080`. Kiểm tra trạng thái:

```bash
docker compose ps
curl http://localhost:8080/healthz
```

### Docker CLI

```bash
docker build \
  --build-arg VITE_MICROSOFT_CLIENT_ID=your-client-id \
  --build-arg VITE_MICROSOFT_TENANT_ID=common \
  -t paperly-pdf-editor:latest .

docker run -d --name paperly \
  --restart unless-stopped \
  -p 8080:8080 \
  paperly-pdf-editor:latest
```

Microsoft config là biến build-time của Vite. Khi thay client ID hoặc tenant ID, cần build lại image.

### Hosting production

- Trỏ reverse proxy/load balancer HTTPS vào container port `8080`.
- Thêm URL production, ví dụ `https://pdf.example.com`, vào danh sách **SPA Redirect URI** trong Microsoft Entra.
- Không đặt client secret trong `.env` hoặc Docker image; SPA không sử dụng client secret.
- Endpoint healthcheck là `/healthz`.
- Container đã chạy read-only, drop Linux capabilities và tự restart trong cấu hình Compose.
- Activity log hiện nằm trong `localStorage` của trình duyệt. Xóa container không làm mất log, nhưng log chưa đồng bộ giữa thiết bị.

Ví dụ cập nhật image:

```bash
docker compose build --pull
docker compose up -d
```

## Tính năng hiện có

- Mở hoặc kéo-thả file PDF từ máy
- Render PDF, thumbnails, chuyển trang và zoom 50–250%
- Thêm text, highlight, vẽ tay và chữ ký dạng nét vẽ
- Chọn/xóa annotation, đổi màu, undo/redo
- Xuất annotations vào một file PDF mới
- Responsive cho desktop, tablet và mobile
- Xử lý file tại client, không cần backend
- Đăng nhập Microsoft bằng MSAL/Entra ID
- Activity log chi tiết theo tài khoản: mở file, điều hướng, zoom, annotation, undo/redo, export và sự kiện bảo mật
- Xem, lọc, xóa và xuất activity log thành JSON
- Tự động tạo vùng chọn từ text layer của PDF
- Scan OCR trang hiện tại bằng tiếng Việt và tiếng Anh
- Dùng Select để chọn vùng text native/OCR, sửa nội dung và ghi thay đổi vào file export
- Text Format Editor: Helvetica/Times/Courier, cỡ chữ 8–72, bold, italic, underline, căn trái/giữa/phải và màu chữ
- Double-click text annotation để sửa lại nội dung; format áp dụng cho text mới hoặc text đang chọn

## Cấu hình Microsoft Login

1. Tạo **App registration** trong Microsoft Entra admin center.
2. Chọn nền tảng **Single-page application (SPA)**.
3. Thêm redirect URI `http://localhost:5173/redirect.html` cho môi trường local và `https://your-domain/redirect.html` cho production, với loại nền tảng **Single-page application (SPA)**.
4. Sao chép `.env.example` thành `.env`, sau đó điền Application (client) ID và tenant ID.

```env
VITE_MICROSOFT_CLIENT_ID=your-application-client-id
VITE_MICROSOFT_TENANT_ID=common
```

Không đặt client secret trong frontend. SPA sử dụng authorization code flow với PKCE thông qua MSAL.

## Activity log

Log được tách theo `homeAccountId`, lưu tối đa 1.000 sự kiện gần nhất trong `localStorage`. Log không chứa nội dung PDF hoặc nội dung text annotation. Bản production nhiều thiết bị nên gửi các event này đến audit API có xác thực, append-only storage, retention policy và phân quyền admin; `localStorage` không phải kho audit chống chỉnh sửa.

## Kiến trúc

- React + TypeScript + Vite cho UI và state editor
- PDF.js hiển thị trang PDF lên canvas
- Lớp overlay giữ annotation bằng tọa độ chuẩn hóa (0–1), độc lập với zoom
- pdf-lib ghi annotation vào PDF khi export

## Phạm vi và roadmap

MVP tập trung vào annotation/edit cơ bản. Để tiến gần một sản phẩm như Foxit cho production, các bước tiếp theo nên đi theo thứ tự:

1. Quản lý trang: reorder, rotate thật, delete, insert, merge/split.
2. Chỉnh annotation: drag, resize, properties, comment thread, stamp, shape.
3. Text nâng cao: nhúng font Unicode, rich text, hiệu chỉnh layout phức tạp và OCR hàng loạt nhiều trang.
4. Form: điền form AcroForm, tạo field, flatten và validation.
5. Chữ ký: signature pad/import ảnh, e-sign workflow, audit trail; chữ ký số cần backend/HSM.
6. Tìm kiếm/copy text, bookmark, outline và accessibility.
7. Lưu nháp IndexedDB, autosave, recent files và khôi phục phiên.
8. Tối ưu PDF lớn: virtualized pages, lazy thumbnails, Web Worker và code splitting.
9. Bảo mật: CSP, giới hạn kích thước, kiểm tra file độc hại, encrypted/password PDF.
10. Kiểm thử: visual regression, PDF fixtures, cross-browser, mobile gestures và export fidelity.

## Lưu ý kỹ thuật

- Export hiện ghi annotation mới lên PDF, chưa chỉnh sửa trực tiếp text/image đã tồn tại.
- Font export mặc định là Helvetica nên text Unicode/Vietnamese cần nhúng font tùy chỉnh ở phase tiếp theo.
- Nút Rotate hiện là placeholder cho tính năng quản lý trang ở roadmap.

## Chèn ảnh và chèn trang PDF

- **Chèn ảnh** hỗ trợ PNG/JPEG, đặt ảnh vào giữa trang hiện tại và nhúng ảnh vào file khi xuất PDF.
- **Chèn trang** sao chép toàn bộ trang của file PDF được chọn vào ngay sau trang hiện tại. Annotation của các trang phía sau được tự động dịch đúng số trang.
- Chữ ký viết tay vẫn là annotation hiển thị. Có thể dùng **Chèn ảnh** để đặt ảnh chữ ký, nhưng hai cách này không phải chữ ký số có chứng thư.

## Tích hợp ký số

Frontend gọi một signing gateway đã được quản trị viên cấu hình. Gateway nhận `POST /v1/pdf/sign` dưới dạng `multipart/form-data` gồm `file`, `mode` (`usb-token` hoặc `remote-token`) và `reason`, sau đó trả về file PDF đã ký với content type `application/pdf`.

```env
# API backend/provider cho Remote Token (nên dùng reverse proxy cùng domain)
VITE_SIGNING_API_URL=/signing-api

# Local middleware của nhà cung cấp CA cho USB Token
VITE_USB_SIGNING_AGENT_URL=https://127.0.0.1:port
```

USB Token không thể được trình duyệt truy cập khóa riêng trực tiếp; cần cài middleware/local agent của nhà cung cấp CA. Remote Token cần backend tích hợp API của nhà cung cấp (ưu tiên chuẩn Cloud Signature Consortium) và thực hiện xác thực/OTP theo chính sách của CA. Hai biến Vite là cấu hình build-time nên phải build lại Docker image sau khi thay đổi.

## Phân quyền và Administration

Activity log được gửi về API và lưu trong Docker volume `paperly_data`; user không có quyền xóa log. Cấu hình ít nhất một email admin bootstrap trước khi build/deploy:

```env
ADMIN_EMAILS=admin@pace.edu.vn,security@pace.edu.vn
```

Sau khi admin đăng nhập Microsoft, nút Administration xuất hiện cạnh Activity Log. Admin có thể tạo group, thêm email được phép đăng nhập, bật/tắt tài khoản, cấp quyền admin, gán group, xem user online, tìm kiếm/lọc log và xóa log trong một khoảng thời gian xác định. User online được xác định bằng heartbeat 30 giây và thời hạn hiện diện 90 giây.

Dữ liệu backend nằm ở `/data/store.json` trong volume. Cần backup volume này định kỳ. Với tải lớn hoặc yêu cầu audit tuân thủ cao, nên thay JSON store bằng PostgreSQL/SQL Server và append-only/WORM retention.
