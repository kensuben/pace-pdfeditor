# QA Checklist — Word Comment Anonymizer + Deploy

Dùng sau khi Antigravity hoàn thành. Claude Code sẽ chạy phần **A–D** (tự động/đọc code); phần **E** cần người dùng làm với Microsoft Word thật.

## A. Ràng buộc chính sách (chặn merge nếu FAIL)

- [ ] A1. Không có `fetch`/`XMLHttpRequest`/`apiRequest` nào gửi nội dung .docx, tên tác giả, mapping ra ngoài (`grep` thư mục `src/word-anonymizer`).
- [ ] A2. Activity log: chỉ số lượng + error code; đã bỏ `fileName` khỏi log PDF.
- [ ] A3. Không có file `.docx` thật, email/tên thật, client ID thật trong diff (`git diff --stat`, grep `@pace.edu.vn`, GUID khác `0000…`).
- [ ] A4. Không có `.env.production` thật bị commit; `.gitignore` đã có `deploy/.env.production`, `backups/`, `.deploy/`.
- [ ] A5. Dependency mới pin version chính xác; `package-lock.json` khớp.

## B. Core logic (review code + chạy test)

- [ ] B1. XML xử lý theo namespace URI, không regex trên prefix `w:`.
- [ ] B2. Chặn `<!DOCTYPE`; giới hạn ZIP (size, tổng giải nén đếm thực tế, số entry, path traversal).
- [ ] B3. Part không đổi giữ nguyên bytes (so sánh hash trong test).
- [ ] B4. Thread trả lời comment còn nguyên (`commentsExtended.xml`).
- [ ] B5. Quét `w:author` trên **mọi** part dưới `word/` (không chỉ document.xml).
- [ ] B6. Mapping ổn định, gộp đúng 1 người xuất hiện ở comment + revision + people.xml.
- [ ] B7. Residual scan chạy trên **file đầu ra**, chuẩn hoá dấu tiếng Việt, bỏ chuỗi ≤ 2 ký tự.
- [ ] B8. Thử thêm case biên ngoài T01–T18: author rỗng, author chỉ có khoảng trắng, 2 người trùng tên, nhãn người dùng nhập trùng tên thật, file 0 byte, file `.docx` thực chất là PDF đổi đuôi.
- [ ] B9. Rà mọi `TODO(verify)` Antigravity để lại.

## C. UI

- [ ] C1. Chưa đăng nhập → không dùng được.
- [ ] C2. FAIL → khoá tải; WARN → hiển thị vị trí; mapping JSON mặc định tắt + cảnh báo.
- [ ] C3. "Xoá khỏi bộ nhớ" revoke Blob URL; chuyển qua lại PDF Editor không lỗi.
- [ ] C4. Playwright smoke test: upload fixture → anonymize → tải file → mở lại bằng JSZip → không còn tên giả gốc.
- [ ] C5. Không lỗi CSP trong console (nginx CSP hiện tại).

## D. Deploy

- [ ] D1. `bash -n` + `shellcheck` cho `scripts/deploy.sh`, `scripts/backup.sh`.
- [ ] D2. `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production.example config` hợp lệ.
- [ ] D3. Service tên `app`/`web` khớp `APP_CONTAINER`/`WEB_CONTAINER` trong script; alias `api` khớp `nginx.conf`.
- [ ] D4. `${APP_TAG:-latest}` xử lý cả APP_TAG rỗng (deploy) và `sha-xxxxxxx` (rollback).
- [ ] D5. Image có label `org.opencontainers.image.revision`; CI chỉ push `latest` sau khi test xanh.
- [ ] D6. Volume dữ liệu trỏ đúng volume cũ (`DATA_VOLUME`) — **người dùng xác nhận trên VPS** bằng `docker volume ls`.
- [ ] D7. Dry-run local: build 2 image, gắn tag giả, chạy `PROJECT=pace-pdf-test ./scripts/deploy.sh status`.

## E. Kiểm thử thủ công với Word thật (người dùng thực hiện)

Tạo file mới bằng tài khoản test (không dùng tài liệu khách hàng/học viên thật):

1. Word 365 Windows: 2 tài khoản comment, có reply, @mention, Track Changes ở body + header + footnote, Sensitivity label.
2. Word cho Mac: comment + track changes.
3. Mở file đầu ra bằng Word Win/Mac + LibreOffice: không báo lỗi "unreadable content", comment & thread còn đủ, tên hiển thị là nhãn ẩn danh, File → Info → Properties không còn tên.
4. Word → File → Info → **Inspect Document** trên file đầu ra để đối chiếu.
5. Upload thử lên công cụ AI **đã được PACE phê duyệt** và kiểm tra AI chỉ thấy nhãn ẩn danh.
