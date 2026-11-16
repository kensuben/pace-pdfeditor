# Word Comment Anonymizer — Kế hoạch triển khai

> Trạng thái: **PLANNING** · Người viết: Claude Code (AI) · Người duyệt: DIGITECH
> Tài liệu này chỉ là kế hoạch. Code sẽ do Antigravity viết theo các prompt trong `docs/planning/antigravity/` (`00_RULES.md`, W-0 → W-3), sau đó QA theo `03-QA-CHECKLIST.md`.

---

## 0. Tóm tắt

| Hạng mục | Quyết định |
|---|---|
| Vị trí | Module mới trong SPA hiện tại (`pace-pdfeditor`), không tách repo |
| Xử lý file | **100% tại trình duyệt** (giống PDF editor) — file .docx **không** gửi lên server |
| Đầu vào | `.docx` (Office Open XML). Không hỗ trợ `.doc` nhị phân, `.docm` (macro) → từ chối, hướng dẫn Save As `.docx` |
| Đầu ra | `.docx` đã ẩn danh + báo cáo kiểm tra rò rỉ (hiển thị trên màn hình) + (tuỳ chọn) file mapping JSON |
| Nguyên tắc | Chỉ sửa **thuộc tính định danh và metadata**; không đổi nội dung văn bản/comment (trừ khi người dùng bật tuỳ chọn) |
| Log | Chỉ ghi **số lượng** (số comment, số tác giả, số revision). Không ghi tên tác giả, tên file, nội dung |
| Deploy | CI build image → GHCR (`latest` + `sha-<7>`) → VPS chạy `scripts/deploy.sh` (chuyển thể từ file deploy mẫu của dpadmin) |

---

## 1. Dữ kiện — Giả định — Đề xuất

### 1.1 Dữ kiện (đã kiểm tra trong repo, nhánh hiện tại)

- Frontend: React + TypeScript + Vite, gần như toàn bộ logic nằm trong `src/App.tsx` (~55 KB, 1 component lớn). Không có router.
- Backend: `server/index.mjs` — Node `http` thuần, lưu JSON vào `/data/store.json` (volume `paperly_data`), xác thực bằng **id_token** Microsoft qua `jose`.
- Docker: `Dockerfile` (build Vite → nginx:1.30.3-alpine, port 8080), `Dockerfile.api` (node:22-alpine, port 3001), `compose.yaml` build tại chỗ (service `paperly` + `api`).
- nginx proxy `/api/` → `http://api:3001`; CSP chặt (`script-src 'self' https://cdn.jsdelivr.net`, `worker-src 'self' blob: …`).
- Không có test framework, không có CI (`.github/` không tồn tại).
- `package.json` dùng `"latest"` cho nhiều dependency.
- Activity log hiện ghi `fileName` của PDF lên server (`App.tsx:348, 352, 427, 428, 552`).
- File `deploy.sh` mẫu thuộc dự án khác (dpadmin, Laravel + MySQL): kéo image `:latest` từ registry, rollback theo tag `sha-<7>`, đọc label `org.opencontainers.image.revision` từ container `<project>-app-1`, health check container `<project>-web-1`.

### 1.2 Giả định (cần anh/chị xác nhận)

- A1. Người dùng là nhân sự nội bộ PACE, file chủ yếu tạo bằng Word 2016/365 (Windows/Mac). Có cả comment hiện đại (threaded, @mention).
- A2. Repo trên GitHub là `kensuben/pace-pdfeditor`; registry dùng **GHCR**; VPS đã có Docker Compose v2 và reverse proxy HTTPS phía trước port 8080.
- A3. VPS hiện đang chạy bằng `compose.yaml` cũ (project name = tên thư mục) → có volume dữ liệu cũ cần giữ.
- A4. Microsoft Client ID không phải secret (SPA public client) → được phép để trong GitHub **Variables** cho CI build.

### 1.3 Đề xuất quyết định (mặc định nếu anh/chị không phản hồi)

| # | Câu hỏi | Mặc định đề xuất | Lý do |
|---|---|---|---|
| D1 | Có bắt buộc đăng nhập Microsoft mới dùng Anonymizer? | **Có** (user active trong allowlist) | Công cụ xử lý tài liệu nội bộ; PDF editor hiện cho dùng không cần login — nên thống nhất lại |
| D2 | Nhãn ẩn danh | `Người góp ý 1`, `Người góp ý 2`… (initials `NG1`) — cho phép sửa tay thành vai trò (vd. `Giảng viên A`) | Giữ được ngữ cảnh "ai trả lời ai" cho AI phân tích |
| D3 | Ngày giờ comment/revision | Mặc định **giữ**, có tuỳ chọn "Xoá ngày giờ" | Ngày giờ ít khi định danh, nhưng có thể dùng suy luận |
| D4 | Tên người xuất hiện **trong nội dung** comment (vd. "Anh Nam xem lại") | Mặc định **không sửa**, chỉ cảnh báo trong báo cáo; có tuỳ chọn bật thay thế | Đúng mục tiêu "giữ nguyên nội dung"; tránh sửa sai |
| D5 | @mention trong comment hiện đại | Mặc định **thay** (text + link `mailto:`) | Mention chứa email → định danh trực tiếp |
| D6 | File mapping (tên thật ↔ nhãn) | Mặc định **tắt**; bật thì tải về máy, cảnh báo đây là dữ liệu cá nhân | Là "khoá giải ẩn danh" |
| D7 | Custom properties (`docProps/custom.xml`) | Xoá tất cả **trừ** `MSIP_Label_*` (nhãn Sensitivity của Microsoft Purview) | Xoá nhãn bảo mật có thể vi phạm chính sách DLP |

---

## 2. Thông tin định danh nằm ở đâu trong file .docx

`.docx` là file ZIP chứa nhiều phần XML. Bảng dưới là phạm vi xử lý. Cột "Độ chắc chắn" phản ánh mức hiểu biết của AI viết kế hoạch — mục **chưa xác minh** phải được kiểm tra bằng file Word thật trước khi chốt.

| Part | Phần tử / thuộc tính | Xử lý | Độ chắc chắn |
|---|---|---|---|
| `word/comments.xml` | `w:comment/@w:author`, `@w:initials`, `@w:date` | Thay author/initials theo mapping; date theo D3 | Chắc chắn (ECMA-376) |
| `word/people.xml` | `w15:person/@w15:author`, `w15:presenceInfo/@w15:providerId`, `@w15:userId` (thường chứa email/SID) | Đổi `author` theo mapping, **xoá** `w15:presenceInfo` | Chắc chắn về tồn tại; cấu trúc `userId` chưa xác minh trên mọi phiên bản |
| Mọi part trong `word/` (document, header*, footer*, footnotes, endnotes, comments, numbering, styles, glossary/…) | Revision: `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, `w:moveFromRangeStart`, `w:moveToRangeStart`, `w:rPrChange`, `w:pPrChange`, `w:sectPrChange`, `w:tblPrChange`, `w:tblGridChange`, `w:trPrChange`, `w:tcPrChange`, `w:cellIns`, `w:cellDel`, `w:cellMerge`, `w:numberingChange`, `w:customXmlInsRangeStart`, `w:customXmlDelRangeStart`… → `@w:author`, `@w:date` | **Quét mọi phần tử có `w:author` trong namespace WordprocessingML**, không liệt kê cứng | Chắc chắn |
| Các part trên | `@w16du:dateUtc` (Word 365 mới) | Xoá nếu bật "Xoá ngày giờ" | **Chưa xác minh** |
| `word/commentsExtended.xml`, `commentsIds.xml`, `commentsExtensible.xml` | `paraId`, `paraIdParent`, `durableId`, `w16cex:dateUtc` | **Giữ nguyên** quan hệ thread; chỉ xử lý `dateUtc` theo D3 | Tồn tại chắc chắn; thuộc tính cụ thể cần đối chiếu file thật |
| `word/_rels/comments.xml.rels` | Hyperlink `Target="mailto:…"` của @mention | Thay bằng `mailto:nguoi-gop-y-1@anonymized.invalid` | **Chưa xác minh** cấu trúc mention trên file thật |
| `word/comments.xml` | Run text của mention (`@Nguyễn Văn A`) | Thay bằng `@<nhãn>` theo D5 | **Chưa xác minh** (tên có thể bị tách nhiều run) |
| `docProps/core.xml` | `dc:creator`, `cp:lastModifiedBy`, `cp:lastPrinted` | creator/lastModifiedBy → `Anonymized`; xoá `lastPrinted` | Chắc chắn |
| `docProps/app.xml` | `Company`, `Manager`, `HyperlinkBase`, `Template` | Làm rỗng; `Template` → `Normal.dotm` | Chắc chắn |
| `docProps/custom.xml` | Custom properties | Theo D7 | Chắc chắn |
| `customXml/item*.xml` | Metadata SharePoint (trường Person: DisplayName, AccountId…) | Thay chuỗi trùng danh tính đã biết + báo cáo | Cấu trúc thay đổi theo site — **chưa xác minh** |
| `word/settings.xml` + `word/_rels/settings.xml.rels` | `w:attachedTemplate` → đường dẫn `file:///C:/Users/<tên>/…`; `w:docVars` | Làm sạch đường dẫn chứa `Users\<x>` / `/Users/<x>`; báo cáo docVars | Chắc chắn về tồn tại |
| `word/_rels/*.rels` | Target external `file:///…` (ảnh/OLE link) | Chỉ **cảnh báo** (không sửa — có thể làm hỏng liên kết) | Chắc chắn |
| `word/embeddings/*` | File Office nhúng (xlsx/docx) có metadata riêng | Chỉ **cảnh báo** ở phase 1 | Chắc chắn |
| `docProps/thumbnail.*` | Ảnh xem trước trang đầu | Giữ, cảnh báo nếu có | Chắc chắn |
| Thân tài liệu | Field `AUTHOR`, `USERNAME`, `LASTSAVEDBY` (`w:fldSimple`, `w:instrText`) — giá trị đã render là tên người | Cảnh báo; có tuỳ chọn thay giá trị render | Chắc chắn về field; cách thay cần thử nghiệm |

### Kiểm tra rò rỉ (Residual scan) — bắt buộc

Sau khi ẩn danh, mở lại file **đầu ra** và tìm toàn bộ chuỗi danh tính đã thu thập (tên đầy đủ, email, userId, tên người dùng Windows trong đường dẫn) trong **mọi** part XML/rels, so khớp không phân biệt hoa thường và có chuẩn hoá Unicode (NFC + bỏ dấu tiếng Việt). Initials ngắn (≤2 ký tự) **không** quét toàn văn để tránh báo động giả.

Kết quả hiển thị: `part` + số lần xuất hiện + loại (metadata / nội dung comment / thân tài liệu). Nếu còn rò rỉ trong metadata → đánh dấu **FAIL**, không cho tải trừ khi người dùng xác nhận.

---

## 3. Kiến trúc đề xuất

```
src/
  word-anonymizer/
    WordAnonymizerPage.tsx     # UI: chọn file → xem trước → tuỳ chọn → chạy → tải về + báo cáo
    word-anonymizer.css
    core/
      constants.ts             # namespace URI, giới hạn kích thước
      zip.ts                   # đọc/ghi zip an toàn (giới hạn, chống zip bomb)
      xml.ts                   # parse/serialize namespace-aware, chặn DOCTYPE
      inspect.ts               # thu thập danh tính + thống kê (không sửa)
      mapping.ts               # tạo nhãn ẩn danh ổn định theo thứ tự xuất hiện
      anonymize.ts             # áp dụng mapping + tuỳ chọn
      residual.ts              # quét rò rỉ trên file đầu ra
      types.ts
    __tests__/
      fixtures.ts              # dựng .docx giả bằng JSZip trong test (không commit file thật)
      *.test.ts
```

- **Core thuần TypeScript, không phụ thuộc React** → test được độc lập, sau này có thể chạy trong Web Worker hoặc CLI.
- **XML**: dùng `DOMParser`/`XMLSerializer` của trình duyệt, thao tác bằng `getAttributeNS`/`getElementsByTagNameNS` theo **namespace URI**, không dùng regex trên prefix `w:` (prefix không bắt buộc là `w`).
  - Lưu ý: `DOMParser` **không có trong Web Worker** → phase 1 chạy trên main thread (tài liệu thông thường < vài MB XML là đủ nhanh). Nếu cần Worker thì phải dùng `@xmldom/xmldom` — để phase 2.
  - `XMLSerializer` bỏ khai báo `<?xml …?>` → phải thêm lại `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`.
  - Part nào **không thay đổi** thì giữ nguyên bytes gốc (không parse/serialize lại).
- **ZIP**: `jszip@3.10.2` (bản mới nhất trên npm tại thời điểm lập kế hoạch). Giới hạn: file vào ≤ 50 MB, tổng giải nén ≤ 300 MB, ≤ 2.000 entry, từ chối entry có `..` hoặc đường dẫn tuyệt đối.
- **Điều hướng**: thêm switcher trên topbar "PDF Editor | Ẩn danh Word" bằng state + hash (`#/word-anonymizer`), không thêm thư viện router.
- **Log**: action `word_anonymizer.completed` với metadata `{ authorCount, commentCount, revisionCount, residualStatus }` — **không** có fileName, tên tác giả.

### Luồng người dùng

1. Chọn/kéo-thả `.docx` → kiểm tra định dạng & giới hạn.
2. **Xem trước**: danh sách người tham gia (tên, số comment, số revision, có email/presence hay không), cảnh báo (file nhúng, đường dẫn local, field AUTHOR, custom properties).
3. Chỉnh nhãn ẩn danh (mặc định `Người góp ý N`) + tuỳ chọn (D3–D7).
4. Chạy → residual scan → báo cáo PASS/WARN/FAIL.
5. Tải `<tên-gốc-đã-làm-sạch>_anonymized.docx` (tuỳ chọn đặt tên trung tính `document_anonymized.docx` — mặc định bật, vì tên file hay chứa tên người).
6. Nút "Xoá khỏi bộ nhớ" — giải phóng ArrayBuffer/Blob URL.

---

## 4. Review codebase hiện tại — phát hiện liên quan

Mức độ: 🔴 Cao · 🟠 Trung bình · 🟡 Thấp. Đây là phát hiện từ đọc code, **chưa chạy thử exploit**.

| # | Mức | Vị trí | Vấn đề | Đề xuất |
|---|---|---|---|---|
| R1 | 🔴 | `server/index.mjs` `identity()` | `jwtVerify` chỉ kiểm `audience`, **không kiểm `issuer`/`tid`**. Khoá ký của Entra dùng chung giữa các tenant → token hợp lệ từ tenant khác (cùng client ID nếu app multi-tenant) vẫn qua; phân quyền dựa trên `preferred_username` là claim có thể thay đổi, Microsoft khuyến cáo không dùng để phân quyền | Kiểm `tid` == tenant PACE và `iss`; định danh bằng `oid`+`tid`; email chỉ để hiển thị/khớp allowlist lần đầu. Kiểm tra tài liệu Microsoft identity platform "Validate tokens" / "claims" |
| R2 | 🟠 | `src/auth.ts` `getMicrosoftToken` | Gửi **id_token** làm bearer cho API (id_token dành cho client, không phải API) | Phase sau: expose API scope trên App Registration, dùng access token |
| R3 | 🟠 | `server` POST/PATCH `/api/admin/users` | `Object.assign(item, input)` — mass assignment (ghi đè `id`, `createdAt`, field tuỳ ý); admin có thể tự hạ quyền/khoá chính mình → mất admin cuối | Whitelist field `name, role, active, groupIds`; chặn bỏ admin cuối cùng |
| R4 | 🟠 | `server` `body()` | Không giới hạn kích thước, JSON lỗi → 500 | Giới hạn 256 KB (khớp nginx), trả 400 khi JSON sai |
| R5 | 🟠 | `server` store | `logs` tăng vô hạn, mỗi heartbeat (30 s/user) ghi lại **toàn bộ** `store.json` | Giới hạn/rotate log, debounce save; dài hạn chuyển SQLite/PostgreSQL |
| R6 | 🟠 | `App.tsx:348,352,427,428,552` | Log `fileName` lên server — tên file thường chứa tên học viên/khách hàng (PII) | Bỏ `fileName` hoặc thay bằng phần mở rộng + kích thước |
| R7 | 🟠 | `package.json` | Nhiều dependency `"latest"` → build không tái lập nếu lockfile bị tạo lại | Pin version chính xác theo lockfile hiện tại |
| R8 | 🟡 | `ActivityPanel.tsx` | Mỗi event `paperly-activity` gọi lại GET toàn bộ log (zoom/chuyển trang liên tục → bão request) | Debounce hoặc prepend entry local |
| R9 | 🟡 | `compose.yaml` service `api` | Không `read_only`, `cap_drop`, healthcheck | Bổ sung trong compose production |
| R10 | 🟡 | `App.tsx` | Nút Rotate là placeholder | Ẩn hoặc làm thật |

> Phạm vi task này: **chỉ sửa R6** (vì liên quan trực tiếp nguyên tắc ẩn danh) và các mục cần cho deploy (R7, R9). R1–R5, R8 nên tách ticket riêng — R1 nên làm sớm.

---

## 5. Triển khai Docker / VPS (chuyển thể từ `deploy.sh` mẫu)

### 5.1 Khác biệt với dự án dpadmin

| deploy.sh mẫu (dpadmin) | pace-pdfeditor |
|---|---|
| Có MySQL, `db_ping` | Không có DB — dữ liệu là `/data/store.json` trong volume |
| `scripts/backup.sh` backup DB + file | Backup volume `paperly_data` (tar.gz) |
| Container `app` + `web` | Đổi tên service: `app` = API Node, `web` = nginx SPA (giữ nguyên hàm `running_revision`, `wait_healthy`) |
| — | nginx gọi `http://api:3001` → thêm network alias `api` cho service `app` (không cần sửa `nginx.conf`) |
| Biến build-time | `VITE_MICROSOFT_*` được nhúng lúc build → CI lấy từ GitHub **Variables** |

### 5.2 File cần tạo

- `.github/workflows/docker-publish.yml` — push `main`: `npm ci` → `lint` → `test` → `build` → build 2 image, push GHCR với tag `latest` + `sha-<7>`, label `org.opencontainers.image.revision`. **Chỉ push `latest` khi tất cả bước xanh.**
- `deploy/docker-compose.prod.yml` — dùng `image:` (không `build:`), tag `${APP_TAG:-latest}`.
- `deploy/.env.production.example` — tên biến, giá trị giả. File thật `deploy/.env.production` do anh/chị tự tạo trên VPS, đã có trong `.gitignore`.
- `scripts/deploy.sh` — giữ cấu trúc file mẫu: `deploy | rollback | status`.
- `scripts/backup.sh` — backup volume, giữ N bản gần nhất, `chmod 700` (store.json chứa email người dùng).
- Cập nhật README mục Deploy.

### 5.3 Rủi ro khi chuyển đổi

- ⚠️ **Mất dữ liệu volume**: đổi project name → Docker tạo volume mới rỗng. Trước lần deploy đầu, chạy `docker volume ls` trên VPS để biết tên volume cũ, rồi khai báo trong compose prod `volumes.paperly_data.name: <tên cũ>` (external) hoặc copy dữ liệu sang volume mới.
- ⚠️ GHCR package private → VPS phải `docker login ghcr.io` bằng PAT `read:packages` (anh/chị tự làm, không đưa token vào repo/chat).
- ⚠️ Port: compose prod nên bind `127.0.0.1:8080:8080` nếu đã có reverse proxy trên host.

---

## 6. Phân pha & ước lượng

| Pha | Nội dung | Ước lượng (AI code + người review) |
|---|---|---|
| P0 | Pin dependency, thêm vitest, sửa R6 | 0,5 ngày |
| P1 | Core: zip/xml/inspect/mapping/anonymize/residual + unit test | 2 ngày |
| P2 | UI + tích hợp log + điều hướng | 1 ngày |
| P3 | CI + compose prod + deploy/backup script | 1 ngày |
| P4 | QA với bộ file Word thật (ẩn danh sẵn) trên Word Win/Mac + LibreOffice | 1 ngày |

Ước lượng mang tính tham khảo, chưa tính thời gian chờ duyệt.

## 7. Ngoài phạm vi phase 1

`.doc`/`.docm`/`.odt`; Excel/PowerPoint comments; tự động "giải ẩn danh" câu trả lời của AI; xử lý file nhúng; Web Worker; ẩn danh tên người trong thân tài liệu bằng NER.
