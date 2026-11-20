import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileText,
  Highlighter, Image as ImageIcon, Minus, MousePointer2, PenLine,
  Plus, Redo2, RotateCw, Sparkles, Type, Undo2, Upload, LogIn, LogOut, ScanText,
  ImagePlus, FilePlus2, BadgeCheck, Trash2, ZoomIn, ZoomOut, ArrowUp, ArrowDown,
  Settings,
} from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Annotation, DocumentInfo, TextRegion, TextStyle, Tool } from './types'
import type { AccountInfo } from '@azure/msal-browser'
import { initializeAuth, isMicrosoftAuthConfigured, signInMicrosoft, signOutMicrosoft } from './auth'
import { recordActivity } from './activityLog'
import ActivityPanel from './ActivityPanel'
import AdminPage from './AdminPage'
import { apiRequest, authorizeSession, type ApiUser } from './api'
import WordAnonymizerPage from './word-anonymizer/WordAnonymizerPage'
import {
  clamp, uid, IconButton, TextFormatBar, PdfCanvas,
  buildEditedPdf, insertPdfPages, movePage, deletePage,
  remapAnnotationsOnInsert, remapAnnotationsOnMove, remapAnnotationsOnDelete,
  buildReplacementAnnotation, parseOcrTsv, groupOcrWordsIntoLines,
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
  const [viewMode, setViewMode] = useState<'pdf' | 'word'>(() => {
    return typeof window !== 'undefined' && window.location.hash === '#/word-anonymizer' ? 'word' : 'pdf'
  })
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
  const selectedImage = useMemo(()=>annotations.find((annotation)=>annotation.id===selectedId&&annotation.type==='image'),[annotations,selectedId])

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

  const scaleSelectedImage = useCallback((factor:number) => {
    if(!selectedImage)return
    const maxFactor=Math.min(.95/selectedImage.width,.95/selectedImage.height)
    const applied=factor>1?Math.min(factor,maxFactor):factor
    const width=clamp(selectedImage.width*applied,.04,.95),height=clamp(selectedImage.height*applied,.04,.95)
    const centerX=selectedImage.x+selectedImage.width/2,centerY=selectedImage.y+selectedImage.height/2
    const updated={...selectedImage,width,height,x:clamp(centerX-width/2,0,1-width),y:clamp(centerY-height/2,0,1-height)}
    commit(annotations.map((annotation)=>annotation.id===updated.id?updated:annotation),{action:'image.scaled',description:factor>1?'Phóng to hình ảnh':'Thu nhỏ hình ảnh',metadata:{page:updated.page,width:Math.round(width*1000)/10,height:Math.round(height*1000)/10}})
    setSelectedId(updated.id)
  },[annotations,commit,selectedImage])

  const changeTextStyle = useCallback((patch: Partial<TextStyle>) => {
    setTextStyle((current)=>({...current,...patch}))
    const selected = annotations.find((a)=>a.id===selectedId && a.type==='text')
    if (selected) commit(annotations.map((a)=>a.id===selected.id?{...a,...patch}:a), { action:'text.format_changed', description:'Thay đổi định dạng văn bản', metadata:{ page:selected.page, properties:Object.keys(patch).join(',') } })
  }, [annotations, commit, selectedId])

  const selectAnnotation = useCallback((id: string | null) => {
    setSelectedId(id)
    const selected=annotations.find((a)=>a.id===id&&a.type==='text')
    if(selected)setTextStyle({fontFamily:selected.fontFamily||'Helvetica',fontSize:selected.fontSize||16,bold:!!selected.bold,italic:!!selected.italic,underline:!!selected.underline,align:selected.align||'left',color:selected.color})
  },[annotations])

  const openFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return alert('Please choose a PDF file.')
    setBusy(true)
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const loaded = await pdfjs.getDocument({ data: data.slice() }).promise
      setBytes(data); setPdf(loaded); setInfo({ name: file.name, size: file.size, pages: loaded.numPages })
      setPage(1); setZoom(1); setHistory([[]]); setHistoryIndex(0); setSelectedId(null); setTextRegions({})
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) setHistoryIndex((i) => Math.min(history.length - 1, i + 1))
        else setHistoryIndex((i) => Math.max(0, i - 1))
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault();deleteSelected() }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [deleteSelected, history.length, selectedId])

  const pageAnnotations = useMemo(() => annotations.filter((a) => a.page === page), [annotations, page])
  const selectedText = useMemo(()=>annotations.find((a)=>a.id===selectedId&&a.type==='text'),[annotations,selectedId])
  const handleTextRegions = useCallback((regions: TextRegion[]) => setTextRegions((current)=>({...current,[page]:[...regions,...(current[page]||[]).filter((x)=>x.source==='ocr')]})), [page])

  const buildPdfBytes = useCallback(() => {
    if (!bytes) throw new Error('Chưa có tài liệu để xử lý.')
    return buildEditedPdf(bytes, annotations)
  }, [bytes, annotations])

  const exportPdf = async () => {
    if (!bytes || !info) return
    setBusy(true)
    try {
      const out=await buildPdfBytes(), blob = new Blob([out as BlobPart], { type: 'application/pdf' }), url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href=url; a.download=info.name.replace(/\.pdf$/i,'')+'-edited.pdf'; a.click(); URL.revokeObjectURL(url)
      log('document.exported', 'Xuất tài liệu PDF thành công', { fileExt: 'pdf', annotationCount: annotations.length, pageCount: info.pages }, 'success')
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
    const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file)})
    const image=new Image();image.src=dataUrl;await image.decode()
    const width=.28,height=Math.min(.35,width*(image.height/image.width)*.77)
    const annotation:Annotation={id:uid(),page,type:'image',x:(1-width)/2,y:(1-height)/2,width,height,color:'#000000',opacity:1,imageDataUrl:dataUrl}
    commit([...annotations,annotation],{action:'image.inserted',description:'Chèn hình ảnh',metadata:{page,fileExt:file.type.includes('png')?'png':'jpeg',fileSize:file.size}})
    setSelectedId(annotation.id)
  }

  const insertPages = async (file: File) => {
    if(!bytes||!pdf||!info)return
    setBusy(true)
    try{
      const sourceBytes = new Uint8Array(await file.arrayBuffer())
      const { bytes: merged, insertedCount: count } = await insertPdfPages(bytes, sourceBytes, page)
      const loaded = await pdfjs.getDocument({ data: merged.slice() }).promise
      setBytes(merged);setPdf(loaded);setInfo({...info,size:merged.byteLength,pages:loaded.numPages})
      commit(remapAnnotationsOnInsert(annotations, page, count),{action:'pages.inserted',description:'Chèn trang từ PDF khác',metadata:{afterPage:page,insertedPages:count,fileExt:'pdf'}})
      setTextRegions({});setPage(page+1)
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
      setBytes(updatedBytes);setPdf(loaded);setInfo({...info,size:updatedBytes.byteLength});setTextRegions({});setPage(toPage);setSelectedId(null)
      commit(updatedAnnotations,{action:'page.moved',description:direction<0?'Di chuyển trang lên':'Di chuyển trang xuống',metadata:{from:fromPage,to:toPage}})
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
      setBytes(updatedBytes);setPdf(loaded);setInfo({...info,size:updatedBytes.byteLength,pages:loaded.numPages});setTextRegions({});setPage(nextPage);setSelectedId(null)
      commit(updatedAnnotations,{action:'page.deleted',description:'Xóa trang PDF',metadata:{page,remainingPages:loaded.numPages}})
    }catch(error){console.error(error);alert(`Không thể xóa trang.\n\n${error instanceof Error?error.message:String(error)}`)}finally{setBusy(false)}
  }

  const editTextRegion = useCallback((region: TextRegion, next: string) => {
    if (next === region.text) return
    const neighbors=textRegions[region.page]||[]
    const replacement = buildReplacementAnnotation(region, next, neighbors)
    commit([...annotations,replacement], { action:'text_region.edited', description:'Chỉnh sửa vùng chữ', metadata:{ page:region.page, source:region.source } })
    setSelectedId(replacement.id)
    setTextRegions((current)=>({...current,[region.page]:(current[region.page]||[]).filter((x)=>x.id!==region.id)}))
  }, [annotations, commit, textRegions])

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
      const finalBytes=await buildPdfBytes(),form=new FormData()
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
      {viewMode === 'pdf' && info && <div className="file-title"><FileText size={17}/><span>{info.name}</span><small>{formatBytes(info.size)}</small></div>}
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
        <div className="thumbs">{Array.from({length: info.pages}, (_,i) => <button key={i} className={`thumb ${page===i+1?'active':''}`} onClick={() => { setPage(i+1); log('navigation.page_changed', 'Chuyển trang', { from: page, to: i+1 }) }}><div className="thumb-paper"><FileText/><span/><span/><span/></div><small>{i+1}</small></button>)}</div>
      </aside>
      {!sidebar && <button className="show-sidebar" onClick={() => setSidebar(true)}><ChevronRight/></button>}
      <section className="editor">
        <div className="toolbar">
          <div className="tool-group">
            {([['select',MousePointer2,'Chọn'],['text',Type,'Thêm chữ'],['highlight',Highlighter,'Đánh dấu'],['draw',PenLine,'Vẽ'],['signature',ImageIcon,'Chữ ký']] as const).map(([id,Icon,label]) => <button key={id} className={`tool ${tool===id?'active':''}`} onClick={() => setTool(id)}><Icon/><span>{label}</span></button>)}
          </div>
          <div className="divider"/>
          <div className="colors">{COLORS.map((c) => <button key={c} aria-label={`Color ${c}`} className={color===c?'active':''} style={{background:c}} onClick={() => {setColor(c);if(tool==='text'||selectedText)changeTextStyle({color:c})}}/>)}</div>
          <div className="toolbar-spacer"/>
          <button className="action-tool" onClick={()=>imageInput.current?.click()}><ImagePlus/>Chèn ảnh</button>
          {selectedImage&&<><IconButton label="Thu nhỏ ảnh" onClick={()=>scaleSelectedImage(.9)}><ZoomOut/></IconButton><IconButton label="Phóng to ảnh" onClick={()=>scaleSelectedImage(1.1)}><ZoomIn/></IconButton></>}
          <button className="action-tool" onClick={()=>insertPdfInput.current?.click()}><FilePlus2/>Chèn trang</button>
          <IconButton label="Di chuyển trang lên" onClick={()=>moveCurrentPage(-1)} disabled={page===1}><ArrowUp/></IconButton>
          <IconButton label="Di chuyển trang xuống" onClick={()=>moveCurrentPage(1)} disabled={page===info.pages}><ArrowDown/></IconButton>
          <IconButton label="Xóa trang hiện tại" onClick={deleteCurrentPage} disabled={info.pages<=1}><Trash2/></IconButton>
          <button className="action-tool sign" onClick={()=>setShowDigitalSign(true)}><BadgeCheck/>Ký số</button>
          <button className={`ocr-button ${ocrBusy?'busy':''}`} onClick={scanCurrentPage} disabled={ocrBusy}><ScanText/>{ocrBusy?`OCR ${ocrProgress}%`:'Scan OCR'}</button>
          <IconButton label="Xóa đối tượng đã chọn" onClick={deleteSelected} disabled={!selectedId}><Trash2/></IconButton>
          <IconButton label="Undo" onClick={() => { setHistoryIndex(i=>Math.max(0,i-1)); log('edit.undo', 'Hoàn tác thay đổi') }} disabled={!historyIndex}><Undo2/></IconButton>
          <IconButton label="Redo" onClick={() => { setHistoryIndex(i=>Math.min(history.length-1,i+1)); log('edit.redo', 'Làm lại thay đổi') }} disabled={historyIndex===history.length-1}><Redo2/></IconButton>
          <IconButton label="Rotate view"><RotateCw/></IconButton>
        </div>
        {(tool==='text'||selectedText) && <TextFormatBar style={textStyle} onChange={changeTextStyle}/>}
        <div className="document-area" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault(); const f=e.dataTransfer.files[0]; if(f)openFile(f)}}>
          <PdfCanvas pdf={pdf} pageNumber={page} zoom={zoom} annotations={pageAnnotations} tool={tool} color={color} onAdd={(a)=>{const next=a.type==='text'?{...a,...textStyle}:a;commit([...annotations,next], { action: 'annotation.added', description: 'Thêm annotation', metadata: { type: a.type, page: a.page, color: next.color } });setSelectedId(next.id)}} onUpdate={(updated)=>{commit(annotations.map((annotation)=>annotation.id===updated.id?updated:annotation),{action:'annotation.moved',description:'Di chuyển đối tượng',metadata:{type:updated.type,page:updated.page}});setSelectedId(updated.id)}} selectedId={selectedId} onSelect={selectAnnotation} textRegions={textRegions[page]||[]} onTextRegions={handleTextRegions} onEditRegion={editTextRegion} onEditAnnotation={editTextAnnotation}/>
        </div>
        <div className="statusbar">
          <div className="page-nav"><IconButton label="Previous page" disabled={page===1} onClick={()=>{setPage(p=>p-1);log('navigation.page_changed','Chuyển trang',{from:page,to:page-1})}}><ChevronLeft/></IconButton><span><input value={page} onChange={(e)=>{const next=clamp(Number(e.target.value)||1,1,info.pages);setPage(next);log('navigation.page_changed','Chuyển trang',{from:page,to:next})}}/> / {info.pages}</span><IconButton label="Next page" disabled={page===info.pages} onClick={()=>{setPage(p=>p+1);log('navigation.page_changed','Chuyển trang',{from:page,to:page+1})}}><ChevronRight/></IconButton></div>
          <div className="zoom"><IconButton label="Zoom out" onClick={()=>{setZoom(z=>clamp(z-.1,.5,2.5));log('view.zoom_changed','Thay đổi mức zoom',{direction:'out'})}}><Minus/></IconButton><input type="range" min="50" max="250" value={zoom*100} onChange={(e)=>setZoom(Number(e.target.value)/100)} onPointerUp={()=>log('view.zoom_changed','Thay đổi mức zoom',{zoom:Math.round(zoom*100)})}/><IconButton label="Zoom in" onClick={()=>{setZoom(z=>clamp(z+.1,.5,2.5));log('view.zoom_changed','Thay đổi mức zoom',{direction:'in'})}}><Plus/></IconButton><button className="zoom-value">{Math.round(zoom*100)}% <ChevronDown/></button></div>
          <span className="saved"><Check/> Changes saved locally</span>
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
