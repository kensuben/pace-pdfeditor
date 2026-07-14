import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileText,
  Highlighter, Image as ImageIcon, Minus, MousePointer2, PenLine,
  Plus, Redo2, RotateCw, Sparkles, Type, Undo2, Upload, LogIn, LogOut,
} from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Annotation, DocumentInfo, Point, Tool } from './types'
import type { AccountInfo } from '@azure/msal-browser'
import { initializeAuth, isMicrosoftAuthConfigured, signInMicrosoft, signOutMicrosoft } from './auth'
import { recordActivity } from './activityLog'
import ActivityPanel from './ActivityPanel'

// Query version bypasses any previously cached worker response that may have
// been served with an incorrect MIME type before the Nginx fix.
pdfjs.GlobalWorkerOptions.workerSrc = `${workerUrl}?v=20260714-1`

const COLORS = ['#E85D3F', '#F5C84C', '#4FAF7B', '#3F7DD9', '#7B61B5', '#1F252B']
const uid = () => crypto.randomUUID()
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

function formatBytes(bytes: number) {
  if (!bytes) return '0 KB'
  return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`
}

function IconButton({ label, children, onClick, disabled, active }: { label: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean }) {
  return <button className={`icon-button ${active ? 'active' : ''}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>
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

function PdfCanvas({ pdf, pageNumber, zoom, annotations, tool, color, onAdd, selectedId, onSelect }: {
  pdf: pdfjs.PDFDocumentProxy; pageNumber: number; zoom: number; annotations: Annotation[]; tool: Tool; color: string;
  onAdd: (a: Annotation) => void; selectedId: string | null; onSelect: (id: string | null) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 612, height: 792 })
  const [draft, setDraft] = useState<Point[]>([])

  useEffect(() => {
    let cancelled = false
    let task: pdfjs.RenderTask | undefined
    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: zoom })
      if (cancelled || !canvasRef.current) return
      const canvas = canvasRef.current
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setSize({ width: viewport.width, height: viewport.height })
      task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
      await task.promise
    })().catch((error) => { if (error?.name !== 'RenderingCancelledException') console.error(error) })
    return () => { cancelled = true; task?.cancel() }
  }, [pdf, pageNumber, zoom])

  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return { x: clamp((e.clientX - rect.left) / rect.width, 0, 1), y: clamp((e.clientY - rect.top) / rect.height, 0, 1) }
  }

  const pointerDown = (e: React.PointerEvent) => {
    if (tool === 'select') { if (e.target === e.currentTarget) onSelect(null); return }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraft([pointFromEvent(e)])
  }
  const pointerMove = (e: React.PointerEvent) => { if (draft.length) setDraft((p) => [...p, pointFromEvent(e)]) }
  const pointerUp = (e: React.PointerEvent) => {
    if (!draft.length) return
    const end = pointFromEvent(e), start = draft[0]
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y)
    const width = Math.max(Math.abs(end.x - start.x), tool === 'text' ? .22 : .03)
    const height = Math.max(Math.abs(end.y - start.y), tool === 'text' ? .045 : .018)
    const base = { id: uid(), page: pageNumber, type: tool as Annotation['type'], x, y, width, height, color, opacity: tool === 'highlight' ? .38 : 1 }
    if (tool === 'text') {
      const text = window.prompt('Enter text')?.trim()
      if (text) onAdd({ ...base, text, fontSize: 16 })
    } else if (tool === 'draw' || tool === 'signature') {
      onAdd({ ...base, points: [...draft, end], width: 0, height: 0 })
    } else onAdd(base)
    setDraft([])
  }

  const path = (points: Point[]) => points.map((p, i) => `${i ? 'L' : 'M'} ${p.x * size.width} ${p.y * size.height}`).join(' ')
  return <div className="page-shell" style={{ width: size.width, height: size.height }}>
    <canvas ref={canvasRef}/>
    <div ref={wrapRef} className={`annotation-layer tool-${tool}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
      {annotations.map((a) => a.points ? <svg key={a.id} className={`ink ${selectedId === a.id ? 'selected' : ''}`} viewBox={`0 0 ${size.width} ${size.height}`} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id) }}><path d={path(a.points)} stroke={a.color} strokeWidth={a.type === 'signature' ? 3 : 2.5} fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg> :
        <div key={a.id} className={`annotation ${a.type} ${selectedId === a.id ? 'selected' : ''}`} style={{ left: `${a.x*100}%`, top: `${a.y*100}%`, width: `${a.width*100}%`, height: `${a.height*100}%`, background: a.type === 'highlight' ? a.color : undefined, opacity: a.opacity, color: a.color, fontSize: (a.fontSize || 16) * zoom }} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id) }}>{a.text}</div>)}
      {draft.length > 1 && <svg className="ink draft" viewBox={`0 0 ${size.width} ${size.height}`}><path d={path(draft)} stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round"/></svg>}
    </div>
  </div>
}

function App() {
  const fileInput = useRef<HTMLInputElement>(null)
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
  const annotations = history[historyIndex]

  const identity = useMemo(() => ({
    userId: account?.homeAccountId || 'local-user',
    userName: account?.name || account?.username || 'Local user',
  }), [account])

  const log = useCallback((action: string, description: string, metadata?: Record<string, string | number | boolean | null>, level: 'info' | 'success' | 'warning' | 'security' = 'info') => {
    recordActivity({ ...identity, action, description, metadata, level })
  }, [identity])

  useEffect(() => {
    initializeAuth().then((active) => {
      setAccount(active)
      if (active) recordActivity({ userId: active.homeAccountId, userName: active.name || active.username, action: 'auth.session_restored', description: 'Khôi phục phiên đăng nhập Microsoft', level: 'security' })
    }).catch(console.error).finally(() => setAuthReady(true))
  }, [])

  const commit = useCallback((next: Annotation[], activity?: { action: string; description: string; metadata?: Record<string, string | number | boolean | null> }) => {
    setHistory((h) => [...h.slice(0, historyIndex + 1), next])
    setHistoryIndex((i) => i + 1)
    if (activity) log(activity.action, activity.description, activity.metadata)
  }, [historyIndex, log])

  const openFile = async (file: File) => {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return alert('Please choose a PDF file.')
    setBusy(true)
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const loaded = await pdfjs.getDocument({ data: data.slice() }).promise
      setBytes(data); setPdf(loaded); setInfo({ name: file.name, size: file.size, pages: loaded.numPages })
      setPage(1); setZoom(1); setHistory([[]]); setHistoryIndex(0); setSelectedId(null)
      log('document.opened', 'Mở tài liệu PDF', { fileName: file.name, fileSize: file.size, pageCount: loaded.numPages }, 'success')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error('Unable to open PDF:', error)
      log('document.open_failed', 'Không thể mở tài liệu PDF', { fileName: file.name, reason }, 'warning')
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
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) { const removed = annotations.find((a) => a.id === selectedId); commit(annotations.filter((a) => a.id !== selectedId), { action: 'annotation.deleted', description: 'Xóa annotation', metadata: { type: removed?.type || 'unknown', page: removed?.page || page } }); setSelectedId(null) }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [annotations, commit, history.length, page, selectedId])

  const pageAnnotations = useMemo(() => annotations.filter((a) => a.page === page), [annotations, page])
  const exportPdf = async () => {
    if (!bytes || !info) return
    setBusy(true)
    try {
      const doc = await PDFDocument.load(bytes)
      const font = await doc.embedFont(StandardFonts.Helvetica)
      for (const a of annotations) {
        const p = doc.getPage(a.page - 1), { width, height } = p.getSize()
        const hex = a.color.replace('#', ''), c = rgb(parseInt(hex.slice(0,2),16)/255, parseInt(hex.slice(2,4),16)/255, parseInt(hex.slice(4,6),16)/255)
        if (a.type === 'text' && a.text) p.drawText(a.text, { x: a.x*width, y: height-(a.y*height)-(a.fontSize||16), size: a.fontSize||16, font, color: c, opacity: a.opacity })
        else if (a.type === 'highlight') p.drawRectangle({ x: a.x*width, y: height-(a.y+a.height)*height, width: a.width*width, height: a.height*height, color: c, opacity: a.opacity })
        else if (a.points && a.points.length > 1) for (let i=1;i<a.points.length;i++) p.drawLine({ start:{x:a.points[i-1].x*width,y:height-a.points[i-1].y*height}, end:{x:a.points[i].x*width,y:height-a.points[i].y*height}, color:c, thickness:a.type==='signature'?2.2:1.8, opacity:a.opacity })
      }
      const out = await doc.save(), blob = new Blob([out as BlobPart], { type: 'application/pdf' }), url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href=url; a.download=info.name.replace(/\.pdf$/i,'')+'-edited.pdf'; a.click(); URL.revokeObjectURL(url)
      log('document.exported', 'Xuất tài liệu PDF thành công', { fileName: info.name, annotationCount: annotations.length, pageCount: info.pages }, 'success')
    } catch { log('document.export_failed', 'Xuất tài liệu PDF thất bại', { fileName: info.name }, 'warning'); alert('Could not export this PDF.') } finally { setBusy(false) }
  }

  const login = async () => {
    if (!isMicrosoftAuthConfigured) { alert('Microsoft Login chưa được cấu hình. Hãy sao chép .env.example thành .env và điền VITE_MICROSOFT_CLIENT_ID.'); return }
    setBusy(true)
    try { const signedIn = await signInMicrosoft(); setAccount(signedIn); recordActivity({ userId: signedIn.homeAccountId, userName: signedIn.name || signedIn.username, action: 'auth.login', description: 'Đăng nhập bằng Microsoft', level: 'security', metadata: { username: signedIn.username } }) }
    catch (error) { console.error(error) }
    finally { setBusy(false) }
  }
  const logout = async () => {
    log('auth.logout', 'Đăng xuất tài khoản Microsoft', undefined, 'security')
    setBusy(true); try { await signOutMicrosoft(); setAccount(null); setShowActivities(false) } finally { setBusy(false) }
  }

  return <div className="app">
    <input ref={fileInput} hidden type="file" accept="application/pdf,.pdf" onChange={(e) => e.target.files?.[0] && openFile(e.target.files[0])}/>
    <header className="topbar">
      <button className="brand" onClick={() => fileInput.current?.click()}><span className="pace-wordmark">PACE</span><span className="product-name">PDF Workspace<small>DOCUMENT EDITOR</small></span></button>
      {info ? <div className="file-title"><FileText size={17}/><span>{info.name}</span><small>{formatBytes(info.size)}</small></div> : <div className="top-note">THỰC HỌC VÌ DOANH TRÍ</div>}
      <div className="top-actions">
        {info && <><button className="secondary" onClick={() => fileInput.current?.click()}><Upload size={16}/> Mở file</button><button className="primary" onClick={exportPdf} disabled={busy}><Download size={16}/> Xuất PDF</button></>}
        {account ? <div className="account-menu"><button className="activity-button" onClick={() => setShowActivities(true)} title="Activity log"><Activity/></button><button className="user-chip" title={account.username}><span>{(account.name || account.username).split(' ').map((x) => x[0]).slice(0,2).join('').toUpperCase()}</span><b>{account.name || account.username}</b></button><button className="logout-button" onClick={logout} title="Đăng xuất"><LogOut/></button></div> : <button className="microsoft-login" onClick={login} disabled={!authReady}><span className="ms-logo"><i/><i/><i/><i/></span><LogIn/> Sign in with Microsoft</button>}
      </div>
    </header>

    {!pdf || !info ? <EmptyState onOpen={() => fileInput.current?.click()}/> : <div className="workspace">
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
          <div className="colors">{COLORS.map((c) => <button key={c} aria-label={`Color ${c}`} className={color===c?'active':''} style={{background:c}} onClick={() => setColor(c)}/>)}</div>
          <div className="toolbar-spacer"/>
          <IconButton label="Undo" onClick={() => { setHistoryIndex(i=>Math.max(0,i-1)); log('edit.undo', 'Hoàn tác thay đổi') }} disabled={!historyIndex}><Undo2/></IconButton>
          <IconButton label="Redo" onClick={() => { setHistoryIndex(i=>Math.min(history.length-1,i+1)); log('edit.redo', 'Làm lại thay đổi') }} disabled={historyIndex===history.length-1}><Redo2/></IconButton>
          <IconButton label="Rotate view"><RotateCw/></IconButton>
        </div>
        <div className="document-area" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault(); const f=e.dataTransfer.files[0]; if(f)openFile(f)}}>
          <PdfCanvas pdf={pdf} pageNumber={page} zoom={zoom} annotations={pageAnnotations} tool={tool} color={color} onAdd={(a)=>commit([...annotations,a], { action: 'annotation.added', description: 'Thêm annotation', metadata: { type: a.type, page: a.page, color: a.color } })} selectedId={selectedId} onSelect={setSelectedId}/>
        </div>
        <div className="statusbar">
          <div className="page-nav"><IconButton label="Previous page" disabled={page===1} onClick={()=>{setPage(p=>p-1);log('navigation.page_changed','Chuyển trang',{from:page,to:page-1})}}><ChevronLeft/></IconButton><span><input value={page} onChange={(e)=>{const next=clamp(Number(e.target.value)||1,1,info.pages);setPage(next);log('navigation.page_changed','Chuyển trang',{from:page,to:next})}}/> / {info.pages}</span><IconButton label="Next page" disabled={page===info.pages} onClick={()=>{setPage(p=>p+1);log('navigation.page_changed','Chuyển trang',{from:page,to:page+1})}}><ChevronRight/></IconButton></div>
          <div className="zoom"><IconButton label="Zoom out" onClick={()=>{setZoom(z=>clamp(z-.1,.5,2.5));log('view.zoom_changed','Thay đổi mức zoom',{direction:'out'})}}><Minus/></IconButton><input type="range" min="50" max="250" value={zoom*100} onChange={(e)=>setZoom(Number(e.target.value)/100)} onPointerUp={()=>log('view.zoom_changed','Thay đổi mức zoom',{zoom:Math.round(zoom*100)})}/><IconButton label="Zoom in" onClick={()=>{setZoom(z=>clamp(z+.1,.5,2.5));log('view.zoom_changed','Thay đổi mức zoom',{direction:'in'})}}><Plus/></IconButton><button className="zoom-value">{Math.round(zoom*100)}% <ChevronDown/></button></div>
          <span className="saved"><Check/> Changes saved locally</span>
        </div>
      </section>
    </div>}
    {busy && <div className="loading"><div/><span>Preparing your document…</span></div>}
    {showActivities && <ActivityPanel userId={identity.userId} onClose={() => setShowActivities(false)}/>} 
  </div>
}

export default App
