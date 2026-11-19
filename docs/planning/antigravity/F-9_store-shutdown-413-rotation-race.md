# [F-9] API: ghi nốt dữ liệu khi tắt server, trả 413 thật, xoay vòng log không mất/lặp log

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm.
Tiền điều kiện: F-8 đã merge vào `main` (PR #27).
Nhánh: `fix/f9-store-shutdown-413-rotation` (tạo từ `main`) · Commit: `fix(F-9): wait for in-flight write on shutdown, send 413 before closing, rotate logs by id`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và Bước Z (cuối file) đạt – dán output ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b fix/f9-store-shutdown-413-rotation
npm ci
```

## Vấn đề
QA của F-8 tái hiện được các lỗi sau (dữ liệu giả):
1. **Tắt server khi đang ghi dở thì mất thay đổi mới nhất.**
   - `server/store.mjs:106-115` (`flush()`): nếu `this.isWriting === true` thì chỉ đặt cờ rồi **return ngay**.
   - `server/index.mjs:53-60` (`shutdown`): `await storeManager.flush()` rồi `process.exit(0)`.
   - Đo thực tế: gọi `flush()` khi lần ghi trước chưa xong → trả về sau **0 ms**, file chưa được ghi, thay đổi phát sinh trong lúc ghi bị bỏ.
   - Mỗi lần `./scripts/deploy.sh` thay container đều gửi SIGTERM, nên rủi ro lặp lại ở mọi lần deploy.
2. **Client không nhận được 413.** `server/http.mjs:17-25` gọi `req.destroy()` rồi mới `throw`. Socket bị huỷ nên response 413 không gửi được. Đo thực tế với HTTP server thật: client nhận `ECONNRESET`.
3. **Xoay vòng log chạy cùng lúc admin xoá log.** `server/store.mjs:47-75` (`rotateLogs`) tính `excess` và `toArchive` từ `store.logs`, `await` ghi archive, rồi `store.logs.splice(0, excess)`. Trong lúc chờ, `DELETE /api/admin/logs` (`server/index.mjs`) gán `store.logs = store.logs.filter(...)` sang mảng mới. Kết quả: `splice` xoá nhầm theo vị trí trên mảng mới. Đo thực tế: log admin vừa xoá (`L0`) **vẫn nằm trong archive**, còn log `L500` **bị mất hẳn** (không ở store, không ở archive).
4. **Ghi archive lỗi giữa chừng thì ghi lặp.** `rotateLogs` ghi theo từng tháng; tháng A ghi xong, tháng B lỗi → throw, log giữ nguyên trong store → lần sau tháng A bị ghi lại lần nữa.

## Logic cần đạt
1. **`flush()` luôn chờ ghi xong**:
   - Giữ một promise cho lần ghi đang chạy (`this.currentWrite`).
   - Nếu đang ghi: `await this.currentWrite`, sau đó nếu còn yêu cầu chờ hoặc dữ liệu đã đổi thì ghi thêm một lần nữa.
   - Promise của `flush()` chỉ resolve khi file trên đĩa đã chứa trạng thái tại thời điểm gọi `flush()`.
   - `shutdown()`: dừng nhận request mới (`server.close()`), `await storeManager.flush()`, rồi mới `process.exit(0)`. Có timeout an toàn 10 giây (quá hạn thì log lỗi và thoát mã 1). Gọi SIGTERM 2 lần không ghi 2 lần song song.
2. **413 đến được client**:
   - Khi vượt giới hạn: ngừng đọc body (không `push` thêm chunk), **không** `req.destroy()` trước khi gửi response.
   - Handler lỗi gửi 413 kèm header `Connection: close`. Chỉ đóng/huỷ socket **sau** khi response đã gửi (`res.on('finish')`), để client không phải gửi hết phần body còn lại.
   - Agent chọn cách cài đặt và ghi rõ trong báo cáo.
3. **Xoay vòng theo `id`, chống lặp**:
   - Chụp danh sách `id` cần archive trước khi `await`.
   - Sau khi ghi archive thành công, lọc `store.logs` (mảng **hiện tại** lúc đó) bỏ đúng các `id` đã archive, không `splice` theo vị trí.
   - Log đã bị admin xoá trong lúc chờ thì không được ghi vào archive. Chấp nhận cách đơn giản: trước khi ghi, kiểm lại `id` còn trong `store.logs`; ghi chú rõ trong báo cáo nếu còn khoảng hở.
   - Ghi archive theo kiểu "tất cả hoặc không": ghi toàn bộ nội dung các tháng vào file tạm rồi `appendFile` từng tháng; nếu một tháng lỗi thì **không** bỏ log nào khỏi store. Để tránh lặp ở lần sau, ghi kèm `id` và bỏ qua `id` đã có trong file archive cùng tháng, **hoặc** cách tương đương mà agent đề xuất (ghi rõ).
4. GIỮ NGUYÊN: route, format response, giới hạn mặc định (256 KB, `LOG_MAX_IN_STORE` 20.000, gộp 500 ms), mọi hành vi đã đạt ở F-8.

## Ràng buộc
- Chỉ sửa `server/store.mjs`, `server/http.mjs`, `server/index.mjs`, `server/__tests__/store.test.mjs`, `server/__tests__/http.test.mjs`.
- Không sửa frontend, không sửa `deploy/`. Không thêm dependency.
- Test dùng thư mục tạm (`fs.mkdtemp`) và dữ liệu giả.

## Tiêu chí hoàn thành
- K1: Store khoảng 200.000 log (đủ lớn để ghi mất thời gian). Gọi `flush()` lần 1; trong lúc đang ghi, sửa store; gọi `flush()` lần 2 → khi lần 2 resolve, file trên đĩa **chứa** thay đổi vừa sửa.
- K2: Test bằng `child_process`: server thật (DATA_FILE tạm, GUID giả), tạo thay đổi rồi gửi SIGTERM ngay → sau khi tiến trình thoát mã 0, file chứa thay đổi. Gửi SIGTERM 2 lần liên tiếp → không lỗi, không file `.tmp` sót lại.
- K3: HTTP server thật (`http.createServer` + `readJsonBody`): gửi body khoảng 640 KB theo từng chunk → client nhận **HTTP 413** với body `{"error":"Request body too large"}`, không phải `ECONNRESET`. Body 10 KB hợp lệ vẫn 200.
- K4: 1.500 log, `maxInStore=1000`, `appendFn` bị chặn tới khi test cho phép. Trong lúc chặn, xoá log `L0` và `L700` bằng cách gán `store.logs = store.logs.filter(...)` → sau khi xong: archive **không** có `L0`; `L500` có trong archive; tổng log ở store + archive = 1.498, mỗi `id` xuất hiện đúng 1 lần.
- K5: `appendFn` lỗi ở tháng thứ 2 → store giữ đủ log; chạy lại với `appendFn` bình thường → mỗi `id` chỉ xuất hiện 1 lần trong archive.
- K6: `npm run lint`, `npm test`, `npm run build` xanh; mọi test cũ pass.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path server/http.mjs -Pattern "req.destroy\(\)"
Select-String -Path server/store.mjs -Pattern "splice\(0, excess\)"
npm run lint; npm test; npm run build
git add server
git commit -m "fix(F-9): wait for in-flight write on shutdown, send 413 before closing, rotate logs by id"
git push -u origin fix/f9-store-shutdown-413-rotation
```
Kỳ vọng:
- `git diff --stat` chỉ có file trong Ràng buộc.
- 2 lệnh Select-String không có kết quả. Nếu vẫn còn `req.destroy()` thì nó chỉ được nằm trong handler `res.on('finish')`; giải thích trong báo cáo.
- lint/test/build xanh.

## Bước Z — BẮT BUỘC trước khi báo "done"
```powershell
git fetch origin
git ls-remote --heads origin fix/f9-store-shutdown-413-rotation
git rev-parse --short HEAD
git log --oneline -1 origin/fix/f9-store-shutdown-413-rotation
```
`git ls-remote` phải in **đúng 1 dòng** và SHA trùng `HEAD`. Rỗng hoặc lệch → **CHƯA XONG**: dán lỗi và dừng; không force-push, không push `main`.

## Báo cáo
Output Bước A, output `git push`, output Bước Z ở đầu, rồi theo `00_RULES.md` + bảng `K | tên test | pass` + cách đã chọn cho mục 2 và mục 3.
