# [W-2] Word Anonymizer: giao diện + điều hướng + log

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: W-1 (PR #7) và F-2 (PR #11) đã merge vào `main`.
Nhánh: `feat/w2-docx-anonymizer-ui` (tạo từ `main`) · Commit: `feat(W-2): word anonymizer page with preview, options and residual report`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/feat/w2-docx-anonymizer-ui` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w2-docx-anonymizer-ui
npm ci
```

## Vấn đề
Core ở `src/word-anonymizer/core/` (W-1, đã sửa ở F-2) chưa có giao diện. Từ F-2, kiểu dữ liệu core có thêm:
- `KnownIdentity.kind: 'contributor' | 'mentioned'`: `contributor` là người có comment/revision/metadata; `mentioned` là người chỉ được @mention.
- `MappedIdentity.alias`: dùng làm email ẩn danh (`<alias>@anonymized.invalid`), do `buildDefaultMapping` sinh ra.

`buildDefaultMapping` đặt nhãn `Người góp ý N` / `NG<N>` cho `contributor` và `Người được nhắc N` / `NN<N>` cho `mentioned`. `validateMapping(mapping, identities)` kiểm tra nhãn rỗng, trùng nhau, trùng tên thật. App hiện là một SPA không có router: `src/App.tsx` chỉ có PDF editor, topbar có nút đăng nhập Microsoft, Activity log, Administration.

## Logic cần đạt (quyết định của chủ dự án)
1. **Điều hướng**: switcher trên topbar "PDF Editor | Ẩn danh Word", đồng bộ hash `#/word-anonymizer` (F5/back/forward giữ đúng màn hình). Không thêm thư viện router.
2. **Bắt buộc đăng nhập**: chưa có `account`/`apiUser` → màn hình yêu cầu đăng nhập Microsoft, không cho chọn file.
3. **Luồng** trong `WordAnonymizerPage.tsx`:
   - (a) Chọn/kéo-thả `.docx`. Lỗi `AnonymizerError` hiện message tiếng Việt.
   - (b) Bảng xem trước, chia **2 nhóm**:
     - **"Người góp ý"** (`kind: 'contributor'`): nhãn, initials (sửa được), nguồn xuất hiện (`sources`: comment / revision / metadata), cờ "có email/presence".
     - **"Người được nhắc"** (`kind: 'mentioned'`): nhãn (sửa được), cờ "có email".
     - Nhóm nào rỗng thì ẩn.
     - **Không** hiển thị và không cho sửa `alias`; luôn giữ `alias` từ `buildDefaultMapping` khi người dùng đổi nhãn.
     - Validate bằng `validateMapping`; có lỗi thì hiện cạnh ô tương ứng và khoá nút "Ẩn danh".
     - Thống kê tổng (`stats.commentCount`, `stats.revisionCount`) hiện phía trên bảng.
     - Danh sách cảnh báo lấy từ `inspectDocx().warnings`.
   - (c) Tuỳ chọn = `AnonymizeOptions`, mặc định theo core (`removeDates=false`, `replaceMentions=true`, `replaceNamesInCommentText=false`, `scrubDocProps=true`, `customPropsPolicy='keep-sensitivity-labels'`). Tắt `replaceMentions` → hiện cảnh báo "Tên người được nhắc sẽ còn trong file".
   - (d) Nút "Ẩn danh" → báo cáo residual: `PASS` xanh, `WARN` vàng (liệt kê part + category), `FAIL` đỏ.
   - (e) Tải file.
4. `FAIL` → nút tải bị vô hiệu; chỉ mở khi tick "Tôi đã hiểu rủi ro".
5. Tên file tải về: mặc định `document_anonymized.docx`. Tuỳ chọn "Giữ tên gốc" → `<tên gốc>_anonymized.docx`.
6. "Tải file mapping (JSON)": mặc định **tắt**. Khi bật hiện cảnh báo: *"File mapping chứa tên thật — chỉ lưu nội bộ, không upload lên công cụ AI."*
7. Nút "Xoá khỏi bộ nhớ": reset state, `URL.revokeObjectURL` mọi Blob URL.
8. Dòng nhắc cố định: *"Kiểm tra lại nội dung tài liệu trước khi upload — công cụ không ẩn danh tên người trong thân văn bản."*
9. **Log**: `word_anonymizer.completed` `{ authorCount, commentCount, revisionCount, residualStatus }` và `word_anonymizer.failed` `{ code }`. Không có tên file, tên người.

## Ràng buộc
- Tạo `src/word-anonymizer/WordAnonymizerPage.tsx`, `src/word-anonymizer/word-anonymizer.css`. Sửa `src/App.tsx` chỉ ở: topbar (switcher), chọn màn hình theo hash, truyền `account`/`apiUser`/`log` vào trang mới. Import CSS ở `src/main.tsx`.
- Không sửa `src/word-anonymizer/core/*` (lỗi core → ghi báo cáo, không tự sửa). Task F-4 có thể đang sửa core song song; W-2 chỉ dùng API công khai qua `src/word-anonymizer/core/index.ts`.
- Không đổi hành vi PDF editor.
- Không gửi file/nội dung/mapping qua mạng.

## Tiêu chí hoàn thành
- K1: Vào `#/word-anonymizer` khi chưa đăng nhập → thấy yêu cầu đăng nhập, không chọn được file.
- K2: Đăng nhập, upload file fixture có 2 người góp ý + 1 người chỉ được @mention (sinh từ helper test của core rồi lưu tạm ngoài repo) → nhóm "Người góp ý" có 2 dòng, nhóm "Người được nhắc" có 1 dòng, không có cột alias. Sửa nhãn trùng → báo lỗi, nút "Ẩn danh" bị khoá. Đổi nhãn người được nhắc thành `Giảng viên A` → file tải về có `@Giảng viên A` trong comment, rel vẫn là `nguoi-duoc-nhac-1@anonymized.invalid`.
- K3: Chạy → `PASS`, tải `document_anonymized.docx`; giải nén thấy nhãn ẩn danh.
- K4: Fixture có tên trong text comment → `WARN` hiện part. Fixture giả lập `FAIL` → nút tải khoá đến khi tick xác nhận.
- K5: Activity log có `word_anonymizer.completed` chỉ với 4 trường số lượng/status.
- K6: Chuyển PDF ↔ Word nhiều lần, F5 trên hash → không lỗi console. Không lỗi CSP khi chạy image nginx (`docker compose up --build`). 390/768/1280px không vỡ.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path src/word-anonymizer/*.tsx -Pattern 'fetch\(|apiRequest\(|fileName'
git diff --name-only main -- src/word-anonymizer/core
npm run lint; npm test; npm run build
git add src
git commit -m "feat(W-2): word anonymizer page with preview, options and residual report"
git push -u origin feat/w2-docx-anonymizer-ui
git log --oneline -1 origin/feat/w2-docx-anonymizer-ui
```
Kỳ vọng: Select-String không có kết quả; `git diff … core` rỗng; lint/test/build xanh; dòng cuối in commit vừa push.

## Báo cáo
2 output `git push` + `git log origin/...` ở đầu, rồi theo `00_RULES.md` + ảnh chụp 3 trạng thái (PASS/WARN/FAIL) ở 1280px và 390px, dùng file fixture giả.
