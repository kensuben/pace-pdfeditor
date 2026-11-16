# [W-1] Word Anonymizer: core xử lý .docx + unit test (chưa có UI)

Đọc `docs/planning/antigravity/00_RULES.md` trước khi làm. Đọc thêm `docs/word-anonymizer/01-PLAN.md` mục 2 (vị trí dữ liệu định danh trong .docx).
Tiền điều kiện: W-0 đã merge vào `main` (cần Vitest + jsdom).
Nhánh: `feat/w1-docx-anonymizer-core` (tạo từ `main`) · Commit: `feat(W-1): docx comment anonymizer core with residual scan`
Được tự commit + push nhánh này. KHÔNG push `main`, KHÔNG force-push.
**Chỉ báo "done" khi đã chạy `git push` và `git log --oneline -1 origin/feat/w1-docx-anonymizer-core` in ra đúng commit vừa tạo – dán 2 output này ở ĐẦU báo cáo.**

## Bước 0 (PowerShell)
Chạy **Bước A** trong `00_RULES.md` trước (repo bẩn hoặc `main` lệch `origin/main` → dừng, báo lại). Sau đó:
```powershell
git checkout main
git pull --ff-only
git checkout -b feat/w1-docx-anonymizer-core
npm ci
npm view jszip version
```

## Vấn đề
Người dùng PACE upload file Word có comment/tracked changes lên ChatGPT, Claude… Trong file .docx (bản chất là ZIP chứa XML), tên và email người góp ý nằm ở nhiều chỗ: `w:author`/`w:initials` của comment, `w:author` của mọi revision trong mọi part, `word/people.xml` (`presenceInfo` chứa email/userId), `docProps/core.xml`, `docProps/app.xml`, `docProps/custom.xml`, link `mailto:` của @mention, đường dẫn `C:\Users\<tên>` trong `.rels`/`settings.xml`. Cần thư viện thuần TypeScript, chạy trên trình duyệt, ẩn danh các chỗ này mà **giữ nguyên nội dung văn bản và comment**.

## Logic cần đạt
1. Thư mục `src/word-anonymizer/core/`, **không import React**. API công khai tối thiểu:
   ```ts
   inspectDocx(input: ArrayBuffer): Promise<InspectionReport>
   buildDefaultMapping(report: InspectionReport): IdentityMapping
   anonymizeDocx(input: ArrayBuffer, mapping: IdentityMapping, options: AnonymizeOptions): Promise<AnonymizeResult> // { blob, report }
   scanResidual(output: ArrayBuffer, identities: KnownIdentity[]): Promise<ResidualReport>
   ```
2. **Thu thập danh tính** từ các vị trí ở bảng mục 2 `01-PLAN.md`. Quét `@w:author` trên **mọi** phần tử, **mọi** part XML dưới `word/` (document, header*, footer*, footnotes, endnotes, comments, numbering, styles, glossary/…), không liệt kê cứng tên phần tử revision.
3. **Mapping**: cùng chuỗi author (trim + NFC) → một người. Nhãn mặc định theo thứ tự xuất hiện đầu tiên (comments.xml trước, revision sau): `Người góp ý 1`, initials `NG1`. Validate nhãn: không rỗng, không trùng nhau, không trùng tên thật.
4. **`AnonymizeOptions`** và mặc định:

   | Option | Mặc định | Hành vi |
   |---|---|---|
   | `removeDates` | `false` | Xoá `@w:date`, `@w16du:dateUtc`, `@w16cex:dateUtc` |
   | `replaceMentions` | `true` | Thay `mailto:` trong `word/_rels/comments.xml.rels` bằng `mailto:nguoi-gop-y-N@anonymized.invalid` và run text `@<tên>` thành `@<nhãn>` |
   | `replaceNamesInCommentText` | `false` | Thay tên đầy đủ xuất hiện trong `w:t` của `comments.xml` |
   | `scrubDocProps` | `true` | `dc:creator`, `cp:lastModifiedBy` → `Anonymized`; xoá `cp:lastPrinted`; rỗng `Company`, `Manager`, `HyperlinkBase`; `Template` → `Normal.dotm` |
   | `customPropsPolicy` | `'keep-sensitivity-labels'` | Xoá custom property trừ `MSIP_Label_*`; `'keep-all'` / `'remove-all'` |

5. `word/people.xml`: đổi `w15:author` theo mapping, **xoá** phần tử `w15:presenceInfo`.
6. **Giữ nguyên byte**: `commentsExtended.xml`, `commentsIds.xml`, và mọi part không bị thay đổi (ảnh, styles không có revision…). Part bị sửa: serialize lại + thêm `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`.
7. **Cảnh báo (không sửa)**: `word/embeddings/*`, target external `file:///`, field `AUTHOR`/`USERNAME`/`LASTSAVEDBY`, `docProps/thumbnail.*`, `w:docVars`, `customXml/item*.xml` có chứa chuỗi danh tính.
8. **Residual scan** trên file **đầu ra**: tìm tên, email, userId, username Windows trong mọi entry `.xml`/`.rels`. Không phân biệt hoa thường, chuẩn hoá NFC + bỏ dấu (`đ→d`). Bỏ chuỗi ≤ 2 ký tự. Kết quả `{ part, count, category: 'metadata' | 'comment-text' | 'body-text' }`; `status` = `FAIL` (còn trong thuộc tính/metadata) / `WARN` (chỉ còn trong text) / `PASS`.
9. **An toàn đầu vào** → `AnonymizerError { code, message (tiếng Việt) }`:
   - `TOO_LARGE`: file > 50 MB.
   - `ZIP_BOMB`: tổng giải nén > 300 MB (đếm thực tế khi giải nén, không tin header) hoặc > 2.000 entry.
   - `NOT_DOCX`: thiếu `[Content_Types].xml`/`word/document.xml`, hoặc path chứa `..` / bắt đầu `/` `\`.
   - `MACRO_ENABLED`: có `vbaProject.bin`.
   - `ENCRYPTED_OR_LEGACY`: magic `D0 CF 11 E0` (file đặt mật khẩu hoặc `.doc` cũ).
   - `INVALID_XML`: XML lỗi hoặc có `<!DOCTYPE`.

## Ràng buộc
- Chỉ tạo file trong `src/word-anonymizer/` (core + `__tests__/`); sửa `package.json`/`package-lock.json` để thêm `jszip` (pin chính xác).
- XML thao tác bằng `DOMParser`/`XMLSerializer` theo **namespace URI** (`getAttributeNS`, `getElementsByTagNameNS`). Cấm regex dựa vào prefix `w:`.
- Không gọi mạng. Không dùng Web Worker ở task này (`DOMParser` không có trong Worker).
- Fixture dựng bằng JSZip trong `__tests__/fixtures.ts`, dữ liệu giả theo `00_RULES.md`.

## Tiêu chí hoàn thành
Mỗi K là ít nhất một test trong `src/word-anonymizer/__tests__/`:
- K1: 2 tác giả, 3 comment → `Người góp ý 1/2`, `NG1/NG2`; mọi `w:t` giữ nguyên.
- K2: Comment trả lời (`paraIdParent`) → `commentsExtended.xml` giữ nguyên byte (so hash).
- K3: `w:ins`/`w:del`/`w:rPrChange` ở document + header + footnotes → mọi `w:author` đã thay; cùng người với comment → cùng nhãn.
- K4: Prefix namespace khác (`ns0:` thay `w:`) → vẫn xử lý đúng.
- K5: `people.xml` có `presenceInfo` chứa email → bị xoá; residual `PASS`.
- K6: `core.xml`/`app.xml` đã làm sạch; `custom.xml`: giữ `MSIP_Label_x_Enabled`, xoá `ReviewerEmail`.
- K7: Mention: thay khi `replaceMentions=true`, giữ khi `false`.
- K8: `removeDates=true` → không còn `w:date`.
- K9: Tên tác giả trong text comment, option tắt → text giữ nguyên, residual `WARN`, category `comment-text`. Tên có dấu/khác hoa thường vẫn bị phát hiện.
- K10: Mỗi mã lỗi ở mục 9 có 1 test; zip bomb không làm treo test (< 5 s).
- K11: File không có comment/revision chạy được, report 0 tác giả. Chạy lần 2 trên output → không đổi thêm, residual `PASS` (idempotent).
- K12: Part không liên quan giữ nguyên byte; output qua được `JSZip.loadAsync` lại.

## Chứng minh + commit + push (PowerShell)
```powershell
git diff --stat
Select-String -Path src/word-anonymizer/core/*.ts -Pattern "from 'react'|fetch\(|XMLHttpRequest"
Select-String -Path src/word-anonymizer/core/*.ts -Pattern '/<?w:|w:author="'
Select-String -Path package.json -Pattern '"jszip"'
npm run lint; npm test; npm run build
git add package.json package-lock.json src/word-anonymizer
git commit -m "feat(W-1): docx comment anonymizer core with residual scan"
git push -u origin feat/w1-docx-anonymizer-core
git log --oneline -1 origin/feat/w1-docx-anonymizer-core
```
Kỳ vọng: Select-String thứ nhất không có kết quả (không React/mạng); thứ hai không có regex/chuỗi XML dựa vào prefix `w:` (nếu có kết quả nằm trong comment/hằng số tài liệu thì giải thích từng dòng); `jszip` có version chính xác; mọi test xanh; dòng cuối in commit vừa push.

## Báo cáo
2 output `git push` + `git log origin/...` ở đầu, rồi theo `00_RULES.md` + bảng `K | tên test | pass` và danh sách `TODO(verify)` về OOXML (đặc biệt: cấu trúc mention, `w16du`, `w16cex`).
