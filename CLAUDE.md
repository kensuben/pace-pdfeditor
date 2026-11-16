# CLAUDE.md — pace-pdfeditor

Hướng dẫn cho Claude Code khi làm việc trong repo này. Chính sách PACE AI (managed settings) luôn được ưu tiên; file này chỉ được chặt hơn, không nới hơn.

## Dự án
- SPA React + TypeScript + Vite (`src/`), PDF editor xử lý tại trình duyệt; backend Node `server/index.mjs` (audit log, quản trị user, JSON store trong volume `paperly_data`); nginx + node trong Docker.
- Kế hoạch tính năng: `docs/word-anonymizer/` (Word Comment Anonymizer). Prompt giao việc cho Antigravity: `docs/planning/antigravity/`.

## Vai trò mặc định: lập kế hoạch → viết prompt cho Antigravity → QA
Khi người dùng yêu cầu "chỉ làm planning / viết prompt cho Antigravity":
- Claude **không tự viết code tính năng**. Đầu ra là tài liệu kế hoạch và prompt task.
- Sau khi Antigravity báo xong, Claude QA theo checklist của tính năng (ví dụ `docs/word-anonymizer/03-QA-CHECKLIST.md`).

## Quy ước viết prompt cho Antigravity (bắt buộc)
- Quy tắc chung nằm ở `docs/planning/antigravity/00_RULES.md`. Prompt task **không lặp lại** quy tắc chung, chỉ dẫn tới file này.
- **Mỗi prompt = một task nhỏ = một nhánh = một commit.** Không gộp nhiều việc vào một prompt.
  - Ngoại lệ: khi chủ dự án yêu cầu gộp, một prompt được chứa nhiều phần (A, B, C…) trên **một nhánh**, nhưng **mỗi phần một commit** với message riêng (`<type>(<ID>a)`, `<ID>b`…), có tiêu chí riêng và phải xanh lint/test/build sau từng commit. Ghi rõ quyết định gộp trong prompt.
- Lưu tại `docs/planning/antigravity/<ID>_<slug>.md`. ID theo tiền tố: `F-` (fix), `W-` (feature/work), có số thứ tự.
- Cấu trúc bắt buộc, theo đúng thứ tự:

```markdown
# [<ID>] <Tiêu đề ngắn: kết quả cần đạt>

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
(Tiền điều kiện: <task phải merge trước>, nếu có)
Nhánh: `<loại>/<id-slug>` (tạo từ `main`) · Commit: `<type>(<ID>): <mô tả tiếng Anh>`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/<nhánh>` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
git checkout main / git pull --ff-only / git checkout -b <nhánh> (+ npm ci nếu cần)

## Vấn đề
Hiện trạng cụ thể: file, hàm, dòng, hậu quả với người dùng. Có quyết định của chủ dự án thì ghi mã (Q-x).

## Logic cần đạt
Danh sách đánh số, mô tả hành vi mong muốn theo từng trường hợp; nêu rõ phần phải GIỮ NGUYÊN.

## Ràng buộc
Danh sách file được phép sửa; những gì không được đổi (route, tham số, công thức…); điểm agent tự quyết thì yêu cầu ghi rõ.

## Tiêu chí hoàn thành
K1, K2, … kiểm chứng được (URL/thao tác → kết quả mong đợi; có tiêu chí responsive 390/768/1280px nếu có UI).

## Chứng minh + commit + push (PowerShell)
git diff --stat, các lệnh Select-String chứng minh code cũ đã hết, lint/test/build, git add/commit/push, git log origin/...
Kỳ vọng: <output mong đợi của từng lệnh>.

## Báo cáo
2 output git ở đầu, rồi theo `00_RULES.md` + phần riêng của task.
```

- **Bước A (lấy repo sạch)** định nghĩa một lần trong `00_RULES.md`: kiểm `git status --porcelain` (bẩn → dừng, không reset/clean/stash), `git fetch` → `checkout main` → `pull --ff-only`, so `HEAD` với `origin/main`. Mọi prompt task phải gọi Bước A ở đầu Bước 0; đoạn giao việc gửi Antigravity cũng phải nhắc Bước A.
- **Bước Z (xác nhận nhánh đã lên remote)** định nghĩa trong `00_RULES.md`: sau `git push`, chạy `git ls-remote --heads origin <nhánh>` và so SHA với `HEAD`. Đoạn giao việc gửi Antigravity phải nhắc Bước Z. Khi QA, Claude luôn kiểm tra nhánh có trên remote trước; không có thì báo "chưa push", không QA.
- Lệnh viết cho **PowerShell** (người chạy dùng Windows). `git add` file có thể không tồn tại thì bọc `if (Test-Path …)`.
- Mô tả vấn đề phải dựa trên code đã đọc (file:dòng). Không bịa API, phần tử, thuộc tính; điểm chưa chắc ghi "chưa xác minh" và yêu cầu agent đánh dấu `TODO(verify)`.
- Dữ liệu ví dụ luôn giả (`Học viên Test 01`, `@example.com`, GUID toàn số 0).

## Git cho Claude
- Không push `main`, không force-push, chỉ tạo PR khi người dùng yêu cầu.
- Không đọc `.env*` (trừ `*.example`), không đưa credential/PII vào commit, docs, log.

## Lệnh kiểm tra
```bash
npm run lint
npm run build
```
`npm test` có sau task W-0.
