# [F-1] Bỏ tên file khỏi log chèn ảnh và chèn trang

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: W-0 đã merge vào `main` (đã merge, PR #3).
Nhánh: `fix/f1-drop-filename-insert-logs` (tạo từ `main`) · Commit: `fix(F-1): drop file names from image/page insert activity logs`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/fix/f1-drop-filename-insert-logs` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f1-drop-filename-insert-logs
npm ci
```

## Vấn đề
W-0 đã bỏ `fileName` ở 5 lời gọi `log()`, nhưng còn 2 chỗ ghi tên file qua `commit(..., { metadata })`. Hàm `commit` gọi `log`, và `log` gửi lên `/api/activities`:
- `src/App.tsx:437`, action `image.inserted`: `metadata:{page,fileName:file.name,fileSize:file.size}`.
- `src/App.tsx:451`, action `pages.inserted`: `metadata:{afterPage:page,insertedPages:count,fileName:file.name}`.

Tên file thường chứa tên học viên/khách hàng (PII), vi phạm quy tắc log trong `00_RULES.md`. Prompt W-0 đã bỏ sót 2 chỗ này vì chỉ tìm lời gọi `log(`.

## Logic cần đạt
1. `image.inserted`: bỏ `fileName`; thêm `fileExt` lấy từ `file.type` (`png` / `jpeg`). Giữ `page`, `fileSize`.
2. `pages.inserted`: bỏ `fileName`; thêm `fileExt: 'pdf'`. Giữ `afterPage`, `insertedPages`.
3. GIỮ NGUYÊN: tên action, description, chức năng chèn ảnh/chèn trang.

## Ràng buộc
- Chỉ sửa `src/App.tsx`, đúng 2 object metadata trên.

## Tiêu chí hoàn thành
- K1: `src/App.tsx` không còn `fileName` nào.
- K2: `npm run lint`, `npm test`, `npm run build` xanh.
- K3: `npm run dev`: chèn 1 ảnh PNG giả và chèn trang từ 1 PDF giả → hoạt động như trước; Activity log của 2 action không có tên file.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path src/App.tsx -Pattern 'fileName'
npm run lint; npm test; npm run build
git add src/App.tsx
git commit -m "fix(F-1): drop file names from image/page insert activity logs"
git push -u origin fix/f1-drop-filename-insert-logs
git log --oneline -1 origin/fix/f1-drop-filename-insert-logs
```
Kỳ vọng:
- `git diff --stat` chỉ có `src/App.tsx`.
- Select-String không có kết quả.
- lint/test/build xanh.
- Dòng cuối in commit vừa push.

## Báo cáo
Output `git rev-parse` của Bước A + 2 output git ở đầu, rồi theo `00_RULES.md`.
