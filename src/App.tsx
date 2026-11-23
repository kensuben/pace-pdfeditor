import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileText,
  Highlighter, Image as ImageIcon, Minus, MousePointer2, PenLine,
  Plus, Redo2, RotateCw, Sparkles, Type, Undo2, Upload, LogIn, LogOut, ScanText,
  ImagePlus, FilePlus2, BadgeCheck, Trash2, ArrowUp, ArrowDown,
  Settings, BoxSelect,
} from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'
import type { Annotation, DocumentInfo, TextRegion, TextStyle, Tool } from './types'
import type { AccountInfo } from '@azure/msal-browser'
import { initializeAuth, isMicrosoftAuthConfigured, signInMicrosoft, signOutMicrosoft } from './auth'
import { recordActivity } from './activityLog'
import ActivityPanel from './ActivityPanel'
import AdminPage from './AdminPage'
import { apiRequest, authorizeSession, type ApiUser } from './api'
import WordAnonymizerPage from './word-anonymizer/WordAnonymizerPage'
import './pdf-editor/viewer.css'
import './pdf-editor/toolbar.css'
import {
  clamp, uid, IconButton, TextFormatBar,
  buildEditedPdfWithReport, findRemainingOriginalText, formatRemainingTextWarning,
  probeTextStyles, enrichRegionsWithStyles, getPageView, type TextStyleProbe,
  insertPdfPages, movePage, deletePage, rotatePage,
  remapAnnotationsOnInsert, remapAnnotationsOnMove, remapAnnotationsOnDelete,
  buildReplacementAnnotation, parseOcrTsv, groupOcrWordsIntoLines,
  imageInsertSize,
  PageList, ThumbnailList, ZoomMenu,
  canRotatePage, rotateAnnotationsCw, resetHistoryOnPageOp,
  fitZoom,
  SIDEBAR_OVERLAY_MAX_WIDTH,
  PropertiesPanel,
  useDesktopEditor,
  defaultAspectLockedForType,
  useToolbarLayout,
  ToolbarOverflowMenu,
} from './pdf-editor'

// Query version bypasses any previously cached worker response that may have
// been served with an incorrect MIME type before the Nginx fix.
pdfjs.GlobalWorkerOptions.workerSrc = `${workerUrl}?v=20260714-1`

const COLORS = ['#E85D3F', '#F5C84C', '#4FAF7B', '#3F7DD9', '#7B61B5', '#1F252B']

function formatBytes(bytes: number) {
  if (!bytes) return '0 KB'
  return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

function EmptyState({ onOpen }: { onOpen: () => void }) {
  return <main className="empty-state">
    <div className="empty-visual"><div className="paper back"/><div className="paper front"><FileText size={42}/><span/><span/><span className="short"/></div><Sparkles className="spark one"/><Sparkles className="spark two"/></div>
    <p className="eyebrow">PACE DIGITAL WORKSPACE</p>
    <h1>Chỉnh sửa tài liệu PDF<br/><em>nhanh chóng & bảo mật</em></h1>
    <p className="empty-copy">Thêm nội dung, đánh dấu, ghi chú và chữ ký ngay trên trình duyệt. Tài liệu luôn được xử lý an toàn trên thiết bị của bạn.</p>
    <button className="primary large" onClick={onOpen}><Upload size={18}/> Chọn tài liệu PDF</button>
    <p className="privacy"><Check size={14}/> Bảo mật tại thiết bị · Không tải tài liệu lên máy chủ</p>
    <div className="feature-strip">
      <div><Type/><span><b>Thêm nội dung</b><small>Đặt văn bản tại mọi vị trí</small></span></div>
      <div><Highlighter/><span><b>Đánh dấu</b><small>Làm nổi bật thông tin quan trọng</small></span></div>
      <div><PenLine/><span><b>Ghi chú & ký</b><small>Tương tác trực tiếp trên tài liệu</small></span></div>
    </div>
  </main>
}

function App() {
  const fileInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const insertPdfInput = useRef<HTMLInputElement>(null)
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [info, setInfo] = useState<DocumentInfo | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState(COLORS[0])
  const [history, setHistory] = useState<Annotation[][]>([[]])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidebar, setSidebar] = useState(true)
  const [busy, setBusy] = useState(false)
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)
  const [bytesVersion, setBytesVersion] = useState(0)
  const documentAreaRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const statusNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const zoomLogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [showActivities, setShowActivities] = useState(false)
  const [textRegions, setTextRegions] = useState<Record<number, TextRegion[]>>({})
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [textStyle, setTextStyle] = useState<TextStyle>({ fontFamily:'Be Vietnam Pro', fontSize:16, bold:false, italic:false, underline:false, align:'left', color:'#0C2340' })
  const [showDigitalSign, setShowDigitalSign] = useState(false)
  const [apiUser,setApiUser]=useState<ApiUser|null>(null)
  const [showAdmin,setShowAdmin]=useState(false)
  const isDesktop = useDesktopEditor()
  const [showBoundingBoxes, setShowBoundingBoxes] = useState<boolean>(() => {
    try {
      return localStorage.getItem('pace_show_bounding_boxes') === 'true'
    } catch {
      return false
    }
  })
  const toggleBoundingBoxes = () => {
    setShowBoundingBoxes((prev) => {
      const next = !prev
      try {
        localStorage.setItem('pace_show_bounding_boxes', String(next))
      } catch {
        // Ignore storage write errors in restricted environments
      }
      return next
    })
  }

  const [aspectLocked, setAspectLocked] = useState<boolean>(false)
  const [currentPageDimensions, setCurrentPageDimensions] = useState<{ width: number; height: number }>({
    width: 612,
    height: 792,
  })
  const [viewMode, setViewMode] = useState<'pdf' | 'word'>(() => {
    return typeof window !== 'undefined' && window.location.hash === '#/word-anonymizer' ? 'word' : 'pdf'
  })
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null)
  const toolbarLayout = useToolbarLayout(toolbarEl, { isDesktop })
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const menuDropdownRef = useRef<HTMLDivElement>(null)
  const wasMobileMenuOpenRef = useRef(false)

  useEffect(() => {
    if (mobileMenuOpen) {
      wasMobileMenuOpenRef.current = true
      const dropdown = menuDropdownRef.current
      if (dropdown) {
        const items = dropdown.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
        items[0]?.focus()
      }
    } else if (wasMobileMenuOpenRef.current) {
      wasMobileMenuOpenRef.current = false
      menuButtonRef.current?.focus()
    }
  }, [mobileMenuOpen])

  useEffect(() => {
    if (!mobileMenuOpen) return
    const handleClickOutside = (e: MouseEvent | PointerEvent) => {
      if (
        menuDropdownRef.current &&
        !menuDropdownRef.current.contains(e.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(e.target as Node)
      ) {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [mobileMenuOpen])

  const handleMobileMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setMobileMenuOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const dropdown = menuDropdownRef.current
      if (!dropdown) return
      const items = Array.from(dropdown.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'))
      if (!items.length) return
      const currentIndex = items.indexOf(document.activeElement as HTMLElement)
      const nextIndex = e.key === 'ArrowDown'
        ? (currentIndex >= 0 && currentIndex < items.length - 1 ? currentIndex + 1 : 0)
        : (currentIndex > 0 ? currentIndex - 1 : items.length - 1)
      items[nextIndex]?.focus()
    }
  }

  useEffect(() => {
    const handleHashChange = () => {
      setViewMode(window.location.hash === '#/word-anonymizer' ? 'word' : 'pdf')
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const switchView = (mode: 'pdf' | 'word') => {
    if (mode === 'word') {
      window.location.hash = '#/word-anonymizer'
    } else {
      window.location.hash = '#/'
    }
  }

  const annotations = history[historyIndex]

  const identity = useMemo(() => ({
    userId: account?.homeAccountId || 'local-user',
    userName: account?.name || account?.username || 'Local user',
  }), [account])

  const log = useCallback((action: string, description: string, metadata?: Record<string, string | number | boolean | null>, level: 'info' | 'success' | 'warning' | 'security' = 'info') => {
    recordActivity({ ...identity, action, description, metadata, level })
  }, [identity])

  useEffect(() => {
    initializeAuth().then(async(active) => {
      if(active){const session=await authorizeSession();setApiUser(session.user);setAccount(active);recordActivity({ userId: active.homeAccountId, userName: active.name || active.username, action: 'auth.session_restored', description: 'Khôi phục phiên đăng nhập Microsoft', level: 'security' })}
    }).catch(console.error).finally(() => setAuthReady(true))
  }, [])

  useEffect(()=>{if(!apiUser)return;const beat=()=>apiRequest('/api/heartbeat',{method:'POST',body:'{}'}).catch(console.error);beat();const timer=setInterval(beat,30000);return()=>clearInterval(timer)},[apiUser])

  const commit = useCallback((next: Annotation[], activity?: { action: string; description: string; metadata?: Record<string, string | number | boolean | null> }) => {
    setHistory((h) => [...h.slice(0, historyIndex + 1), next])
    setHistoryIndex((i) => i + 1)
    if (activity) log(activity.action, activity.description, activity.metadata)
  }, [historyIndex, log])

  const deleteSelected = useCallback(() => {
    if(!selectedId)return
    const removed=annotations.find((annotation)=>annotation.id===selectedId)
    if(!removed){setSelectedId(null);return}
    const next=removed.type==='text'&&removed.replaceOriginal?annotations.map((annotation)=>annotation.id===selectedId?{...annotation,text:''}:annotation):annotations.filter((annotation)=>annotation.id!==selectedId)
    commit(next,{action:'annotation.deleted',description:'Xóa textbox/annotation đã chọn',metadata:{type:removed.type,page:removed.page}})
    setSelectedId(null)
  },[annotations,commit,selectedId])

  const changeTextStyle = useCallback((patch: Partial<TextStyle>) => {
    setTextStyle((current)=>({...current,...patch}))
    const selected = annotations.find((a)=>a.id===selectedId && a.type==='text')
    if (selected) commit(annotations.map((a)=>a.id===selected.id?{...a,...patch}:a), { action:'text.format_changed', description:'Thay đổi định dạng văn bản', metadata:{ page:selected.page, properties:Object.keys(patch).join(',') } })
  }, [annotations, commit, selectedId])

  const selectAnnotation = useCallback((id: string | null) => {
    setSelectedId(id)
    const selected = annotations.find((a) => a.id === id)
    setAspectLocked(defaultAspectLockedForType(selected?.type))
    if (selected && selected.type === 'text') {
      setTextStyle({
        fontFamily: selected.fontFamily || 'Helvetica',
        fontSize: selected.fontSize || 16,
        bold: !!selected.bold,
        italic: !!selected.italic,
        underline: !!selected.underline,
        align: selected.align || 'left',
        color: selected.color,
      })
    }
  }, [annotations])

  // Centralized aspect lock management on selection change / undo / redo
  const prevSelectedRef = useRef<{ id: string | null; type?: string }>({ id: null, type: undefined })

  useEffect(() => {
    const selected = annotations.find((a) => a.id === selectedId)
    const currentType = selected?.type
    if (selectedId !== prevSelectedRef.current.id || currentType !== prevSelectedRef.current.type) {
      prevSelectedRef.current = { id: selectedId, type: currentType }
      setAspectLocked(defaultAspectLockedForType(currentType))
    }
  }, [selectedId, annotations])

  const targetPageNumber = useMemo(() => {
    const sel = annotations.find((a) => a.id === selectedId)
    return sel ? sel.page : page
  }, [annotations, selectedId, page])

  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    pdf.getPage(targetPageNumber).then((p) => {
      if (cancelled) return
      const vp = p.getViewport({ scale: 1 })
      setCurrentPageDimensions({ width: vp.width, height: vp.height })
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pdf, targetPageNumber])

  const showStatusNotice = useCallback((msg: string) => {
    setStatusNotice(msg)
    if (statusNoticeTimerRef.current) clearTimeout(statusNoticeTimerRef.current)
    statusNoticeTimerRef.current = setTimeout(() => {
      setStatusNotice(null)
      statusNoticeTimerRef.current = null
    }, 4000)
  }, [])

  const debouncedLogZoom = useCallback(
    (nextZoom: number) => {
      if (zoomLogTimerRef.current) clearTimeout(zoomLogTimerRef.current)
      zoomLogTimerRef.current = setTimeout(() => {
        log('view.zoom_changed', 'Thay đổi mức zoom', { zoom: Math.round(nextZoom * 100) })
        zoomLogTimerRef.current = null
      }, 500)
    },
    [log],
  )

  const scrollToPage = useCallback((targetPage: number) => {
    const container = scrollContainerRef.current || documentAreaRef.current
    if (!container) return
    const targetEl = container.querySelector(`[data-page-number="${targetPage}"]`)
    if (targetEl && typeof targetEl.scrollIntoView === 'function') {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const handleFitWidth = useCallback(async () => {
    if (!pdf) return
    const p = await pdf.getPage(page)
    const vp = p.getViewport({ scale: 1 })
    const container = scrollContainerRef.current || documentAreaRef.current
    const containerW = container?.clientWidth || window.innerWidth
    const nextZ = fitZoom({ width: containerW, height: 700 }, { width: vp.width, height: vp.height }, 'width')
    setZoom(nextZ)
    log('view.zoom_changed', 'Thay đổi mức zoom', { fit: 'width', zoom: Math.round(nextZ * 100) })
  }, [pdf, page, log])

  const handleFitPage = useCallback(async () => {
    if (!pdf) return
    const p = await pdf.getPage(page)
    const vp = p.getViewport({ scale: 1 })
    const container = scrollContainerRef.current || documentAreaRef.current
    const containerW = container?.clientWidth || window.innerWidth
    const containerH = container?.clientHeight || window.innerHeight
    const nextZ = fitZoom({ width: containerW, height: containerH }, { width: vp.width, height: vp.height }, 'page')
    setZoom(nextZ)
    log('view.zoom_changed', 'Thay đổi mức zoom', { fit: 'page', zoom: Math.round(nextZ * 100) })
  }, [pdf, page, log])

  const openFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return alert('Please choose a PDF file.')
    setBusy(true)
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const loaded = await pdfjs.getDocument({ data: data.slice() }).promise

      setBytes(data)
      setPdf(loaded)
      setInfo({ name: file.name, size: file.size, pages: loaded.numPages })
      setPage(1)
      setZoom(1)
      setHistory([[]])
      setHistoryIndex(0)
      setSelectedId(null)
      setTextRegions({})
      setBytesVersion((v) => v + 1)
      setSidebar(window.innerWidth > SIDEBAR_OVERLAY_MAX_WIDTH)
      log('document.opened', 'Mở tài liệu PDF', { fileExt: 'pdf', fileSize: file.size, pageCount: loaded.numPages }, 'success')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error('Unable to open PDF:', error)
      log('document.open_failed', 'Không thể mở tài liệu PDF', { fileExt: 'pdf', reason }, 'warning')
      alert(`Không thể mở tài liệu PDF.\n\nChi tiết: ${reason}`)
    }
    finally { setBusy(false) }
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        const nextZ = clamp(Math.round((zoom + 0.1) * 100) / 100, 0.25, 4)
        setZoom(nextZ)
        log('view.zoom_changed', 'Thay đổi mức zoom', { direction: 'in', zoom: Math.round(nextZ * 100) })
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        const nextZ = clamp(Math.round((zoom - 0.1) * 100) / 100, 0.25, 4)
        setZoom(nextZ)
        log('view.zoom_changed', 'Thay đổi mức zoom', { direction: 'out', zoom: Math.round(nextZ * 100) })
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault()
        handleFitWidth()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) setHistoryIndex((i) => Math.min(history.length - 1, i + 1))
        else setHistoryIndex((i) => Math.max(0, i - 1))
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault();deleteSelected() }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [deleteSelected, history.length, selectedId, zoom, log, handleFitWidth])

  const selectedText = useMemo(()=>annotations.find((a)=>a.id===selectedId&&a.type==='text'),[annotations,selectedId])
  const styleProbeCacheRef = useRef<{
    bytes: Uint8Array | null
    doc: PDFDocument | null
    probes: Map<number, TextStyleProbe[]>
  }>({
    bytes: null,
    doc: null,
    probes: new Map(),
  })

  const handleTextRegions = useCallback((targetPage: number, regions: TextRegion[]) => {
    setTextRegions((current) => ({
      ...current,
      [targetPage]: [...regions, ...(current[targetPage] || []).filter((x) => x.source === 'ocr')],
    }))

    if (!bytes) return

    ;(async () => {
      try {
        const cache = styleProbeCacheRef.current
        if (cache.bytes !== bytes) {
          cache.bytes = bytes
          cache.doc = null
          cache.probes.clear()
        }
        if (!cache.doc) {
          cache.doc = await PDFDocument.load(bytes)
        }
        let probes = cache.probes.get(targetPage)
        if (!probes) {
          const pageIndex = targetPage - 1
          if (pageIndex < 0 || pageIndex >= cache.doc.getPageCount()) return
          probes = probeTextStyles(cache.doc, pageIndex)
          cache.probes.set(targetPage, probes)
        }
        const pageIndex = targetPage - 1
        const pdfPage = cache.doc.getPage(pageIndex)
        const view = getPageView(pdfPage)
        const enriched = enrichRegionsWithStyles(regions, probes, view)
        const enrichedMap = new Map(enriched.map((r) => [r.id, r]))

        setTextRegions((current) => {
          const pageRegions = current[targetPage]
          if (!pageRegions) return current
          let changed = false
          const nextRegions = pageRegions.map((r) => {
            if (r.source === 'ocr') return r
            const updated = enrichedMap.get(r.id)
            if (
              updated &&
              (r.color !== updated.color ||
                r.fontFamily !== updated.fontFamily ||
                r.bold !== updated.bold ||
                r.italic !== updated.italic)
            ) {
              changed = true
              return {
                ...r,
                color: updated.color,
                fontFamily: updated.fontFamily,
                bold: updated.bold,
                italic: updated.italic,
              }
            }
            return r
          })
          if (!changed) return current
          return {
            ...current,
            [targetPage]: nextRegions,
          }
        })
      } catch (err) {
        console.warn('probeTextStyles failed:', err)
      }
    })()
  }, [bytes])

  const buildPdfBytes = useCallback(async () => {
    if (!bytes) throw new Error('Chưa có tài liệu để xử lý.')
    let { bytes: outBytes, report } = await buildEditedPdfWithReport(bytes, annotations)

    const checks = annotations
      .filter((a) => a.type === 'text' && a.replaceOriginal && a.originalText)
      .map((a) => ({
        page: a.page,
        rect: a.originalRect || { x: a.x, y: a.y, width: a.width, height: a.height },
        originalText: a.originalText!,
        newText: a.text || '',
      }))

    if (checks.length > 0) {
      const remainingPages = await findRemainingOriginalText(outBytes, checks)
      const unmaskedResidualPages = remainingPages.filter((p) => !report.maskedPages.includes(p))

      if (unmaskedResidualPages.length > 0) {
        const rebuild = await buildEditedPdfWithReport(bytes, annotations, {
          forceMaskPages: unmaskedResidualPages,
        })
        outBytes = rebuild.bytes
        report = rebuild.report
      }

      for (const p of remainingPages) {
        const regCount = checks.filter((c) => c.page === p).length
        report.warnings.push({
          page: p,
          reason: 'residual-text',
          regionCount: regCount,
        })
      }
      report.warnings.sort((a, b) => a.page - b.page)
    }

    return { bytes: outBytes, report }
  }, [bytes, annotations])

  const exportPdf = async () => {
    if (!bytes || !info) return
    setBusy(true)
    try {
      const { bytes: out, report } = await buildPdfBytes()
      if (report.warnings.length > 0) {
        const confirmMsg = formatRemainingTextWarning(report.warnings)
        const confirmed = window.confirm(confirmMsg)
        if (!confirmed) {
          const pagesStr = Array.from(new Set(report.warnings.map((w) => w.page)))
            .sort((a, b) => a - b)
            .join(',')
          const regionCount = report.warnings.reduce((sum, w) => sum + w.regionCount, 0)
          log(
            'document.export_cancelled',
            'Huỷ xuất tài liệu PDF do còn chữ cũ',
            { reason: 'remaining_text', pages: pagesStr, regionCount },
            'warning'
          )
          return
        }
      }

      const blob = new Blob([out as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = info.name.replace(/\.pdf$/i, '') + '-edited.pdf'
      a.click()
      URL.revokeObjectURL(url)

      const remainingPagesStr = Array.from(new Set(report.warnings.map((w) => w.page)))
        .sort((a, b) => a - b)
        .join(',')

      log(
        'document.exported',
        'Xuất tài liệu PDF thành công',
        {
          fileExt: 'pdf',
          annotationCount: annotations.length,
          pageCount: info.pages,
          editedPageCount: report.editedPages.length,
          cleanedPageCount: report.cleanedPages.length,
          remainingTextPages: remainingPagesStr,
          overflowPageCount: report.overflowPages.length,
        },
        'success'
      )

      if (report.overflowPages.length > 0) {
        const pagesStr = report.overflowPages.join(', ')
        showStatusNotice(`Trang ${pagesStr}: đoạn đã sửa dài hơn đoạn gốc, chữ có thể đè lên nội dung bên dưới.`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      let reason: 'font_load_failed' | 'missing_glyph' | 'unknown' = 'unknown'
      if (msg.startsWith('FONT_LOAD_FAILED:')) {
        reason = 'font_load_failed'
        alert('Không tải được phông chữ để xuất PDF. Kiểm tra mạng rồi thử lại.')
      } else if (msg.startsWith('MISSING_GLYPH:')) {
        reason = 'missing_glyph'
        const chars = msg.slice('MISSING_GLYPH:'.length).trim()
        alert(`Phông chữ không hỗ trợ ký tự: ${chars}`)
      } else {
        alert('Could not export this PDF.')
      }
      log('document.export_failed', 'Xuất tài liệu PDF thất bại', { fileExt: 'pdf', reason }, 'warning')
    } finally { setBusy(false) }
  }

  const insertImage = async (file: File) => {
    if(!file.type.match(/^image\/(png|jpeg)$/)){alert('Chỉ hỗ trợ ảnh PNG hoặc JPEG.');return}
    if (!pdf) return
    const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file)})
    const image=new Image();image.src=dataUrl;await image.decode()
    const pageObj = await pdf.getPage(page)
    const viewport = pageObj.getViewport({ scale: 1 })
    const { width, height } = imageInsertSize(
      { w: image.width, h: image.height },
      { width: viewport.width, height: viewport.height },
    )
    const annotation:Annotation={id:uid(),page,type:'image',x:(1-width)/2,y:(1-height)/2,width,height,color:'#000000',opacity:1,imageDataUrl:dataUrl}
    commit([...annotations,annotation],{action:'image.inserted',description:'Chèn hình ảnh',metadata:{page,fileExt:file.type.includes('png')?'png':'jpeg',fileSize:file.size}})
    selectAnnotation(annotation.id)
  }

  const insertPages = async (file: File) => {
    if(!bytes||!pdf||!info)return
    setBusy(true)
    try{
      const sourceBytes = new Uint8Array(await file.arrayBuffer())
      const { bytes: merged, insertedCount: count } = await insertPdfPages(bytes, sourceBytes, page)
      const loaded = await pdfjs.getDocument({ data: merged.slice() }).promise
      const updatedAnnotations = remapAnnotationsOnInsert(annotations, page, count)
      const { history: newHistory, historyIndex: newHistoryIndex } = resetHistoryOnPageOp(updatedAnnotations)
      setBytes(merged);setPdf(loaded);setInfo({...info,size:merged.byteLength,pages:loaded.numPages})
      setHistory(newHistory);setHistoryIndex(newHistoryIndex)
      setTextRegions({});setPage(page+1);setBytesVersion((v)=>v+1)
      showStatusNotice('Thao tác trang không hoàn tác được')
      log('pages.inserted', 'Chèn trang từ PDF khác', { afterPage: page, insertedPages: count, fileExt: 'pdf' })
    }catch(error){console.error(error);alert(`Không thể chèn trang PDF.\n\n${error instanceof Error?error.message:String(error)}`)}finally{setBusy(false)}
  }

  const moveCurrentPage = async (direction:-1|1) => {
    if(!bytes||!info)return
    const from=page-1,to=from+direction
    if(to<0||to>=info.pages)return
    setBusy(true)
    try{
      const updatedBytes = await movePage(bytes, from, to)
      const loaded = await pdfjs.getDocument({ data: updatedBytes.slice() }).promise
      const fromPage=from+1,toPage=to+1
      const updatedAnnotations = remapAnnotationsOnMove(annotations, fromPage, toPage)
      const { history: newHistory, historyIndex: newHistoryIndex } = resetHistoryOnPageOp(updatedAnnotations)
      setBytes(updatedBytes);setPdf(loaded);setInfo({...info,size:updatedBytes.byteLength});setTextRegions({});setPage(toPage);setSelectedId(null)
      setHistory(newHistory);setHistoryIndex(newHistoryIndex);setBytesVersion((v)=>v+1)
      showStatusNotice('Thao tác trang không hoàn tác được')
      log('page.moved', direction < 0 ? 'Di chuyển trang lên' : 'Di chuyển trang xuống', { from: fromPage, to: toPage })
    }catch(error){console.error(error);alert(`Không thể di chuyển trang.\n\n${error instanceof Error?error.message:String(error)}`)}finally{setBusy(false)}
  }

  const deleteCurrentPage = async () => {
    if(!bytes||!info)return
    if(info.pages<=1){alert('Tài liệu phải còn ít nhất một trang.');return}
    if(!window.confirm(`Xóa trang ${page}?`))return
    setBusy(true)
    try{
      const updatedBytes = await deletePage(bytes, page - 1)
      const loaded = await pdfjs.getDocument({ data: updatedBytes.slice() }).promise
      const updatedAnnotations = remapAnnotationsOnDelete(annotations, page)
      const nextPage=Math.min(page,loaded.numPages)
      const { history: newHistory, historyIndex: newHistoryIndex } = resetHistoryOnPageOp(updatedAnnotations)
      setBytes(updatedBytes);setPdf(loaded);setInfo({...info,size:updatedBytes.byteLength,pages:loaded.numPages});setTextRegions({});setPage(nextPage);setSelectedId(null)
      setHistory(newHistory);setHistoryIndex(newHistoryIndex);setBytesVersion((v)=>v+1)
      showStatusNotice('Thao tác trang không hoàn tác được')
      log('page.deleted', 'Xóa trang PDF', { page, remainingPages: loaded.numPages })
    }catch(error){console.error(error);alert(`Không thể xóa trang.\n\n${error instanceof Error?error.message:String(error)}`)}finally{setBusy(false)}
  }

  const rotateCurrentPage = async () => {
    if (!bytes || !pdf || !info) return
    if (!canRotatePage(annotations, page)) return
    setBusy(true)
    try {
      const updatedBytes = await rotatePage(bytes, page - 1, 90)
      const loaded = await pdfjs.getDocument({ data: updatedBytes.slice() }).promise
      const oldPage = await pdf.getPage(page)
      const oldVp = oldPage.getViewport({ scale: 1 })
      const newPage = await loaded.getPage(page)
      const newVp = newPage.getViewport({ scale: 1 })
      const updatedAnnotations = rotateAnnotationsCw(
        annotations,
        page,
        { width: oldVp.width, height: oldVp.height },
        { width: newVp.width, height: newVp.height },
      )
      const { history: newHistory, historyIndex: newHistoryIndex } = resetHistoryOnPageOp(updatedAnnotations)
      setBytes(updatedBytes)
      setPdf(loaded)
      setHistory(newHistory)
      setHistoryIndex(newHistoryIndex)
      setTextRegions({})
      setSelectedId(null)
      setBytesVersion((v) => v + 1)
      showStatusNotice('Thao tác trang không hoàn tác được')
      log('page.rotated', 'Xoay trang', { page, angle: 90 })
    } catch (error) {
      console.error(error)
      alert(`Không thể xoay trang.\n\n${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  const editTextRegion = useCallback((region: TextRegion, next: string) => {
    if (next === region.text) return
    const neighbors=textRegions[region.page]||[]
    const replacement = buildReplacementAnnotation(region, next, neighbors, undefined, currentPageDimensions.width)
    commit([...annotations,replacement], { action:'text_region.edited', description:'Chỉnh sửa vùng chữ', metadata:{ page:region.page, source:region.source } })
    setSelectedId(replacement.id)
    setTextRegions((current)=>({...current,[region.page]:(current[region.page]||[]).filter((x)=>x.id!==region.id)}))
  }, [annotations, commit, textRegions, currentPageDimensions.width])

  const editTextAnnotation = useCallback((annotation: Annotation, next: string) => {
    if(next===annotation.text)return
    commit(annotations.map((a)=>a.id===annotation.id?{...a,text:next,backgroundColor:annotation.backgroundColor}:a),{action:'text.content_changed',description:'Chỉnh sửa nội dung văn bản',metadata:{page:annotation.page}})
  },[annotations,commit])

  const scanCurrentPage = async () => {
    if (!pdf || ocrBusy) return
    setOcrBusy(true); setOcrProgress(0)
    try {
      const pdfPage = await pdf.getPage(page), viewport = pdfPage.getViewport({scale:2})
      const canvas = document.createElement('canvas'); canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height)
      await pdfPage.render({canvas,viewport}).promise
      const { createWorker } = await import('tesseract.js')
      const worker = await createWorker(['vie','eng'], undefined, { logger:(m)=>{if(m.status==='recognizing text')setOcrProgress(Math.round(m.progress*100))} })
      const result = await worker.recognize(canvas, {}, { tsv:true })
      await worker.terminate()
      const tsv = result.data.tsv || ''
      const words = parseOcrTsv(tsv, page, canvas.width, canvas.height)
      const regions = groupOcrWordsIntoLines(words, page)
      setTextRegions((current)=>({...current,[page]:[...(current[page]||[]).filter((x)=>x.source!=='ocr'),...regions]}))
      log('ocr.page_scanned','OCR trang tài liệu',{page,regionCount:regions.length},'success')
      if(!regions.length)alert('OCR hoàn tất nhưng không tìm thấy vùng chữ đủ độ tin cậy.')
    } catch(error) { console.error(error); log('ocr.scan_failed','OCR trang thất bại',{page,reason:error instanceof Error?error.message:String(error)},'warning');alert(`Không thể OCR trang này.\n\n${error instanceof Error?error.message:String(error)}`) }
    finally { setOcrBusy(false);setOcrProgress(0) }
  }

  const signDocument = async (mode:'usb-token'|'remote-token') => {
    const endpoint=mode==='usb-token'?import.meta.env.VITE_USB_SIGNING_AGENT_URL:import.meta.env.VITE_SIGNING_API_URL
    if(!endpoint){alert(mode==='usb-token'?'Chưa cấu hình VITE_USB_SIGNING_AGENT_URL và middleware USB Token.':'Chưa cấu hình VITE_SIGNING_API_URL của nhà cung cấp Remote Signing.');return}
    if(!info)return
    setBusy(true)
    try{
      const { bytes: finalBytes, report } = await buildPdfBytes()
      if (report.warnings.length > 0) {
        const confirmMsg = formatRemainingTextWarning(report.warnings)
        const confirmed = window.confirm(confirmMsg)
        if (!confirmed) {
          const pagesStr = Array.from(new Set(report.warnings.map((w) => w.page)))
            .sort((a, b) => a - b)
            .join(',')
          const regionCount = report.warnings.reduce((sum, w) => sum + w.regionCount, 0)
          log(
            'signature.digital_cancelled',
            'Huỷ ký số tài liệu do còn chữ cũ',
            { reason: 'remaining_text', pages: pagesStr, regionCount },
            'warning'
          )
          return
        }
      }

      const form=new FormData()
      form.append('file',new Blob([finalBytes as BlobPart],{type:'application/pdf'}),info.name.replace(/\.pdf$/i,'')+'-final.pdf')
      form.append('mode',mode);form.append('reason','PACE PDF Workspace electronic signature')
      const response=await fetch(`${String(endpoint).replace(/\/$/,'')}/v1/pdf/sign`,{method:'POST',body:form,credentials:'include'})
      if(!response.ok)throw new Error((await response.text())||`Signing service returned ${response.status}`)
      const signed=await response.blob(),url=URL.createObjectURL(signed),a=document.createElement('a');a.href=url;a.download=info.name.replace(/\.pdf$/i,'')+'-signed.pdf';a.click();URL.revokeObjectURL(url)
      log('signature.digital_completed','Ký số tài liệu thành công',{mode,fileExt:'pdf'},'security');setShowDigitalSign(false)
    }catch(error){console.error(error);log('signature.digital_failed','Ký số tài liệu thất bại',{mode,reason:error instanceof Error?error.message:String(error)},'warning');alert(`Không thể ký số.\n\n${error instanceof Error?error.message:String(error)}`)}finally{setBusy(false)}
  }

  const login = async () => {
    if (!isMicrosoftAuthConfigured) {
      // Đăng nhập giả lập ở DEV khi chưa cấu hình Microsoft Entra. Xem chi tiết tại README.md (mục "Chạy dự án").
      if (import.meta.env.DEV) {
        const mockAccount: AccountInfo = {
          homeAccountId: 'mock-account-id',
          environment: 'login.windows.net',
          tenantId: 'mock-tenant-id',
          username: 'hocvien.test01@example.com',
          localAccountId: 'mock-local-id',
          name: 'Học viên Test 01',
        }
        setAccount(mockAccount)
        setApiUser({
          id: 'mock-user-id',
          email: 'hocvien.test01@example.com',
          name: 'Học viên Test 01',
          role: 'user',
          active: true,
          groupIds: [],
        })
        recordActivity({
          userId: mockAccount.homeAccountId,
          userName: mockAccount.name || mockAccount.username,
          action: 'auth.login',
          description: 'Đăng nhập giả lập môi trường DEV',
          level: 'security',
          metadata: { username: mockAccount.username },
        })
        return
      }
      alert('Microsoft Login chưa được cấu hình. Hãy sao chép .env.example thành .env và điền VITE_MICROSOFT_CLIENT_ID.')
      return
    }
    setBusy(true)
    try { const signedIn = await signInMicrosoft();const session=await authorizeSession();setApiUser(session.user);setAccount(signedIn);recordActivity({ userId: signedIn.homeAccountId, userName: signedIn.name || signedIn.username, action: 'auth.login', description: 'Đăng nhập bằng Microsoft', level: 'security', metadata: { username: signedIn.username } }) }
    catch (error) { console.error(error);await signOutMicrosoft().catch(()=>{});alert(error instanceof Error?error.message:'Tài khoản không được phép sử dụng hệ thống.') }
    finally { setBusy(false) }
  }
  const logout = async () => {
    log('auth.logout', 'Đăng xuất tài khoản Microsoft', undefined, 'security')
    setBusy(true); try { await signOutMicrosoft(); setAccount(null);setApiUser(null); setShowActivities(false);setShowAdmin(false) } finally { setBusy(false) }
  }

  return <div className="app">
    <input ref={fileInput} hidden type="file" accept="application/pdf,.pdf" onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])}/>
    <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg" onChange={(e)=>{const file=e.target.files?.[0];if(file)insertImage(file);e.target.value=''}}/>
    <input ref={insertPdfInput} hidden type="file" accept="application/pdf,.pdf" onChange={(e)=>{const file=e.target.files?.[0];if(file)insertPages(file);e.target.value=''}}/>
    <header className="topbar">
      <button className="brand" onClick={() => (viewMode === 'pdf' ? fileInput.current?.click() : switchView('pdf'))}><img className="official-logo" src="/pace-logo.svg" alt="PACE Institute of Management"/><span className="product-name">PDF Workspace<small>DOCUMENT EDITOR</small></span></button>
      <div className="view-switcher" role="tablist" aria-label="Bộ chọn chế độ">
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'pdf'}
          className={`view-tab ${viewMode === 'pdf' ? 'active' : ''}`}
          onClick={() => switchView('pdf')}
        >
          PDF Editor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'word'}
          className={`view-tab ${viewMode === 'word' ? 'active' : ''}`}
          onClick={() => switchView('word')}
        >
          Ẩn danh Word
        </button>
      </div>
      {viewMode === 'pdf' && info && (
        <div className="file-title" title={info.name}>
          <FileText size={17} />
          <span>{info.name}</span>
          <small>{formatBytes(info.size)}</small>
        </div>
      )}
      <div className="top-actions">
        {viewMode === 'pdf' && info && <><button className="secondary desktop-only" onClick={() => fileInput.current?.click()}><Upload size={16}/> Mở file</button><button className="primary desktop-only" onClick={exportPdf} disabled={busy}><Download size={16}/> Xuất PDF</button></>}
        <a href="/huong-dan/" target="_blank" rel="noopener" className="topbar-help-link desktop-only" aria-label="Hướng dẫn sử dụng" title="Hướng dẫn sử dụng"><BookOpen size={16}/><span>Hướng dẫn</span></a>
        {account ? <div className="account-menu desktop-only"><button className="activity-button" onClick={() => setShowActivities(true)} title="Activity log"><Activity/></button>{apiUser?.role==='admin'&&<button className="activity-button" onClick={()=>setShowAdmin(true)} title="Administration"><Settings/></button>}<button className="user-chip" title={account.username}><span>{(account.name || account.username).split(' ').map((x) => x[0]).slice(0,2).join('').toUpperCase()}</span><b>{account.name || account.username}</b></button><button className="logout-button" onClick={logout} title="Đăng xuất"><LogOut/></button></div> : <button className="microsoft-login desktop-only" onClick={login} disabled={!authReady}><span className="ms-logo"><i/><i/><i/><i/></span><LogIn/> Sign in with Microsoft</button>}
        {viewMode === 'pdf' && info && (
          <button
            type="button"
            className="primary mobile-export-btn"
            aria-label="Xuất PDF"
            title="Xuất PDF"
            onClick={exportPdf}
            disabled={busy}
          >
            <Download size={16}/>
          </button>
        )}
        <button
          ref={menuButtonRef}
          type="button"
          className="mobile-menu-btn"
          aria-label="Thêm thao tác"
          aria-haspopup="menu"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          ⋯
        </button>
        {mobileMenuOpen && (
          <div
            ref={menuDropdownRef}
            className="mobile-dropdown-menu"
            role="menu"
            aria-label="Menu thao tác"
            onKeyDown={handleMobileMenuKeyDown}
          >
            {viewMode === 'pdf' && info && (
              <button
                type="button"
                role="menuitem"
                className="mobile-menu-item"
                onClick={() => {
                  setMobileMenuOpen(false)
                  fileInput.current?.click()
                }}
              >
                <Upload size={16}/> Mở file
              </button>
            )}
            <a
              role="menuitem"
              href="/huong-dan/"
              target="_blank"
              rel="noopener"
              className="mobile-menu-item"
              onClick={() => setMobileMenuOpen(false)}
            >
              <BookOpen size={16}/> Hướng dẫn
            </a>
            {account ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="mobile-menu-item"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    setShowActivities(true)
                  }}
                >
                  <Activity size={16}/> Activity log
                </button>
                {apiUser?.role === 'admin' && (
                  <button
                    type="button"
                    role="menuitem"
                    className="mobile-menu-item"
                    onClick={() => {
                      setMobileMenuOpen(false)
                      setShowAdmin(true)
                    }}
                  >
                    <Settings size={16}/> Administration
                  </button>
                )}
                <div className="mobile-menu-username" aria-disabled="true">
                  {account.name || account.username}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="mobile-menu-item logout"
                  onClick={() => {
                    setMobileMenuOpen(false)
                    logout()
                  }}
                >
                  <LogOut size={16}/> Đăng xuất
                </button>
              </>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="mobile-menu-item"
                onClick={() => {
                  setMobileMenuOpen(false)
                  login()
                }}
                disabled={!authReady}
              >
                <LogIn size={16}/> Đăng nhập Microsoft
              </button>
            )}
          </div>
        )}
      </div>
    </header>

    {viewMode === 'word' ? (
      <WordAnonymizerPage
        account={account}
        apiUser={apiUser}
        authReady={authReady}
        onSignInMicrosoft={login}
        log={log}
      />
    ) : !pdf || !info ? (
      <EmptyState onOpen={() => fileInput.current?.click()}/>
    ) : (
      <div className="workspace">
      <aside className={`sidebar ${sidebar ? '' : 'collapsed'}`}>
        <div className="sidebar-head"><b>Pages</b><button onClick={() => setSidebar(false)}><ChevronLeft/></button></div>
        <ThumbnailList
          pdf={pdf}
          pageCount={info.pages}
          currentPage={page}
          onSelectPage={(p) => {
            scrollToPage(p)
            setPage(p)
            if (window.innerWidth <= SIDEBAR_OVERLAY_MAX_WIDTH) {
              setSidebar(false)
            }
            log('navigation.page_changed', 'Chuyển trang', { from: page, to: p })
          }}
          bytesVersion={bytesVersion}
        />
      </aside>
      {!sidebar && <button className="show-sidebar" onClick={() => setSidebar(true)}><ChevronRight/></button>}
      <section className="editor">
        <div ref={setToolbarEl} className="toolbar">
          <div className="tool-group">
            {([['select',MousePointer2,'Chọn'],['text',Type,'Thêm chữ'],['highlight',Highlighter,'Đánh dấu'],['draw',PenLine,'Vẽ'],['signature',ImageIcon,'Chữ ký']] as const).map(([id,Icon,label]) => <button key={id} className={`tool ${tool===id?'active':''}`} onClick={() => setTool(id)}><Icon/><span>{label}</span></button>)}
          </div>
          <div className="divider"/>
          <div className="colors">{COLORS.map((c) => <button key={c} aria-label={`Color ${c}`} className={color===c?'active':''} style={{background:c}} onClick={() => {setColor(c);if(tool==='text'||selectedText)changeTextStyle({color:c})}}/>)}</div>
          <div className="toolbar-spacer"/>

          {!toolbarLayout.hiddenGroups.includes('insert') && (
            <>
              <button
                className={`action-tool ${toolbarLayout.mode === 'compact' ? 'compact' : ''}`}
                aria-label="Chèn ảnh"
                title="Chèn ảnh"
                onClick={() => imageInput.current?.click()}
              >
                <ImagePlus />
                {toolbarLayout.mode === 'full' && 'Chèn ảnh'}
              </button>
              <button
                className={`action-tool ${toolbarLayout.mode === 'compact' ? 'compact' : ''}`}
                aria-label="Chèn trang"
                title="Chèn trang"
                onClick={() => insertPdfInput.current?.click()}
              >
                <FilePlus2 />
                {toolbarLayout.mode === 'full' && 'Chèn trang'}
              </button>
            </>
          )}

          {!toolbarLayout.hiddenGroups.includes('page') && (
            <>
              <IconButton label="Di chuyển trang lên" onClick={() => moveCurrentPage(-1)} disabled={page === 1}>
                <ArrowUp />
              </IconButton>
              <IconButton label="Di chuyển trang xuống" onClick={() => moveCurrentPage(1)} disabled={page === info.pages}>
                <ArrowDown />
              </IconButton>
              {(() => {
                const canRotate = canRotatePage(annotations, page)
                const rotateLabel = canRotate
                  ? 'Xoay trang'
                  : 'Trang có chữ đã sửa, chưa xoay được (sẽ hỗ trợ khi xoá chữ gốc thật)'
                return (
                  <span title={rotateLabel}>
                    <IconButton
                      label={rotateLabel}
                      onClick={rotateCurrentPage}
                      disabled={!canRotate}
                    >
                      <RotateCw />
                    </IconButton>
                  </span>
                )
              })()}
              <IconButton label="Xóa trang hiện tại" onClick={deleteCurrentPage} disabled={info.pages <= 1}>
                <Trash2 />
              </IconButton>
            </>
          )}

          {!toolbarLayout.hiddenGroups.includes('signOcr') && (
            <>
              <button
                className={`action-tool sign ${toolbarLayout.mode === 'compact' ? 'compact' : ''}`}
                aria-label="Ký số"
                title="Ký số"
                onClick={() => setShowDigitalSign(true)}
              >
                <BadgeCheck />
                {toolbarLayout.mode === 'full' && 'Ký số'}
              </button>
              <button
                className={`ocr-button ${ocrBusy ? 'busy' : ''} ${toolbarLayout.mode === 'compact' ? 'compact' : ''}`}
                aria-label={ocrBusy ? `OCR ${ocrProgress}%` : 'Scan OCR'}
                title={ocrBusy ? `OCR ${ocrProgress}%` : 'Scan OCR'}
                onClick={scanCurrentPage}
                disabled={ocrBusy}
              >
                <ScanText />
                {toolbarLayout.mode === 'full' && (ocrBusy ? `OCR ${ocrProgress}%` : 'Scan OCR')}
              </button>
            </>
          )}

          {isDesktop && !toolbarLayout.hiddenGroups.includes('boundingBox') && (
            <IconButton
              label={showBoundingBoxes ? 'Ẩn khung bao' : 'Hiện khung bao'}
              active={showBoundingBoxes}
              onClick={toggleBoundingBoxes}
            >
              <BoxSelect />
            </IconButton>
          )}

          <ToolbarOverflowMenu
            hiddenGroups={toolbarLayout.hiddenGroups}
            onInsertImage={() => imageInput.current?.click()}
            onInsertPage={() => insertPdfInput.current?.click()}
            page={page}
            pageCount={info.pages}
            onMovePage={moveCurrentPage}
            onRotatePage={rotateCurrentPage}
            canRotate={canRotatePage(annotations, page)}
            rotateLabel={
              canRotatePage(annotations, page)
                ? 'Xoay trang'
                : 'Trang có chữ đã sửa, chưa xoay được (sẽ hỗ trợ khi xoá chữ gốc thật)'
            }
            onDeletePage={deleteCurrentPage}
            onSign={() => setShowDigitalSign(true)}
            onScanOcr={scanCurrentPage}
            ocrBusy={ocrBusy}
            ocrProgress={ocrProgress}
            showBoundingBoxes={showBoundingBoxes}
            onToggleBoundingBoxes={isDesktop ? toggleBoundingBoxes : undefined}
          />

          <IconButton label="Xóa đối tượng đã chọn" onClick={deleteSelected} disabled={!selectedId}><Trash2/></IconButton>
          <IconButton label="Undo" onClick={() => { setHistoryIndex(i=>Math.max(0,i-1)); log('edit.undo', 'Hoàn tác thay đổi') }} disabled={!historyIndex}><Undo2/></IconButton>
          <IconButton label="Redo" onClick={() => { setHistoryIndex(i=>Math.min(history.length-1,i+1)); log('edit.redo', 'Làm lại thay đổi') }} disabled={historyIndex===history.length-1}><Redo2/></IconButton>
        </div>
        {!isDesktop && (tool === 'text' || selectedText) && (
          <div className="text-format-bar-floating">
            <TextFormatBar style={textStyle} onChange={changeTextStyle} />
          </div>
        )}
        <div className="editor-body">
          <div
            ref={documentAreaRef}
            className="document-area has-page-list"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files[0]
              if (f) openFile(f)
            }}
          >
            <PageList
              pdf={pdf}
              pageCount={info.pages}
              zoom={zoom}
              annotations={annotations}
              tool={tool}
              color={color}
              textStyle={textStyle}
              selectedId={selectedId}
              onSelect={selectAnnotation}
              onAdd={(a) => {
                const next = a.type === 'text' ? { ...a, ...textStyle } : a
                commit([...annotations, next], {
                  action: 'annotation.added',
                  description: 'Thêm annotation',
                  metadata: { type: a.type, page: a.page, color: next.color },
                })
                setSelectedId(next.id)
              }}
              onUpdate={(updated) => {
                commit(
                  annotations.map((annotation) => (annotation.id === updated.id ? updated : annotation)),
                  {
                    action: 'annotation.moved',
                    description: 'Di chuyển đối tượng',
                    metadata: { type: updated.type, page: updated.page },
                  },
                )
                setSelectedId(updated.id)
              }}
              onResize={(updated) => {
                commit(
                  annotations.map((annotation) => (annotation.id === updated.id ? updated : annotation)),
                  {
                    action: 'annotation.resized',
                    description: 'Thay đổi kích thước đối tượng',
                    metadata: { type: updated.type, page: updated.page },
                  },
                )
                setSelectedId(updated.id)
              }}
              onNudge={(updated) => {
                commit(annotations.map((annotation) => (annotation.id === updated.id ? updated : annotation)))
                setSelectedId(updated.id)
              }}
              textRegions={textRegions}
              onTextRegions={handleTextRegions}
              onEditRegion={editTextRegion}
              onEditAnnotation={editTextAnnotation}
              currentPage={page}
              onCurrentPageChange={(p) => setPage(p)}
              containerRef={scrollContainerRef}
              onZoomChange={(nextZoom) => {
                setZoom(nextZoom)
                debouncedLogZoom(nextZoom)
              }}
              onInitialFit={(initialZoom) => {
                setZoom(initialZoom)
                log('view.zoom_changed', 'Thay đổi mức zoom ban đầu', { fit: 'width', zoom: Math.round(initialZoom * 100) })
              }}
              showBoundingBoxes={showBoundingBoxes}
              aspectLocked={aspectLocked}
            />
          </div>
          {isDesktop && (
            <PropertiesPanel
              selectedAnnotation={annotations.find((a) => a.id === selectedId) || null}
              pageSizePt={currentPageDimensions}
              tool={tool}
              textStyle={textStyle}
              onTextStyleChange={changeTextStyle}
              onUpdateAnnotation={(updated, kind) => {
                if (kind === 'move') {
                  commit(
                    annotations.map((a) => (a.id === updated.id ? updated : a)),
                    {
                      action: 'annotation.moved',
                      description: 'Di chuyển đối tượng',
                      metadata: { type: updated.type, page: updated.page },
                    },
                  )
                } else if (kind === 'resize') {
                  commit(
                    annotations.map((a) => (a.id === updated.id ? updated : a)),
                    {
                      action: 'annotation.resized',
                      description: 'Thay đổi kích thước đối tượng',
                      metadata: { type: updated.type, page: updated.page },
                    },
                  )
                } else {
                  commit(
                    annotations.map((a) => (a.id === updated.id ? updated : a)),
                    {
                      action: 'annotation.updated',
                      description: 'Cập nhật đối tượng',
                      metadata: { type: updated.type, page: updated.page },
                    },
                  )
                }
                setSelectedId(updated.id)
              }}
              aspectLocked={aspectLocked}
              onToggleAspectLock={setAspectLocked}
            />
          )}
        </div>
        <div className="statusbar">
          <div className="page-nav">
            <IconButton
              label="Previous page"
              disabled={page === 1}
              onClick={() => {
                const nextP = page - 1
                scrollToPage(nextP)
                setPage(nextP)
                log('navigation.page_changed', 'Chuyển trang', { from: page, to: nextP })
              }}
            >
              <ChevronLeft />
            </IconButton>
            <span>
              <input
                value={page}
                onChange={(e) => {
                  const next = clamp(Number(e.target.value) || 1, 1, info.pages)
                  scrollToPage(next)
                  setPage(next)
                  log('navigation.page_changed', 'Chuyển trang', { from: page, to: next })
                }}
              />{' '}
              / {info.pages}
            </span>
            <IconButton
              label="Next page"
              disabled={page === info.pages}
              onClick={() => {
                const nextP = page + 1
                scrollToPage(nextP)
                setPage(nextP)
                log('navigation.page_changed', 'Chuyển trang', { from: page, to: nextP })
              }}
            >
              <ChevronRight />
            </IconButton>
          </div>
          <div className="zoom">
            <IconButton
              label="Zoom out"
              onClick={() => {
                const nextZ = clamp(Math.round((zoom - 0.1) * 100) / 100, 0.25, 4)
                setZoom(nextZ)
                log('view.zoom_changed', 'Thay đổi mức zoom', { direction: 'out', zoom: Math.round(nextZ * 100) })
              }}
            >
              <Minus />
            </IconButton>
            <input
              type="range"
              min="25"
              max="400"
              value={Math.round(zoom * 100)}
              onChange={(e) => setZoom(Number(e.target.value) / 100)}
              onPointerUp={() =>
                log('view.zoom_changed', 'Thay đổi mức zoom', { zoom: Math.round(zoom * 100) })
              }
            />
            <IconButton
              label="Zoom in"
              onClick={() => {
                const nextZ = clamp(Math.round((zoom + 0.1) * 100) / 100, 0.25, 4)
                setZoom(nextZ)
                log('view.zoom_changed', 'Thay đổi mức zoom', { direction: 'in', zoom: Math.round(nextZ * 100) })
              }}
            >
              <Plus />
            </IconButton>
            <div className="zoom-control-wrap">
              <button
                className="zoom-value"
                onClick={() => setZoomMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={zoomMenuOpen}
              >
                {Math.round(zoom * 100)}% <ChevronDown />
              </button>
              <ZoomMenu
                isOpen={zoomMenuOpen}
                onClose={() => setZoomMenuOpen(false)}
                currentZoom={zoom}
                onSelectZoom={(z) => {
                  setZoom(z)
                  log('view.zoom_changed', 'Thay đổi mức zoom', { zoom: Math.round(z * 100) })
                }}
                onFitWidth={handleFitWidth}
                onFitPage={handleFitPage}
              />
            </div>
          </div>
          <span className="saved">
            <Check /> Changes saved locally
          </span>
          {statusNotice && <span className="status-notice">{statusNotice}</span>}
        </div>
      </section>
    </div>)}
    {busy && <div className="loading"><div/><span>Preparing your document…</span></div>}
    {showActivities && <ActivityPanel userId={identity.userId} onClose={() => setShowActivities(false)}/>} 
    {showAdmin&&apiUser?.role==='admin'&&<AdminPage onClose={()=>setShowAdmin(false)}/>}
    {showDigitalSign && <div className="sign-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&setShowDigitalSign(false)}><section className="sign-dialog"><button className="sign-close" onClick={()=>setShowDigitalSign(false)}>×</button><BadgeCheck/><h2>Ký điện tử tài liệu</h2><p>Chữ ký số PAdES cần dịch vụ ký giữ khóa bí mật. Chọn phương thức đã được quản trị viên cấu hình.</p><button onClick={()=>signDocument('usb-token')}><b>USB Token</b><span>Ký qua middleware/agent cài trên máy người dùng</span></button><button onClick={()=>signDocument('remote-token')}><b>Remote Token</b><span>Ký qua API của nhà cung cấp CA / CSC</span></button><small>Công cụ “Chữ ký” trên toolbar chỉ tạo chữ ký hiển thị, không phải chữ ký số có chứng thư.</small></section></div>}
  </div>
}

export default App
