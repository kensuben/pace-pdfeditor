import { useState, useRef, useMemo, useEffect } from 'react'
import type { AccountInfo } from '@azure/msal-browser'
import {
  FileText,
  Upload,
  Download,
  Trash2,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Lock,
  LogIn,
  Info,
  ShieldCheck,
  Tag,
  AtSign,
  FileCheck2,
  Building2,
  Plus,
  EyeOff,
} from 'lucide-react'
import type { ApiUser } from '../api'
import {
  inspectDocx,
  anonymizeDocx,
  scanResidual,
  buildDefaultMapping,
  validateMapping,
  validateEntities,
  inspectDeletedText,
  maskSensitive,
  AnonymizerError,
  type InspectionReport,
  type IdentityMapping,
  type AnonymizeOptions,
  type AnonymizeResult,
  type ResidualReport,
  type CustomPropsPolicy,
  type CustomEntity,
  type EntityKind,
  type SensitiveKind,
  type DeletedTextHit,
} from './core'

export interface WordAnonymizerPageProps {
  account: AccountInfo | null
  apiUser: ApiUser | null
  authReady: boolean
  onSignInMicrosoft: () => void
  log: (
    action: string,
    description: string,
    metadata?: Record<string, string | number | boolean | null>,
    level?: 'info' | 'success' | 'warning' | 'security'
  ) => void
}

const DEFAULT_OPTIONS: AnonymizeOptions = {
  removeDates: false,
  replaceMentions: true,
  replaceNamesInCommentText: false,
  scrubDocProps: true,
  customPropsPolicy: 'keep-sensitivity-labels',
  customEntities: [],
  maskKinds: {
    email: true,
    phone: true,
    nationalId: true,
    taxCode: true,
    bankAccount: true,
    address: true,
  },
  keepValues: [],
}

const SENSITIVE_KIND_LABELS: { kind: SensitiveKind; label: string }[] = [
  { kind: 'email', label: 'Email' },
  { kind: 'phone', label: 'Số điện thoại' },
  { kind: 'nationalId', label: 'CCCD/CMND' },
  { kind: 'taxCode', label: 'Mã số thuế' },
  { kind: 'bankAccount', label: 'Số tài khoản' },
  { kind: 'address', label: 'Địa chỉ' },
]

function FixedReminderCallout() {
  return (
    <div className="fixed-reminder-callout">
      <Info size={18} />
      <span>
        Kiểm tra lại nội dung trước khi upload — công cụ chỉ thay các tên bạn khai báo và thông tin nhạy cảm nhận diện được theo mẫu; chữ đã xoá trong Track Changes không được xử lý.{' '}
        <a href="/huong-dan/#word" target="_blank" rel="noopener" className="reminder-help-link">Xem hướng dẫn</a>
      </span>
    </div>
  )
}

export default function WordAnonymizerPage({
  account,
  authReady,
  onSignInMicrosoft,
  log,
}: WordAnonymizerPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null)
  const [fileBaseTitle, setFileBaseTitle] = useState<string>('')
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [inspection, setInspection] = useState<InspectionReport | null>(null)
  const [mapping, setMapping] = useState<IdentityMapping>({})
  const [entities, setEntities] = useState<CustomEntity[]>([])
  const [maskKinds, setMaskKinds] = useState<Record<SensitiveKind, boolean>>({
    email: true,
    phone: true,
    nationalId: true,
    taxCode: true,
    bankAccount: true,
    address: true,
  })
  const [keepValues, setKeepValues] = useState<string[]>([])
  const [deletedHits, setDeletedHits] = useState<DeletedTextHit[]>([])
  const [options, setOptions] = useState<AnonymizeOptions>(DEFAULT_OPTIONS)

  const [anonymizeResult, setAnonymizeResult] = useState<AnonymizeResult | null>(null)
  const [residualReport, setResidualReport] = useState<ResidualReport | null>(null)
  const [downloadBlobUrl, setDownloadBlobUrl] = useState<string | null>(null)

  const [keepOriginalName, setKeepOriginalName] = useState(false)
  const [exportMappingJson, setExportMappingJson] = useState(false)
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false)
  const [configChangedAfterRun, setConfigChangedAfterRun] = useState(false)

  const resetStaleResults = () => {
    if (anonymizeResult || residualReport || downloadBlobUrl) {
      if (downloadBlobUrl) {
        URL.revokeObjectURL(downloadBlobUrl)
      }
      setDownloadBlobUrl(null)
      setAnonymizeResult(null)
      setResidualReport(null)
      setAcknowledgeRisk(false)
      setConfigChangedAfterRun(true)
    }
  }

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (downloadBlobUrl) {
        URL.revokeObjectURL(downloadBlobUrl)
      }
    }
  }, [downloadBlobUrl])

  // Track changes deleted text inspection
  useEffect(() => {
    if (!fileBuffer) {
      return
    }
    let cancelled = false
    inspectDeletedText(fileBuffer, entities)
      .then((hits) => {
        if (!cancelled) setDeletedHits(hits)
      })
      .catch(() => {
        if (!cancelled) setDeletedHits([])
      })
    return () => {
      cancelled = true
    }
  }, [fileBuffer, entities])

  const validation = useMemo(() => {
    if (!inspection) return { valid: true, errors: [] }
    return validateMapping(mapping, inspection.identities)
  }, [mapping, inspection])

  const entityValidation = useMemo(() => {
    return validateEntities(entities, mapping, inspection?.identities || [])
  }, [entities, mapping, inspection])

  const getEntityError = (entity: CustomEntity): string | null => {
    if (!entity.label.trim()) return 'Nhãn thực thể không được để trống.'
    const lower = entity.label.trim().toLowerCase()
    if (entities.filter((e) => e.label.trim().toLowerCase() === lower).length > 1) {
      return `Nhãn '${entity.label}' bị trùng lặp.`
    }
    const isParticipant = Object.values(mapping).some(
      (m) => m.label && m.label.trim().toLowerCase() === lower
    )
    if (isParticipant) {
      return `Nhãn '${entity.label}' trùng với nhãn người tham gia.`
    }
    for (const val of entity.values) {
      if (val.trim().length < 2) {
        return `Giá trị '${val}' phải có ít nhất 2 ký tự.`
      }
    }
    return null
  }

  const resetAll = () => {
    if (downloadBlobUrl) {
      URL.revokeObjectURL(downloadBlobUrl)
      setDownloadBlobUrl(null)
    }
    setFileBuffer(null)
    setFileBaseTitle('')
    setInspection(null)
    setMapping({})
    setEntities([])
    setMaskKinds({
      email: true,
      phone: true,
      nationalId: true,
      taxCode: true,
      bankAccount: true,
      address: true,
    })
    setKeepValues([])
    setDeletedHits([])
    setOptions(DEFAULT_OPTIONS)
    setAnonymizeResult(null)
    setResidualReport(null)
    setErrorMessage(null)
    setAcknowledgeRisk(false)
    setConfigChangedAfterRun(false)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleProcessFile = async (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith('.docx')) {
      setErrorMessage('Vui lòng chọn file có định dạng Word (.docx).')
      return
    }

    resetAll()
    setBusy(true)
    setFileBaseTitle(selectedFile.name)

    try {
      const buffer = await selectedFile.arrayBuffer()
      const report = await inspectDocx(buffer)
      const initialMapping = buildDefaultMapping(report)

      setFileBuffer(buffer)
      setInspection(report)
      setMapping(initialMapping)
      setDeletedHits(report.deletedTextHits || [])
    } catch (err: unknown) {
      let msg = 'Không thể kiểm tra file DOCX này.'
      let errCode = 'UNKNOWN'

      if (err instanceof AnonymizerError) {
        errCode = err.code
        switch (err.code) {
          case 'TOO_LARGE':
            msg = 'Dung lượng file vượt quá giới hạn 50 MB.'
            break
          case 'ZIP_BOMB':
            msg = 'File DOCX không an toàn (nghi vấn zip bomb).'
            break
          case 'NOT_DOCX':
            msg = 'File không phải định dạng DOCX hợp lệ hoặc cấu trúc bị hỏng.'
            break
          case 'MACRO_ENABLED':
            msg = 'Tài liệu chứa macro (DOCM), không được hỗ trợ để đảm bảo an toàn.'
            break
          case 'ENCRYPTED_OR_LEGACY':
            msg = 'File có thể đã bị mã hóa hoặc ở định dạng Word cũ (.doc binary).'
            break
          case 'INVALID_XML':
            msg = 'Cấu trúc XML bên trong tài liệu DOCX không hợp lệ.'
            break
        }
      } else if (err instanceof Error) {
        msg = err.message
      }

      setErrorMessage(msg)
      log('word_anonymizer.failed', 'Ẩn danh tài liệu Word thất bại', { code: errCode }, 'warning')
    } finally {
      setBusy(false)
    }
  }

  const handleLabelChange = (authorKey: string, nextLabel: string) => {
    resetStaleResults()
    setMapping((prev) => {
      const current = prev[authorKey]
      if (!current) return prev
      return {
        ...prev,
        [authorKey]: {
          ...current,
          label: nextLabel,
        },
      }
    })
  }

  const handleInitialsChange = (authorKey: string, nextInitials: string) => {
    resetStaleResults()
    setMapping((prev) => {
      const current = prev[authorKey]
      if (!current) return prev
      return {
        ...prev,
        [authorKey]: {
          ...current,
          initials: nextInitials,
        },
      }
    })
  }

  const handleAddEntity = (kind: EntityKind) => {
    resetStaleResults()
    const isOrg = kind === 'organization'
    const count = entities.filter((e) => e.kind === kind).length
    const defaultLabel = isOrg
      ? `Pháp nhân ${String.fromCharCode(65 + count)}`
      : `Người đại diện ${count + 1}`
    const newEntity: CustomEntity = {
      id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind,
      label: defaultLabel,
      values: [],
    }
    setEntities((prev) => [...prev, newEntity])
  }

  const handleUpdateEntityLabel = (id: string, label: string) => {
    resetStaleResults()
    setEntities((prev) =>
      prev.map((e) => (e.id === id ? { ...e, label } : e))
    )
  }

  const handleUpdateEntityValues = (id: string, text: string) => {
    resetStaleResults()
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    setEntities((prev) =>
      prev.map((e) => (e.id === id ? { ...e, values: lines } : e))
    )
  }

  const handleRemoveEntity = (id: string) => {
    resetStaleResults()
    setEntities((prev) => prev.filter((e) => e.id !== id))
  }

  const handleToggleMaskKind = (kind: SensitiveKind) => {
    resetStaleResults()
    setMaskKinds((prev) => ({ ...prev, [kind]: !prev[kind] }))
  }

  const handleToggleKeepValue = (normalized: string) => {
    resetStaleResults()
    setKeepValues((prev) =>
      prev.includes(normalized) ? prev.filter((v) => v !== normalized) : [...prev, normalized]
    )
  }

  interface AggregatedSensitiveItem {
    kind: SensitiveKind
    normalized: string
    sampleValue: string
    maskedPreview: string
    count: number
  }

  const detectedSensitiveGrouped = useMemo(() => {
    if (!inspection?.sensitive) return []
    const map = new Map<string, AggregatedSensitiveItem>()
    for (const item of inspection.sensitive) {
      const key = `${item.kind}:${item.normalized}`
      const existing = map.get(key)
      if (existing) {
        existing.count++
      } else {
        map.set(key, {
          kind: item.kind,
          normalized: item.normalized,
          sampleValue: item.value,
          maskedPreview: maskSensitive(item.kind, item.value, item.normalized),
          count: 1,
        })
      }
    }
    return Array.from(map.values())
  }, [inspection])

  const handleAnonymize = async () => {
    if (!fileBuffer || !inspection || !validation.valid || !entityValidation.valid) return

    setBusy(true)
    setErrorMessage(null)
    setConfigChangedAfterRun(false)

    try {
      const anonymizeOpts: AnonymizeOptions = {
        ...options,
        customEntities: entities,
        maskKinds,
        keepValues,
      }
      const result = await anonymizeDocx(fileBuffer, mapping, anonymizeOpts)
      const outArrayBuffer = await result.blob.arrayBuffer()
      const sensitiveTargets = [
        ...detectedSensitiveGrouped
          .filter((s) => maskKinds[s.kind] && !keepValues.includes(s.normalized))
          .map((s) => s.sampleValue),
        ...deletedHits.map((h) => h.text).filter(Boolean) as string[],
      ]
      const extraTargets = [...entities, ...sensitiveTargets]
      const residuals = await scanResidual(outArrayBuffer, inspection.identities, extraTargets, {
        maskKinds,
        keepValues,
      })

      setAnonymizeResult(result)
      setResidualReport(residuals)

      if (downloadBlobUrl) {
        URL.revokeObjectURL(downloadBlobUrl)
      }
      const newUrl = URL.createObjectURL(result.blob)
      setDownloadBlobUrl(newUrl)

      log(
        'word_anonymizer.completed',
        'Ẩn danh tài liệu Word hoàn tất',
        {
          authorCount: inspection.stats.authorCount,
          commentCount: inspection.stats.commentCount,
          revisionCount: inspection.stats.revisionCount,
          residualStatus: residuals.status,
          entityReplacements: result.report.replacements.entities,
          emailMasked: result.report.replacements.byKind.email || 0,
          phoneMasked: result.report.replacements.byKind.phone || 0,
          nationalIdMasked: result.report.replacements.byKind.nationalId || 0,
          taxCodeMasked: result.report.replacements.byKind.taxCode || 0,
          bankAccountMasked: result.report.replacements.byKind.bankAccount || 0,
          addressMasked: result.report.replacements.byKind.address || 0,
        },
        'success'
      )
    } catch (err: unknown) {
      let msg = 'Quá trình ẩn danh thất bại.'
      let errCode = 'ANONYMIZE_ERROR'

      if (err instanceof AnonymizerError) {
        errCode = err.code
        msg = err.message
      } else if (err instanceof Error) {
        msg = err.message
      }

      setErrorMessage(msg)
      log('word_anonymizer.failed', 'Ẩn danh tài liệu Word thất bại', { code: errCode }, 'warning')
    } finally {
      setBusy(false)
    }
  }

  const getDownloadDocTitle = () => {
    if (keepOriginalName && fileBaseTitle) {
      const base = fileBaseTitle.replace(/\.docx$/i, '')
      return `${base}_anonymized.docx`
    }
    return 'document_anonymized.docx'
  }

  const handleDownloadMappingJson = () => {
    const mappingExport = {
      identities: mapping,
      entities: entities.reduce<Record<string, string[]>>((acc, e) => {
        acc[e.label] = e.values
        return acc
      }, {}),
      masked: detectedSensitiveGrouped
        .filter((s) => maskKinds[s.kind] && !keepValues.includes(s.normalized))
        .reduce<Record<string, string>>((acc, s) => {
          acc[s.maskedPreview] = s.sampleValue
          return acc
        }, {}),
    }
    const jsonText = JSON.stringify(mappingExport, null, 2)
    const jsonBlob = new Blob([jsonText], { type: 'application/json' })
    const jsonUrl = URL.createObjectURL(jsonBlob)
    const downloadLink = document.createElement('a')
    downloadLink.href = jsonUrl
    downloadLink.download = 'mapping.json'
    downloadLink.click()
    URL.revokeObjectURL(jsonUrl)
  }

  // 1. Mandatory login screen
  if (!account) {
    return (
      <div className="word-anonymizer-container">
        <div className="word-anonymizer-content">
          <FixedReminderCallout />

          <div className="auth-required-card">
            <div className="auth-required-icon">
              <Lock size={28} />
            </div>
            <h2>Yêu cầu đăng nhập Microsoft</h2>
            <p>
              Để đảm bảo an toàn thông tin và chính sách bảo mật nội bộ, bạn cần đăng nhập tài khoản Microsoft của tổ chức trước khi sử dụng công cụ Ẩn danh Word.
            </p>
            <button
              className="microsoft-login"
              onClick={onSignInMicrosoft}
              disabled={!authReady}
            >
              <span className="ms-logo"><i /><i /><i /><i /></span>
              <LogIn size={16} /> Đăng nhập Microsoft
            </button>
          </div>
        </div>
      </div>
    )
  }

  const contributorIdentities = inspection?.identities.filter((i) => i.kind === 'contributor') || []
  const mentionedIdentities = inspection?.identities.filter((i) => i.kind === 'mentioned') || []

  return (
    <div className="word-anonymizer-container">
      <div className="word-anonymizer-content">
        {/* Header */}
        <div className="word-anonymizer-header">
          <div className="word-anonymizer-title-row">
            <div className="word-anonymizer-title">
              <FileText size={28} color="var(--accent, #0047af)" />
              <h1>Ẩn danh tài liệu Word</h1>
              <span className="word-anonymizer-badge">DOCX Privacy</span>
            </div>
            {fileBuffer && (
              <button className="secondary" onClick={resetAll} disabled={busy}>
                <Trash2 size={16} /> Xoá khỏi bộ nhớ
              </button>
            )}
          </div>

          {/* Fixed Reminder Callout */}
          <FixedReminderCallout />
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="word-alert error">
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Upload dropzone if no file loaded */}
        {!fileBuffer && (
          <div
            className={`word-dropzone ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              const droppedFile = e.dataTransfer.files?.[0]
              if (droppedFile) {
                handleProcessFile(droppedFile)
              }
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              hidden
              onChange={(e) => {
                const picked = e.target.files?.[0]
                if (picked) {
                  handleProcessFile(picked)
                }
              }}
            />
            <div className="word-dropzone-icon">
              <Upload size={24} />
            </div>
            <div className="word-dropzone-prompt">
              <h3>Chọn hoặc kéo thả tài liệu Word (.docx)</h3>
              <p>Tài liệu được phân tích và xử lý an toàn hoàn toàn tại trình duyệt của bạn</p>
            </div>
            <span className="word-dropzone-meta">Hỗ trợ .docx tối đa 50 MB</span>
          </div>
        )}

        {/* Main Workspace when file is loaded */}
        {inspection && fileBuffer && (
          <>
            {/* Stats Bar */}
            <div className="word-card">
              <div className="word-card-header">
                <div className="word-card-title">
                  <FileCheck2 size={20} />
                  <span>Thông tin tài liệu đã phân tích</span>
                </div>
                {fileBaseTitle && <span className="word-source-tag">{fileBaseTitle}</span>}
              </div>

              <div className="word-stats-bar">
                <div className="word-stat-chip">
                  <span>Số danh tính</span>
                  <b>{inspection.stats.authorCount}</b>
                </div>
                <div className="word-stat-chip">
                  <span>Số bình luận</span>
                  <b>{inspection.stats.commentCount}</b>
                </div>
                <div className="word-stat-chip">
                  <span>Số sửa đổi (Track Changes)</span>
                  <b>{inspection.stats.revisionCount}</b>
                </div>
              </div>

              {/* Warnings from inspection */}
              {inspection.warnings.length > 0 && (
                <div className="word-alert warning">
                  <AlertTriangle size={18} />
                  <div>
                    <b>Cảnh báo khi đọc tài liệu:</b>
                    <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                      {inspection.warnings.map((w, idx) => (
                        <li key={idx}>{w}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </div>

            {/* Validation errors banner */}
            {!validation.valid && (
              <div className="word-alert error">
                <AlertCircle size={18} />
                <div>
                  <b>Lỗi cấu hình nhãn ẩn danh:</b>
                  <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                    {validation.errors.map((errText, idx) => (
                      <li key={idx}>{errText}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Entity validation errors banner */}
            {!entityValidation.valid && (
              <div className="word-alert error">
                <AlertCircle size={18} />
                <div>
                  <b>Lỗi cấu hình pháp nhân & người đại diện:</b>
                  <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                    {entityValidation.errors.map((errText, idx) => (
                      <li key={idx}>{errText}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Preview Tables */}
            {/* Group 1: Người góp ý (contributor) */}
            {contributorIdentities.length > 0 && (
              <div className="word-card">
                <div className="word-card-header">
                  <div className="word-card-title">
                    <Tag size={18} />
                    <span>Người góp ý ({contributorIdentities.length})</span>
                  </div>
                </div>
                <div className="word-table-wrapper">
                  <table className="word-table">
                    <thead>
                      <tr>
                        <th>Tên gốc trong file</th>
                        <th>Nhãn hiển thị</th>
                        <th>Tên viết tắt</th>
                        <th>Nguồn xuất hiện</th>
                        <th>Email / Presence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contributorIdentities.map((ident) => {
                        const m = mapping[ident.author] || { label: '', initials: '', alias: '' }
                        const hasEmailOrPresence = Boolean(ident.email || ident.userId)
                        return (
                          <tr key={ident.author}>
                            <td>
                              <b>{ident.author}</b>
                            </td>
                            <td>
                              <input
                                type="text"
                                value={m.label}
                                onChange={(e) => handleLabelChange(ident.author, e.target.value)}
                                placeholder="Nhãn thay thế"
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                style={{ width: '80px' }}
                                value={m.initials}
                                onChange={(e) => handleInitialsChange(ident.author, e.target.value)}
                                placeholder="Viết tắt"
                              />
                            </td>
                            <td>
                              {ident.sources.map((s, idx) => (
                                <span key={idx} className="word-source-tag">
                                  {s}
                                </span>
                              ))}
                            </td>
                            <td>
                              <span
                                className={`word-table-badge ${
                                  hasEmailOrPresence ? 'has-email' : ''
                                }`}
                              >
                                {hasEmailOrPresence ? 'Có' : 'Không'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Group 2: Người được nhắc (mentioned) */}
            {mentionedIdentities.length > 0 && (
              <div className="word-card">
                <div className="word-card-header">
                  <div className="word-card-title">
                    <AtSign size={18} />
                    <span>Người được nhắc ({mentionedIdentities.length})</span>
                  </div>
                </div>
                <div className="word-table-wrapper">
                  <table className="word-table">
                    <thead>
                      <tr>
                        <th>Tên gốc / Display text</th>
                        <th>Nhãn hiển thị</th>
                        <th>Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mentionedIdentities.map((ident) => {
                        const m = mapping[ident.author] || { label: '', initials: '', alias: '' }
                        const hasEmail = Boolean(ident.email)
                        return (
                          <tr key={ident.author}>
                            <td>
                              <b>{ident.author}</b>
                            </td>
                            <td>
                              <input
                                type="text"
                                value={m.label}
                                onChange={(e) => handleLabelChange(ident.author, e.target.value)}
                                placeholder="Nhãn thay thế"
                              />
                            </td>
                            <td>
                              <span className={`word-table-badge ${hasEmail ? 'has-email' : ''}`}>
                                {hasEmail ? 'Có' : 'Không'}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Card 1: Pháp nhân & người đại diện */}
            <div className="word-card">
              <div className="word-card-header">
                <div className="word-card-title">
                  <Building2 size={18} />
                  <span>Pháp nhân & người đại diện</span>
                </div>
              </div>

              <p className="word-card-note">
                Công cụ chỉ thay đúng các tên bạn nhập (không phân biệt hoa/thường, giữ dấu). Hãy nhập đủ các cách viết: tên viết tắt, tên tiếng Anh…
              </p>

              {/* Group: Pháp nhân */}
              <div className="entity-group">
                <div className="entity-group-header">
                  <h4>Pháp nhân ({entities.filter((e) => e.kind === 'organization').length})</h4>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => handleAddEntity('organization')}
                  >
                    <Plus size={14} /> Thêm pháp nhân
                  </button>
                </div>

                {entities.filter((e) => e.kind === 'organization').map((entity) => {
                  const err = getEntityError(entity)
                  return (
                    <div key={entity.id} className="entity-row">
                      <div className="entity-inputs">
                        <div className="entity-input-col">
                          <label>Tên gốc (mỗi dòng một cách viết):</label>
                          <textarea
                            rows={2}
                            value={entity.values.join('\n')}
                            onChange={(e) => handleUpdateEntityValues(entity.id, e.target.value)}
                            placeholder="VD: Công ty TNHH Mẫu Thử&#10;Mau Thu Co., Ltd"
                          />
                        </div>
                        <div className="entity-input-col entity-label-col">
                          <label>Nhãn thay thế:</label>
                          <input
                            type="text"
                            value={entity.label}
                            onChange={(e) => handleUpdateEntityLabel(entity.id, e.target.value)}
                            placeholder="Nhãn thay thế"
                          />
                        </div>
                        <button
                          type="button"
                          className="danger-icon-btn"
                          title="Xoá dòng"
                          onClick={() => handleRemoveEntity(entity.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      {err && <div className="entity-error-msg">{err}</div>}
                    </div>
                  )
                })}
              </div>

              {/* Group: Người đại diện */}
              <div className="entity-group" style={{ marginTop: '16px' }}>
                <div className="entity-group-header">
                  <h4>Người đại diện ({entities.filter((e) => e.kind === 'representative').length})</h4>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => handleAddEntity('representative')}
                  >
                    <Plus size={14} /> Thêm người đại diện
                  </button>
                </div>

                {entities.filter((e) => e.kind === 'representative').map((entity) => {
                  const err = getEntityError(entity)
                  return (
                    <div key={entity.id} className="entity-row">
                      <div className="entity-inputs">
                        <div className="entity-input-col">
                          <label>Tên gốc (mỗi dòng một cách viết):</label>
                          <textarea
                            rows={2}
                            value={entity.values.join('\n')}
                            onChange={(e) => handleUpdateEntityValues(entity.id, e.target.value)}
                            placeholder="VD: Nguyễn Văn A&#10;Nguyen Van A"
                          />
                        </div>
                        <div className="entity-input-col entity-label-col">
                          <label>Nhãn thay thế:</label>
                          <input
                            type="text"
                            value={entity.label}
                            onChange={(e) => handleUpdateEntityLabel(entity.id, e.target.value)}
                            placeholder="Nhãn thay thế"
                          />
                        </div>
                        <button
                          type="button"
                          className="danger-icon-btn"
                          title="Xoá dòng"
                          onClick={() => handleRemoveEntity(entity.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      {err && <div className="entity-error-msg">{err}</div>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Card 2: Thông tin nhạy cảm phát hiện được */}
            <div className="word-card">
              <div className="word-card-header">
                <div className="word-card-title">
                  <EyeOff size={18} />
                  <span>Thông tin nhạy cảm phát hiện được</span>
                </div>
              </div>

              <p className="word-card-note">
                Danh sách được nhận diện theo mẫu, có thể sót hoặc nhận nhầm. Hãy xem lại trước khi chạy.
              </p>

              {/* 6 toggles */}
              <div className="sensitive-toggles-grid">
                {SENSITIVE_KIND_LABELS.map(({ kind, label }) => (
                  <label key={kind} className="sensitive-toggle-item">
                    <input
                      type="checkbox"
                      checked={maskKinds[kind]}
                      onChange={() => handleToggleMaskKind(kind)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>

              {detectedSensitiveGrouped.length === 0 ? (
                <div className="sensitive-empty-msg">
                  Không tìm thấy thông tin nhạy cảm theo mẫu
                </div>
              ) : (
                <div className="sensitive-items-container">
                  {SENSITIVE_KIND_LABELS.map(({ kind, label }) => {
                    const items = detectedSensitiveGrouped.filter((s) => s.kind === kind)
                    if (items.length === 0) return null
                    return (
                      <div key={kind} className="sensitive-kind-group">
                        <div className="sensitive-kind-title">
                          <b>{label}</b> ({items.length})
                        </div>
                        <div className="word-table-wrapper">
                          <table className="word-table">
                            <thead>
                              <tr>
                                <th>Giá trị gốc</th>
                                <th>Sau khi che (xem trước)</th>
                                <th>Số lần</th>
                                <th style={{ width: '80px', textAlign: 'center' }}>Che</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((item) => (
                                <tr key={item.normalized}>
                                  <td>
                                    <span className="sensitive-value">{item.sampleValue}</span>
                                  </td>
                                  <td>
                                    <span className="sensitive-value">{item.maskedPreview}</span>
                                  </td>
                                  <td>
                                    <b>{item.count}</b>
                                  </td>
                                  <td style={{ textAlign: 'center' }}>
                                    <input
                                      type="checkbox"
                                      checked={!keepValues.includes(item.normalized)}
                                      onChange={() => handleToggleKeepValue(item.normalized)}
                                      title="Che giá trị này"
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Options */}
            <div className="word-card">
              <div className="word-card-header">
                <div className="word-card-title">
                  <ShieldCheck size={18} />
                  <span>Tùy chọn ẩn danh</span>
                </div>
              </div>

              <div className="word-options-grid">
                <label className="word-option-item">
                  <input
                    type="checkbox"
                    checked={options.removeDates}
                    onChange={(e) => {
                      resetStaleResults()
                      setOptions((prev) => ({ ...prev, removeDates: e.target.checked }))
                    }}
                  />
                  <div className="word-option-label">
                    <b>Xóa ngày giờ bình luận và sửa đổi (removeDates)</b>
                    <small>Loại bỏ dấu vết thời gian tạo và chỉnh sửa trên các phần tử Word</small>
                  </div>
                </label>

                <label className="word-option-item">
                  <input
                    type="checkbox"
                    checked={options.replaceMentions}
                    onChange={(e) => {
                      resetStaleResults()
                      setOptions((prev) => ({ ...prev, replaceMentions: e.target.checked }))
                    }}
                  />
                  <div className="word-option-label">
                    <b>Thay thế tên người được @mention (replaceMentions)</b>
                    <small>Đổi liên kết mailto và hiển thị tên người được nhắc trong bình luận</small>
                  </div>
                </label>

                {!options.replaceMentions && (
                  <div className="word-alert warning" style={{ marginLeft: '26px' }}>
                    <AlertTriangle size={16} />
                    <span>Tên người được nhắc sẽ còn trong file</span>
                  </div>
                )}

                <label className="word-option-item">
                  <input
                    type="checkbox"
                    checked={options.replaceNamesInCommentText}
                    onChange={(e) => {
                      resetStaleResults()
                      setOptions((prev) => ({
                        ...prev,
                        replaceNamesInCommentText: e.target.checked,
                      }))
                    }}
                  />
                  <div className="word-option-label">
                    <b>Thay thế tên người xuất hiện trong nội dung bình luận (replaceNamesInCommentText)</b>
                    <small>Tìm và thay thế tên tác giả xuất hiện dạng văn bản tự do trong nội dung comment</small>
                  </div>
                </label>

                <label className="word-option-item">
                  <input
                    type="checkbox"
                    checked={options.scrubDocProps}
                    onChange={(e) => {
                      resetStaleResults()
                      setOptions((prev) => ({ ...prev, scrubDocProps: e.target.checked }))
                    }}
                  />
                  <div className="word-option-label">
                    <b>Làm sạch thuộc tính tài liệu (scrubDocProps)</b>
                    <small>Làm sạch người tạo (creator), người sửa đổi cuối (lastModifiedBy), công ty trong metadata</small>
                  </div>
                </label>

                <div className="word-select-row">
                  <label htmlFor="custom-props-policy-select">
                    <b>Chính sách thuộc tính tùy chỉnh (custom.xml):</b>
                  </label>
                  <select
                    id="custom-props-policy-select"
                    value={options.customPropsPolicy}
                    onChange={(e) => {
                      resetStaleResults()
                      setOptions((prev) => ({
                        ...prev,
                        customPropsPolicy: e.target.value as CustomPropsPolicy,
                      }))
                    }}
                  >
                    <option value="keep-sensitivity-labels">
                      Giữ nhãn bảo mật MSIP (keep-sensitivity-labels)
                    </option>
                    <option value="keep-all">Giữ lại toàn bộ thuộc tính tùy chỉnh (keep-all)</option>
                    <option value="remove-all">Xóa toàn bộ thuộc tính tùy chỉnh (remove-all)</option>
                  </select>
                </div>
              </div>

              {configChangedAfterRun && (
                <div className="word-alert info" style={{ marginTop: '12px' }}>
                  <Info size={16} />
                  <span>Cấu hình đã thay đổi — bấm &quot;Ẩn danh tài liệu&quot; để tạo lại file.</span>
                </div>
              )}

              {/* Deleted text warning */}
              {deletedHits.length > 0 && (
                <div className="word-alert warning" style={{ marginTop: '12px' }}>
                  <AlertTriangle size={18} />
                  <div>
                    <b>Cảnh báo: Phát hiện thông tin trong phần chữ đã xoá (Track Changes)</b>
                    <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
                      Các nội dung sau nằm trong phần chữ đã xoá và sẽ <strong>KHÔNG</strong> được che hay thay thế:
                    </p>
                    <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                      {deletedHits.map((h, idx) => (
                        <li key={idx}>
                          {h.type === 'entity'
                            ? `Pháp nhân/người đại diện "${h.label}": "${h.text}" (${h.part})`
                            : `Thông tin nhạy cảm (${h.kind}): "${h.text}" (${h.part})`}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Anonymize Action */}
              <div className="word-actions-row" style={{ marginTop: '12px' }}>
                <button
                  className="primary large"
                  onClick={handleAnonymize}
                  disabled={busy || !validation.valid || !entityValidation.valid}
                >
                  <ShieldCheck size={18} /> {busy ? 'Đang xử lý...' : 'Ẩn danh tài liệu'}
                </button>
              </div>
            </div>

            {/* Replacements Summary */}
            {anonymizeResult && (
              <div className="word-card">
                <div className="word-card-header">
                  <div className="word-card-title">
                    <FileCheck2 size={18} />
                    <span>Kết quả thay thế & che dữ liệu</span>
                  </div>
                </div>
                <div className="word-replacements-summary">
                  Đã thay {anonymizeResult.report.replacements.entities} tên pháp nhân/người đại diện; che{' '}
                  {anonymizeResult.report.replacements.byKind.email || 0} email,{' '}
                  {anonymizeResult.report.replacements.byKind.phone || 0} số điện thoại,{' '}
                  {anonymizeResult.report.replacements.byKind.nationalId || 0} CCCD/CMND,{' '}
                  {anonymizeResult.report.replacements.byKind.taxCode || 0} MST,{' '}
                  {anonymizeResult.report.replacements.byKind.bankAccount || 0} số tài khoản,{' '}
                  {anonymizeResult.report.replacements.byKind.address || 0} địa chỉ
                </div>
              </div>
            )}

            {/* Residual Report */}
            {residualReport && (
              <div className="word-card">
                <div className="word-card-header">
                  <div className="word-card-title">
                    <span>Kết quả quét rò rỉ dữ liệu (Residual Scan)</span>
                  </div>
                  <a href="/huong-dan/#ket-qua" target="_blank" rel="noopener" className="residual-help-link">Ý nghĩa kết quả</a>
                </div>

                {residualReport.status === 'PASS' && (
                  <div className="residual-card pass">
                    <div className="residual-header">
                      <CheckCircle2 size={22} color="#16a34a" />
                      <span>ĐẠT BẢO MẬT (PASS)</span>
                    </div>
                    <p className="residual-desc">
                      Không phát hiện dấu vết danh tính hay email nào còn sót lại trong metadata hoặc các phần bắt buộc.
                    </p>
                  </div>
                )}

                {residualReport.status === 'WARN' && (
                  <div className="residual-card warn">
                    <div className="residual-header">
                      <AlertTriangle size={22} color="#d97706" />
                      <span>CẢNH BÁO (WARN)</span>
                    </div>
                    <p className="residual-desc">
                      Phát hiện chuỗi trùng khớp trong nội dung văn bản (bình luận hoặc thân bài). Vui lòng kiểm tra lại nếu cần bảo mật tối đa.
                    </p>
                    <div className="word-table-wrapper" style={{ marginTop: '8px' }}>
                      <table className="word-table">
                        <thead>
                          <tr>
                            <th>Vị trí (Part)</th>
                            <th>Phân loại</th>
                            <th>Số lượng</th>
                            <th>Chuỗi khớp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {residualReport.findings.map((f, idx) => (
                            <tr key={idx}>
                              <td><code>{f.part}</code></td>
                              <td><span className="word-source-tag">{f.category}</span></td>
                              <td><b>{f.count}</b></td>
                              <td><code>{f.matchedString}</code></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {residualReport.status === 'FAIL' && (
                  <div className="residual-card fail">
                    <div className="residual-header">
                      <AlertCircle size={22} color="#dc2626" />
                      <span>KHÔNG ĐẠT (FAIL)</span>
                    </div>
                    <p className="residual-desc">
                      Còn sót danh tính hoặc email trong metadata tài liệu! Nút tải về bị khóa để phòng ngừa rò rỉ dữ liệu.
                    </p>
                    <div className="word-table-wrapper" style={{ marginTop: '8px' }}>
                      <table className="word-table">
                        <thead>
                          <tr>
                            <th>Vị trí (Part)</th>
                            <th>Phân loại</th>
                            <th>Số lượng</th>
                            <th>Chuỗi khớp</th>
                          </tr>
                        </thead>
                        <tbody>
                          {residualReport.findings.map((f, idx) => (
                            <tr key={idx}>
                              <td><code>{f.part}</code></td>
                              <td><span className="word-source-tag">{f.category}</span></td>
                              <td><b>{f.count}</b></td>
                              <td><code>{f.matchedString}</code></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Download Section */}
            {anonymizeResult && downloadBlobUrl && residualReport && (
              <div className="word-card">
                <div className="word-card-header">
                  <div className="word-card-title">
                    <Download size={20} />
                    <span>Tải về tài liệu đã xử lý</span>
                  </div>
                </div>

                {residualReport.status === 'FAIL' && (
                  <label className="word-option-item" style={{ background: '#fef2f2', padding: '12px', borderRadius: '6px', border: '1px solid #fecaca' }}>
                    <input
                      type="checkbox"
                      checked={acknowledgeRisk}
                      onChange={(e) => setAcknowledgeRisk(e.target.checked)}
                    />
                    <div className="word-option-label">
                      <b style={{ color: '#991b1b' }}>Tôi đã hiểu rủi ro</b>
                      <small style={{ color: '#7f1d1d' }}>
                        Tài liệu có cảnh báo FAIL, xác nhận tiếp tục tải về khi đã tự kiểm tra
                      </small>
                    </div>
                  </label>
                )}

                <div className="word-options-grid">
                  <label className="word-option-item">
                    <input
                      type="checkbox"
                      checked={keepOriginalName}
                      onChange={(e) => setKeepOriginalName(e.target.checked)}
                    />
                    <div className="word-option-label">
                      <b>Giữ tên gốc khi tải về</b>
                      <small>
                        Tên file đầu ra: <code>{getDownloadDocTitle()}</code>
                      </small>
                    </div>
                  </label>

                  <label className="word-option-item">
                    <input
                      type="checkbox"
                      checked={exportMappingJson}
                      onChange={(e) => setExportMappingJson(e.target.checked)}
                    />
                    <div className="word-option-label">
                      <b>Tải file mapping (JSON)</b>
                      <small>Xuất ánh xạ danh tính để đối chiếu nội bộ</small>
                    </div>
                  </label>

                  {exportMappingJson && (
                    <div className="word-alert warning" style={{ marginLeft: '26px' }}>
                      <AlertTriangle size={16} />
                      <div>
                        <span>File mapping chứa tên thật — chỉ lưu nội bộ, không upload lên công cụ AI.</span>
                        <div style={{ marginTop: '8px' }}>
                          <button className="secondary" onClick={handleDownloadMappingJson}>
                            <Download size={14} /> Tải mapping.json
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="word-actions-row" style={{ marginTop: '12px' }}>
                  {residualReport.status === 'FAIL' && !acknowledgeRisk ? (
                    <button type="button" disabled className="primary large disabled">
                      <Download size={18} /> Tải tài liệu đã ẩn danh
                    </button>
                  ) : (
                    <a
                      href={downloadBlobUrl}
                      download={getDownloadDocTitle()}
                      className="primary large"
                      style={{ textDecoration: 'none' }}
                    >
                      <Download size={18} /> Tải tài liệu đã ẩn danh
                    </a>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
