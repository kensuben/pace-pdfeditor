# Prompt cho Antigravity — Word Comment Anonymizer + Deploy VPS

> Copy toàn bộ phần dưới đường kẻ vào Antigravity. Antigravity cần đọc thêm:
> `docs/word-anonymizer/01-PLAN.md` (kế hoạch, bảng vị trí dữ liệu định danh) và
> `docs/word-anonymizer/reference/deploy.dpadmin.sh` (script deploy mẫu để chuyển thể).

---

## VAI TRÒ & BỐI CẢNH

Bạn là senior full-stack engineer. Repo `pace-pdfeditor` là SPA React + TypeScript + Vite (PDF editor chạy tại trình duyệt), backend Node `server/index.mjs` (audit log + quản trị user, lưu JSON trong volume), đóng gói bằng nginx + node trong Docker.

Nhiệm vụ: thêm module **Word Comment Anonymizer** — ẩn danh người bình luận / người sửa (tracked changes) trong file `.docx` trước khi người dùng upload tài liệu lên ChatGPT, Claude… **Giữ nguyên nội dung tài liệu và nội dung comment**, chỉ loại bỏ thông tin định danh. Sau đó chuẩn bị CI + Docker Compose production + script deploy cho VPS.

Hãy **tự suy luận thiết kế chi tiết** trong khuôn khổ ràng buộc dưới đây. Khi gặp điểm không chắc về cấu trúc OOXML, ghi chú `// TODO(verify): …` và nêu trong báo cáo cuối, **không bịa** tên phần tử/thuộc tính.

Đọc trước khi code: `README.md`, `src/App.tsx` (phần topbar, `log()`, `recordActivity`), `src/api.ts`, `src/auth.ts`, `server/index.mjs`, `nginx.conf`, `Dockerfile`, `Dockerfile.api`, `compose.yaml`, `docs/word-anonymizer/01-PLAN.md`.

## RÀNG BUỘC BẮT BUỘC (vi phạm = không đạt)

1. **Xử lý 100% client-side.** File .docx, nội dung, tên tác giả **không** được gửi tới server/API/dịch vụ ngoài. Không thêm endpoint upload.
2. **Không log PII**: activity log chỉ chứa số lượng (`authorCount`, `commentCount`, `revisionCount`, `residualStatus`). Không có tên file, tên tác giả, email, nội dung. Đồng thời bỏ `fileName` khỏi các log PDF hiện có (`App.tsx` các action `document.opened`, `document.open_failed`, `document.exported`, `document.export_failed`, `signature.digital_completed`) — thay bằng `fileExt`/`fileSize` nếu cần.
3. **Không đọc/ghi file `.env*` thật**, không hard-code credential, client ID thật, email thật. Mọi ví dụ dùng dữ liệu giả rõ ràng: `Học viên Test 01`, `giangvien.test@example.com`.
4. **Không commit file .docx thật.** Fixture test phải được **dựng bằng code** (JSZip) trong test.
5. **Không đổi nội dung văn bản** (`w:t`) trừ các trường hợp tuỳ chọn được người dùng bật (mention, thay tên trong comment). Part không thay đổi → giữ nguyên bytes gốc.
6. XML xử lý **theo namespace URI** (`getAttributeNS`, `getElementsByTagNameNS`). Cấm regex dựa vào prefix `w:`. Chặn XML có `<!DOCTYPE` (chống XXE/entity expansion).
7. Không phá vỡ PDF editor hiện có; `npm run lint` và `npm run build` phải xanh.
8. Pin **version chính xác** (không `^`, không `latest`) cho dependency mới; ghi version vào báo cáo cuối.

## PHASE 0 — Chuẩn bị

- Thêm dependency: `jszip` (đã kiểm tra `3.10.2` là bản mới nhất trên npm — dùng bản này trừ khi `npm view` cho kết quả khác). Dev: `vitest`, `jsdom` (để có `DOMParser` khi test). Chạy `npm view <pkg> version` để lấy version, pin chính xác.
- Script `"test": "vitest run"`.
- Pin các dependency đang `"latest"` trong `package.json` về đúng version đang có trong `package-lock.json` (không nâng cấp).
- Sửa log `fileName` theo ràng buộc #2.

## PHASE 1 — Core (thư mục `src/word-anonymizer/core/`, không import React)

Module gợi ý: `constants.ts`, `zip.ts`, `xml.ts`, `inspect.ts`, `mapping.ts`, `anonymize.ts`, `residual.ts`, `types.ts`. Bạn có thể tổ chức khác nếu hợp lý hơn — giải thích trong báo cáo.

**API công khai tối thiểu:**

```ts
inspectDocx(input: ArrayBuffer): Promise<InspectionReport>
buildDefaultMapping(report: InspectionReport, labelPrefix?: string): IdentityMapping
anonymizeDocx(input: ArrayBuffer, mapping: IdentityMapping, options: AnonymizeOptions): Promise<AnonymizeResult> // { blob, report }
scanResidual(output: ArrayBuffer, identities: KnownIdentity[]): Promise<ResidualReport>
```

**Yêu cầu chức năng** (chi tiết vị trí dữ liệu: bảng mục 2 trong `01-PLAN.md`):

- Thu thập danh tính từ: `w:comment@w:author/@w:initials`, mọi phần tử có `@w:author` (namespace WordprocessingML) trong **tất cả** part XML dưới `word/` (gồm header/footer/footnotes/endnotes/glossary), `word/people.xml` (`w15:person@w15:author`, `w15:presenceInfo@w15:userId`), `docProps/core.xml` (`dc:creator`, `cp:lastModifiedBy`), `docProps/app.xml` (`Company`, `Manager`), đường dẫn `Users\<name>` hoặc `/Users/<name>` trong `.rels` và `settings.xml`, email trong `mailto:` của `word/_rels/comments.xml.rels`.
- **Gộp danh tính**: cùng một người có thể xuất hiện với `author` giống nhau ở comment, revision, people.xml → một nhãn. So khớp theo chuỗi author đã `trim` + NFC.
- Nhãn mặc định ổn định theo **thứ tự xuất hiện đầu tiên** trong `comments.xml` rồi đến revision: `Người góp ý 1`, initials `NG1`. Người dùng sửa được nhãn; validate nhãn không rỗng, không trùng nhau, không trùng tên thật.
- `AnonymizeOptions`: `removeDates` (mặc định false), `replaceMentions` (true), `replaceNamesInCommentText` (false), `scrubDocProps` (true), `customPropsPolicy: 'keep-sensitivity-labels' | 'keep-all' | 'remove-all'` (mặc định `keep-sensitivity-labels` — giữ `MSIP_Label_*`), `neutralFileName` (true).
- `people.xml`: đổi `w15:author`, **xoá** `w15:presenceInfo`.
- `core.xml`: `dc:creator`, `cp:lastModifiedBy` → `Anonymized`; xoá `cp:lastPrinted`. `app.xml`: rỗng `Company`, `Manager`, `HyperlinkBase`; `Template` → `Normal.dotm`.
- `removeDates`: xoá `@w:date` trên comment & revision, `@w16du:dateUtc`, `@w16cex:dateUtc` (đánh dấu TODO(verify) với namespace bạn không chắc).
- **Giữ nguyên** `commentsExtended.xml`, `commentsIds.xml` (quan hệ thread trả lời), `w:commentRangeStart/End`, `w:commentReference`.
- Thêm lại khai báo `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` cho part đã serialize.
- Cảnh báo (không sửa) khi có: `word/embeddings/*`, external target `file:///`, field `AUTHOR`/`USERNAME`/`LASTSAVEDBY`, `docProps/thumbnail.*`, `w:docVars`, `customXml/item*.xml` có chứa chuỗi danh tính.
- **Residual scan**: quét mọi entry text (`.xml`, `.rels`) của file **đầu ra** tìm tên đầy đủ, email, userId, username Windows — không phân biệt hoa thường, chuẩn hoá NFC và bỏ dấu (`normalize('NFD').replace(/\p{Diacritic}/gu,'')`, `đ→d`). Bỏ qua chuỗi ≤ 2 ký tự. Kết quả theo `part` + `count` + `category: 'metadata'|'comment-text'|'body-text'`. `status`: `FAIL` nếu còn trong metadata/thuộc tính, `WARN` nếu chỉ còn trong nội dung text, `PASS` nếu sạch.
- **An toàn ZIP**: input ≤ 50 MB; tổng uncompressed ≤ 300 MB (kiểm tra trong lúc giải nén, không tin header); ≤ 2.000 entry; từ chối path có `..`, bắt đầu bằng `/` hoặc `\`. Từ chối nếu không có `[Content_Types].xml` hoặc `word/document.xml`. Phát hiện `.docm`/`vbaProject.bin` → từ chối với thông báo tiếng Việt. Phát hiện file mã hoá (OLE CFB, magic `D0 CF 11 E0`) → thông báo "File đặt mật khẩu hoặc định dạng .doc cũ".
- Lỗi trả về dạng `AnonymizerError` có `code` (vd. `NOT_DOCX`, `TOO_LARGE`, `ZIP_BOMB`, `MACRO_ENABLED`, `ENCRYPTED_OR_LEGACY`, `INVALID_XML`) + message tiếng Việt.

## PHASE 1 — Unit test (`src/word-anonymizer/__tests__/`)

Viết helper dựng .docx tối thiểu hợp lệ bằng JSZip (Content_Types, _rels, document.xml, comments.xml, people.xml, core.xml, app.xml…). Tối thiểu các case:

| ID | Case | Kỳ vọng |
|---|---|---|
| T01 | 2 tác giả comment, 3 comment | author/initials → `Người góp ý 1/2`, `NG1/NG2`; nội dung `w:t` không đổi |
| T02 | Comment trả lời (commentsExtended có `paraIdParent`) | File `commentsExtended.xml` giữ nguyên byte |
| T03 | Tracked changes `w:ins`/`w:del`/`w:rPrChange` trong document, header, footnotes | Mọi `w:author` đã thay; cùng người với comment → cùng nhãn |
| T04 | Prefix namespace khác (`ns0:` thay `w:`) | Vẫn xử lý đúng |
| T05 | `people.xml` có `presenceInfo` chứa email | `presenceInfo` bị xoá; residual PASS |
| T06 | `core.xml` creator/lastModifiedBy, `app.xml` Company | Đã làm sạch |
| T07 | `custom.xml` có `MSIP_Label_x_Enabled` + `ReviewerEmail` | Giữ MSIP, xoá ReviewerEmail (policy mặc định) |
| T08 | Mention: rels `mailto:` + run `@Học viên Test 01` | Thay khi `replaceMentions=true`; giữ khi false |
| T09 | `removeDates=true` | Không còn `w:date` |
| T10 | Tên tác giả nằm trong text comment, option tắt | Text giữ nguyên, residual = WARN, category `comment-text` |
| T11 | Tên có dấu / khác hoa thường | Residual phát hiện được |
| T12 | Zip có entry `../evil.xml` | Lỗi `NOT_DOCX` hoặc mã tương ứng |
| T13 | Zip bomb (entry giải nén > giới hạn) | Lỗi `ZIP_BOMB`, không treo |
| T14 | Có `vbaProject.bin` | `MACRO_ENABLED` |
| T15 | XML có `<!DOCTYPE` | `INVALID_XML` |
| T16 | File không có comment/revision | Chạy được, report 0 tác giả, file đầu ra mở lại được |
| T17 | Idempotent: chạy 2 lần trên output | Lần 2 không đổi gì thêm, residual PASS |
| T18 | Part không liên quan (ảnh, `styles.xml` không có revision) | Byte giữ nguyên |

## PHASE 2 — UI

- `src/word-anonymizer/WordAnonymizerPage.tsx` + `word-anonymizer.css`, theo design token đang có (`pace-theme.css`), tiếng Việt, responsive.
- Điều hướng: switcher trên topbar "PDF Editor | Ẩn danh Word", đồng bộ với hash `#/word-anonymizer`. Không thêm thư viện router.
- Bắt buộc đăng nhập Microsoft (đã có `account`/`apiUser` trong `App.tsx`); chưa đăng nhập → hiển thị yêu cầu đăng nhập.
- Bước: chọn/kéo-thả → bảng xem trước người tham gia (nhãn sửa được, số comment, số revision, cờ "có email/presence") + danh sách cảnh báo → tuỳ chọn → "Ẩn danh" → báo cáo residual PASS/WARN/FAIL → tải file.
- `FAIL` → nút tải bị khoá, kèm checkbox "Tôi đã hiểu rủi ro" để mở khoá.
- Tên file tải về: mặc định `document_anonymized.docx`; tuỳ chọn giữ tên gốc + `_anonymized`.
- Tuỳ chọn "Tải file mapping (JSON)" mặc định tắt, hiển thị cảnh báo: *"File mapping chứa tên thật — chỉ lưu nội bộ, không upload lên công cụ AI."*
- Nút "Xoá khỏi bộ nhớ" → reset state, `URL.revokeObjectURL`.
- Hiển thị dòng nhắc: *"Kiểm tra lại nội dung tài liệu trước khi upload — công cụ không ẩn danh tên người trong thân văn bản."*
- Log `word_anonymizer.completed` / `word_anonymizer.failed` (chỉ số lượng + error code).

## PHASE 3 — CI + Docker production + deploy VPS

Chuyển thể `docs/word-anonymizer/reference/deploy.dpadmin.sh` (script của dự án khác: Laravel + MySQL). Giữ triết lý: **CI chỉ đẩy `:latest` khi build + test xanh; VPS không build; rollback theo tag `sha-<7>`; đọc commit đang chạy từ label `org.opencontainers.image.revision`; APP_TAG truyền qua dòng lệnh, không sửa file env.**

1. `.github/workflows/docker-publish.yml`
   - Trigger: push `main` + `workflow_dispatch`. Job 1: `npm ci`, `npm run lint`, `npm test`, `npm run build`. Job 2 (needs job 1): build & push 2 image lên GHCR: `ghcr.io/<owner>/pace-pdfeditor-web` (Dockerfile) và `ghcr.io/<owner>/pace-pdfeditor-api` (Dockerfile.api), tag `latest` + `sha-<7 ký tự>`, label `org.opencontainers.image.revision=${{ github.sha }}`. Owner viết thường.
   - Build arg `VITE_MICROSOFT_CLIENT_ID`, `VITE_MICROSOFT_TENANT_ID`, `VITE_SIGNING_API_URL`, `VITE_USB_SIGNING_AGENT_URL` lấy từ `${{ vars.* }}` (GitHub Variables, không phải Secrets — đây là giá trị public của SPA).
   - `permissions: contents: read, packages: write`. Dùng `GITHUB_TOKEN`, không PAT.
   - Dùng action chính thức `actions/checkout`, `actions/setup-node`, `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, `docker/build-push-action` — pin major version hiện hành và ghi rõ trong báo cáo (kiểm tra trên GitHub Marketplace).
2. `deploy/docker-compose.prod.yml`
   - Service **`web`** (nginx SPA, image web `${APP_TAG:-latest}`, healthcheck `/healthz` như hiện tại, read_only + tmpfs + cap_drop như `compose.yaml`), port `${APP_PORT:-8080}` bind `127.0.0.1` mặc định (có thể override `APP_BIND`).
   - Service **`app`** (API Node, image api `${APP_TAG:-latest}`), network alias **`api`** để `nginx.conf` giữ `proxy_pass http://api:3001`, healthcheck `wget -qO- http://127.0.0.1:3001/healthz`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, volume `/data`.
   - `web.depends_on.app.condition: service_healthy`.
   - Volume `paperly_data`: khai báo `name: ${DATA_VOLUME:-pace-pdfeditor_paperly_data}` để **dùng lại volume cũ** đang có trên VPS (ghi chú rõ trong README cách kiểm tra bằng `docker volume ls`).
   - Env cho `app`: `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID`, `ADMIN_EMAILS`, `DATA_FILE`.
3. `deploy/.env.production.example` — chỉ tên biến + giá trị giả (`00000000-0000-0000-0000-000000000000`, `admin.test@example.com`). Thêm `deploy/.env.production` vào `.gitignore`. Thêm `GHCR_OWNER`/image name nếu bạn tham số hoá.
4. `scripts/deploy.sh` (bash, `set -euo pipefail`, giữ 3 lệnh `deploy | rollback | status`, giữ các hàm `running_revision`, `wait_healthy`, `start_tag`, mốc rollback `.deploy/previous`, `.deploy/history.log`):
   - `PROJECT` mặc định `pace-pdf`; `COMPOSE_FILES` mặc định `-f deploy/docker-compose.prod.yml --env-file deploy/.env.production`.
   - Thay `db_ping` bằng `api_ping`: `dc exec -T app wget -qO- http://127.0.0.1:3001/healthz`.
   - Bỏ ghi chú Laravel/migrate. Dòng "Kiểm tay" cuối: *đăng nhập Microsoft, mở 1 PDF, ẩn danh 1 file .docx mẫu, mở Administration (admin)*.
   - Kiểm tra trước khi chạy: `docker`, `docker compose`, file env tồn tại (chỉ `[ -f ]`, **không** đọc nội dung).
5. `scripts/backup.sh`: tar.gz volume dữ liệu qua `docker run --rm -v <volume>:/data:ro -v <backup_dir>:/backup alpine:<pin> tar czf …`; thư mục `backups/` `chmod 700`; giữ `BACKUP_KEEP` bản mới nhất (mặc định 14); thêm `backups/` vào `.gitignore`. Script phải chạy được lần đầu khi volume chưa tồn tại (log cảnh báo, không fail).
6. `chmod +x scripts/*.sh`; chạy `bash -n` và `shellcheck` (nếu có) cho cả 2 script.
7. README: mục "Deploy production (VPS)" — chuẩn bị lần đầu (clone repo, `docker login ghcr.io` bằng PAT `read:packages` do người vận hành tự tạo, tạo `deploy/.env.production` từ example, xác định volume cũ), lệnh deploy/rollback/status, cách khôi phục backup. Thêm mục "Ẩn danh Word" mô tả tính năng + giới hạn.

Giữ `compose.yaml` cũ cho dev local (không xoá).

## ĐỊNH NGHĨA HOÀN THÀNH

- `npm run lint`, `npm test`, `npm run build` xanh; dán output tóm tắt.
- `docker build` cả 2 Dockerfile thành công; `docker compose -f deploy/docker-compose.prod.yml config` hợp lệ với file env example.
- Mọi test T01–T18 pass.
- Mở thử file đầu ra từ test bằng `unzip -t` (zip hợp lệ).

## BÁO CÁO CUỐI (bắt buộc)

1. Danh sách file tạo/sửa + lý do.
2. Version chính xác các dependency/action mới.
3. Quyết định thiết kế khác với `01-PLAN.md` (nếu có) và lý do.
4. Danh sách `TODO(verify)` về cấu trúc OOXML chưa chắc chắn.
5. Rủi ro bảo mật còn lại.
6. Hướng dẫn tạo bộ file Word thật để QA thủ công (không đính kèm file thật).

Không tạo pull request, không push lên `main`. Commit trên nhánh làm việc với message rõ ràng.
