# 00_RULES — Quy tắc chung cho mọi task Antigravity (pace-pdfeditor)

Đọc file này trước mỗi task. Prompt task chỉ ghi phần riêng; mọi thứ ở đây luôn áp dụng.

## ⚠️ Ba điều bắt buộc (đọc trước tiên)
1. **Tự commit và tự push, không chờ hỏi.** Khi code xong và lint/test/build xanh, **tự chạy Bước Y** (cuối file) ngay. Không dừng lại để hỏi "có commit/push không": người giao việc đã cho phép sẵn cho **nhánh của task**.
2. **Commit message đúng nguyên văn trong prompt.** Không tự đặt message khác (ví dụ `feat: initialize …`, `refactor: add core …`). Bước Y tự kiểm và sửa bằng `--amend` **trước** khi push.
3. **Chưa thấy `PUSH OK` thì chưa xong.** Dòng **đầu tiên** của báo cáo phải là dòng `PUSH OK: <sha> refs/heads/<nhánh>` do Bước Y in ra. Không có dòng này → người giao việc coi là **chưa làm**, kể cả khi code trên máy đã chạy được.

Lịch sử vi phạm (để biết vì sao quy tắc này cứng): 8 lần báo "done" khi chưa push; W-9a, W-9b, W-9c, F-16 đều dùng sai commit message.

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
- **Phải** tự commit + push **nhánh của task** bằng Bước Y. KHÔNG push `main`, KHÔNG force-push, KHÔNG tạo PR, KHÔNG rebase lịch sử đã push.
- `git commit --amend` chỉ dùng **trước** lần push đầu tiên của commit đó (Bước Y đã đặt đúng thứ tự). Commit đã push mà sai message → **không** amend/force-push, ghi rõ trong báo cáo.
- Chỉ báo "done" khi Bước Y in `PUSH OK`. Ở ĐẦU báo cáo dán: dòng `PUSH OK`, output `git rev-parse` của Bước A, toàn bộ output Bước Y.

## Bước Z — Xác nhận nhánh đã lên remote (bắt buộc trước khi báo "done")
Bước Y đã gồm Bước Z. Khi cần kiểm lại riêng, chạy (PowerShell):
```powershell
git fetch origin
git ls-remote --heads origin <nhánh>
git rev-parse --short HEAD
git log --oneline -1 origin/<nhánh>
```
- `git ls-remote` phải in **đúng 1 dòng** chứa `refs/heads/<nhánh>`. SHA trên dòng đó phải trùng SHA của `git rev-parse HEAD`.
- In rỗng, SHA lệch, hoặc `git push` báo lỗi → **CHƯA XONG**. Không được báo "done". Dán nguyên thông báo lỗi và dừng lại. KHÔNG force-push, KHÔNG đổi tên nhánh, KHÔNG push `main`.
- Báo cáo thiếu bất kỳ output nào trong 4 lệnh trên (cùng output `git push`) thì người giao việc **coi là chưa làm xong**, kể cả khi code trên máy đã chạy được.
- Nếu `git remote -v` hiện URL có token, che token khi dán vào báo cáo.
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
- Trước commit phải xanh: `npm run lint`, `npm run build`, và `vitest run` chạy **2 lần** (mẫu có giới hạn thời gian trong từng prompt). Dán **dòng tổng kết** (`Test Files … / Tests …`) của cả 2 lần vào báo cáo.
- **Test có sẵn trượt → DỪNG**, báo tên test + lý do. Không tự sửa test cũ, trừ test được prompt cho phép đích danh.
- React: gắn `ResizeObserver` / listener vào phần tử render muộn (có điều kiện) thì dùng **callback ref**, không dùng `useEffect([])` với `ref.current` (lỗi đã gặp ở W-11, F-15).
- UI: tiếng Việt, dùng token trong `src/pace-theme.css`, không vỡ ở 390/768/1280px.

## Bước Y — Commit + push + tự kiểm (chạy NGAY khi lint/test/build xanh, không chờ hỏi)
Thay các giá trị đầu bằng đúng **tên nhánh**, **commit message** và **danh sách file/thư mục** ghi trong prompt task, rồi chạy nguyên khối (PowerShell):
```powershell
$Branch = '<nhánh trong prompt>'
$Msg    = '<commit message trong prompt, nguyên văn>'
$Paths  = @('<file/thư mục 1>', '<file/thư mục 2>')
$Expect = 1   # số commit của nhánh trên main sau commit này (prompt gộp nhiều phần: phần a = 1, phần b = 2…)

if ((git branch --show-current) -ne $Branch) { Write-Output "DUNG: dang o nhanh '$(git branch --show-current)', khong phai '$Branch'"; return }
foreach ($p in $Paths) { if (Test-Path $p) { git add -- $p } }
git status --porcelain
$base = git rev-parse origin/main
git commit -m $Msg
if ($LASTEXITCODE -ne 0) { Write-Output "DUNG: git commit loi (khong co gi de commit?)"; return }
if ([int](git rev-list --count "$base..HEAD") -ne $Expect) { Write-Output "DUNG: nhanh co $(git rev-list --count "$base..HEAD") commit tren main, can dung $Expect"; return }
if ((git log -1 --format=%s) -ne $Msg) { git commit --amend -m $Msg }
Write-Output "MSG: $(git log -1 --format=%s)"
git push -u origin $Branch
git fetch origin
$remote = git ls-remote --heads origin $Branch
$local  = git rev-parse HEAD
if ($remote -and $remote.StartsWith($local)) { Write-Output "PUSH OK: $remote" } else { Write-Output "CHUA PUSH: remote='$remote' local='$local'" }
git log --oneline -1 "origin/$Branch"
```
- In `DUNG: …` (sai nhánh, commit lỗi, hoặc nhánh không phải đúng 1 commit trên `main`) → dừng và báo lại nguyên output. **Không** amend khi thấy `DUNG`.
- `git status --porcelain` sau `git add` còn file **ngoài** danh sách Ràng buộc → không commit file đó; ghi trong báo cáo.
- `git push` hỏi đăng nhập / báo lỗi, hoặc in `CHUA PUSH` → **chưa xong**: dán nguyên văn lỗi, dừng. Không force-push, không đổi tên nhánh, không push `main`.
- In `PUSH OK` và dòng `MSG:` đúng nguyên văn → được báo "done".

## Báo cáo
Dòng **đầu tiên** là dòng `PUSH OK: …` của Bước Y. Tiếp theo: output `git rev-parse` của Bước A, toàn bộ output Bước Y, dòng tổng kết vitest 2 lần. Sau đó:
1. File tạo/sửa + lý do (1 dòng/file).
2. Output tóm tắt `lint` / `test` / `build`.
3. Version chính xác của dependency/action mới.
4. Điểm làm khác prompt và lý do.
5. Danh sách `TODO(verify)`.
6. Rủi ro còn lại + phần riêng mà prompt task yêu cầu.
