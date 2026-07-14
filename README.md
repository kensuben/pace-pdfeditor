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

## Cấu hình Microsoft Login

1. Tạo **App registration** trong Microsoft Entra admin center.
2. Chọn nền tảng **Single-page application (SPA)**.
3. Thêm redirect URI `http://localhost:5173` cho môi trường local và URL HTTPS production khi deploy.
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
3. Text nâng cao: font Unicode, rich text, edit nội dung gốc và OCR cho bản scan.
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
