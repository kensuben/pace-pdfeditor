# 00_RULES — Quy tắc chung cho mọi task Antigravity (pace-pdfeditor)

Đọc file này trước mỗi task. Prompt task chỉ ghi phần riêng; mọi thứ ở đây luôn áp dụng.

## Bước A — Lấy repo sạch, mới nhất (bắt buộc trước MỌI task)
Chạy ở thư mục gốc repo (PowerShell):
```powershell
git status --porcelain
```
- In ra BẤT KỲ dòng nào → **DỪNG**, báo danh sách file cho người giao việc. KHÔNG tự `git reset --hard`, `git clean`, `git stash` hay xoá file.
- Không in gì → chạy tiếp:
```powershell
git fetch origin
git checkout main
git pull --ff-only
git rev-parse --short HEAD
git rev-parse --short origin/main
```
- Hai dòng cuối phải in **cùng một commit**. `git pull --ff-only` lỗi hoặc hai commit khác nhau → **DỪNG** và báo lại, không tự merge/rebase.
- Kiểm tra `Test-Path docs/planning/antigravity/00_RULES.md` và `Test-Path <file prompt task>` đều in `True`.
- Dán output 2 lệnh `git rev-parse` vào đầu báo cáo (commit `main` dùng làm gốc).

Sau Bước A mới chạy "Bước 0" của prompt task (tạo nhánh, `npm ci`…).

## Git
- Mỗi task một nhánh, tạo từ `main` mới nhất (`git pull --ff-only`). Tên nhánh + commit message lấy đúng từ prompt.
- Được tự commit + push **nhánh của task**. KHÔNG push `main`, KHÔNG force-push, KHÔNG tạo PR, KHÔNG rebase lịch sử đã push.
- Chỉ báo "done" khi đã `git push` và `git log --oneline -1 origin/<nhánh>` in ra đúng commit vừa tạo. Ở ĐẦU báo cáo dán: output `git rev-parse` của Bước A, output `git push`, output `git log origin/<nhánh>`.
- Lệnh trong prompt viết cho **PowerShell** (Windows).

## Phạm vi
- Chỉ sửa file được liệt kê trong mục "Ràng buộc" của task. Cần sửa file khác → dừng, ghi lý do trong báo cáo, không tự mở rộng.
- Không refactor, đổi tên, format lại code ngoài phạm vi.
- Gặp điểm chưa chắc (cấu trúc OOXML, API thư viện) → ghi `// TODO(verify): …` và liệt kê trong báo cáo. **Không bịa** tên hàm, phần tử XML, thuộc tính.

## Bảo mật & dữ liệu (theo PACE AI Policy)
- KHÔNG mở/đọc/in/parse `.env`, `.env.*` (trừ `*.example`), file key/cert/token, `~/.ssh`. Không hard-code credential, client ID thật, email thật.
- Dữ liệu mẫu/fixture/test phải rõ ràng là giả: `Học viên Test 01`, `giangvien.test@example.com`, GUID `00000000-0000-0000-0000-000000000000`.
- KHÔNG commit file Word/PDF thật. Fixture được dựng bằng code.
- Activity log KHÔNG chứa tên file, tên người, email, nội dung tài liệu — chỉ số lượng, mã lỗi, phần mở rộng, kích thước.
- File người dùng (PDF, DOCX) xử lý tại trình duyệt, không gửi lên server/dịch vụ ngoài.

## Chất lượng
- Dependency mới: pin **version chính xác** (không `^`, `~`, `latest`); lấy bằng `npm view <pkg> version`; `package-lock.json` phải cập nhật theo.
- Trước commit phải xanh: `npm run lint`, `npm run build`, và `npm test` (từ W-0 trở đi).
- UI: tiếng Việt, dùng token trong `src/pace-theme.css`, không vỡ ở 390/768/1280px.

## Báo cáo (sau 2 output git ở đầu)
1. File tạo/sửa + lý do (1 dòng/file).
2. Output tóm tắt `lint` / `test` / `build`.
3. Version chính xác của dependency/action mới.
4. Điểm làm khác prompt và lý do.
5. Danh sách `TODO(verify)`.
6. Rủi ro còn lại + phần riêng mà prompt task yêu cầu.
