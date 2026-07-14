import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, Check, ChevronDown, ChevronLeft, ChevronRight, Download, FileText,
  Highlighter, Image as ImageIcon, Minus, MousePointer2, PenLine,
  Plus, Redo2, RotateCw, Sparkles, Type, Undo2, Upload, LogIn, LogOut, ScanText,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  ImagePlus, FilePlus2, BadgeCheck,
} from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts, type PDFFont } from 'pdf-lib'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Annotation, DocumentInfo, Point, TextRegion, TextStyle, Tool } from './types'
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

function TextFormatBar({ style, onChange }: { style: TextStyle; onChange: (patch: Partial<TextStyle>) => void }) {
  return <div className="text-format-bar" aria-label="Định dạng văn bản">
    <select aria-label="Font chữ" value={style.fontFamily} onChange={(e)=>onChange({fontFamily:e.target.value as TextStyle['fontFamily']})}>
      <option>Helvetica</option><option>Times Roman</option><option>Courier</option>
    </select>
    <select className="font-size" aria-label="Cỡ chữ" value={style.fontSize} onChange={(e)=>onChange({fontSize:Number(e.target.value)})}>
      {[8,9,10,11,12,14,16,18,20,24,28,32,36,48,64,72].map((n)=><option key={n} value={n}>{n}</option>)}
    </select>
    <span className="format-divider"/>
    <IconButton label="Đậm" active={style.bold} onClick={()=>onChange({bold:!style.bold})}><Bold/></IconButton>
    <IconButton label="Nghiêng" active={style.italic} onClick={()=>onChange({italic:!style.italic})}><Italic/></IconButton>
    <IconButton label="Gạch chân" active={style.underline} onClick={()=>onChange({underline:!style.underline})}><Underline/></IconButton>
    <span className="format-divider"/>
    <IconButton label="Căn trái" active={style.align==='left'} onClick={()=>onChange({align:'left'})}><AlignLeft/></IconButton>
    <IconButton label="Căn giữa" active={style.align==='center'} onClick={()=>onChange({align:'center'})}><AlignCenter/></IconButton>
    <IconButton label="Căn phải" active={style.align==='right'} onClick={()=>onChange({align:'right'})}><AlignRight/></IconButton>
    <label className="text-color" title="Màu chữ"><input type="color" value={style.color} onChange={(e)=>onChange({color:e.target.value})}/><span style={{'--text-color':style.color} as React.CSSProperties}>A</span></label>
  </div>
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

function PdfCanvas({ pdf, pageNumber, zoom, annotations, tool, color, onAdd, selectedId, onSelect, textRegions, onTextRegions, onEditRegion, onEditAnnotation }: {
  pdf: pdfjs.PDFDocumentProxy; pageNumber: number; zoom: number; annotations: Annotation[]; tool: Tool; color: string;
  onAdd: (a: Annotation) => void; selectedId: string | null; onSelect: (id: string | null) => void;
  textRegions: TextRegion[]; onTextRegions: (regions: TextRegion[]) => void; onEditRegion: (region: TextRegion) => void; onEditAnnotation: (annotation: Annotation) => void
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

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      if (cancelled) return
      const regions = content.items.flatMap((raw, index): TextRegion[] => {
        if (!('str' in raw) || !raw.str.trim()) return []
        const item = raw as { str: string; transform: number[]; width: number; height: number }
        const tx = pdfjs.Util.transform(viewport.transform, item.transform)
        const fontHeight = Math.max(Math.hypot(tx[2], tx[3]), item.height || 8)
        return [{
          id: `native-${pageNumber}-${index}`, page: pageNumber, text: item.str,
          x: clamp(tx[4] / viewport.width, 0, 1), y: clamp((tx[5] - fontHeight) / viewport.height, 0, 1),
          width: clamp((item.width || fontHeight) / viewport.width, .002, 1), height: clamp(fontHeight / viewport.height, .005, 1),
          fontSize: fontHeight, source: 'native',
        }]
      })
      onTextRegions(regions)
    })().catch(console.error)
    return () => { cancelled = true }
  }, [onTextRegions, pageNumber, pdf])

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
      {tool === 'select' && textRegions.map((region) => <button key={region.id} className={`text-region ${region.source}`} title={`${region.source === 'ocr' ? 'OCR' : 'PDF'}: ${region.text}`} style={{ left:`${region.x*100}%`, top:`${region.y*100}%`, width:`${region.width*100}%`, height:`${region.height*100}%` }} onPointerDown={(e)=>e.stopPropagation()} onClick={(e)=>{e.stopPropagation();onEditRegion(region)}}><span>{region.text}</span></button>)}
      {annotations.map((a) => a.points ? <svg key={a.id} className={`ink ${selectedId === a.id ? 'selected' : ''}`} viewBox={`0 0 ${size.width} ${size.height}`} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id) }}><path d={path(a.points)} stroke={a.color} strokeWidth={a.type === 'signature' ? 3 : 2.5} fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg> : a.type==='image'&&a.imageDataUrl ? <img key={a.id} className={`image-annotation ${selectedId===a.id?'selected':''}`} src={a.imageDataUrl} alt="Inserted" style={{left:`${a.x*100}%`,top:`${a.y*100}%`,width:`${a.width*100}%`,height:`${a.height*100}%`}} onPointerDown={(e)=>{e.stopPropagation();onSelect(a.id)}}/> :
        <div key={a.id} className={`annotation ${a.type} ${a.replaceOriginal ? 'replacement' : ''} ${selectedId === a.id ? 'selected' : ''}`} style={{ left: `${a.x*100}%`, top: `${a.y*100}%`, width: `${a.width*100}%`, height: `${a.height*100}%`, background: a.replaceOriginal ? '#fff' : a.type === 'highlight' ? a.color : undefined, opacity: a.opacity, color: a.color, fontSize: (a.fontSize || 16) * zoom, fontFamily:a.fontFamily||'Helvetica', fontWeight:a.bold?700:400, fontStyle:a.italic?'italic':'normal', textDecoration:a.underline?'underline':'none', textAlign:a.align||'left' }} onPointerDown={(e) => { e.stopPropagation(); onSelect(a.id) }} onDoubleClick={(e)=>{e.stopPropagation();if(a.type==='text')onEditAnnotation(a)}}>{a.text}</div>)}
      {draft.length > 1 && <svg className="ink draft" viewBox={`0 0 ${size.width} ${size.height}`}><path d={path(draft)} stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round"/></svg>}
    </div>
  </div>
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
  const [textStyle, setTextStyle] = useState<TextStyle>({ fontFamily:'Helvetica', fontSize:16, bold:false, italic:false, underline:false, align:'left', color:'#0C2340' })
  const [showDigitalSign, setShowDigitalSign] = useState(false)
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
  const selectedText = useMemo(()=>annotations.find((a)=>a.id===selectedId&&a.type==='text'),[annotations,selectedId])
  const handleTextRegions = useCallback((regions: TextRegion[]) => setTextRegions((current)=>({...current,[page]:[...regions,...(current[page]||[]).filter((x)=>x.source==='ocr')]})), [page])
  const buildPdfBytes = async () => {
      if(!bytes)throw new Error('Chưa có tài liệu để xử lý.')
      const doc = await PDFDocument.load(bytes)
      const fontCache = new Map<string, PDFFont>()
      const getFont = async (a: Annotation) => {
        const family=a.fontFamily||'Helvetica', variant=`${a.bold?'bold':''}${a.italic?'italic':''}`||'regular', key=`${family}-${variant}`
        const cached=fontCache.get(key);if(cached)return cached
        let name: StandardFonts
        if(family==='Times Roman') name=a.bold&&a.italic?StandardFonts.TimesRomanBoldItalic:a.bold?StandardFonts.TimesRomanBold:a.italic?StandardFonts.TimesRomanItalic:StandardFonts.TimesRoman
        else if(family==='Courier') name=a.bold&&a.italic?StandardFonts.CourierBoldOblique:a.bold?StandardFonts.CourierBold:a.italic?StandardFonts.CourierOblique:StandardFonts.Courier
        else name=a.bold&&a.italic?StandardFonts.HelveticaBoldOblique:a.bold?StandardFonts.HelveticaBold:a.italic?StandardFonts.HelveticaOblique:StandardFonts.Helvetica
        const embedded=await doc.embedFont(name);fontCache.set(key,embedded);return embedded
      }
      for (const a of annotations) {
        const p = doc.getPage(a.page - 1), { width, height } = p.getSize()
        const hex = a.color.replace('#', ''), c = rgb(parseInt(hex.slice(0,2),16)/255, parseInt(hex.slice(2,4),16)/255, parseInt(hex.slice(4,6),16)/255)
        if (a.type === 'text' && a.text) {
          const font=await getFont(a),fontSize=a.fontSize||16,textWidth=font.widthOfTextAtSize(a.text,fontSize),boxWidth=a.width*width
          const textX=a.x*width+(a.align==='center'?Math.max(0,(boxWidth-textWidth)/2):a.align==='right'?Math.max(0,boxWidth-textWidth):0)
          const textY=height-(a.y*height)-fontSize
          if (a.replaceOriginal) p.drawRectangle({ x:a.x*width, y:height-(a.y+a.height)*height, width:a.width*width, height:a.height*height, color:rgb(1,1,1), opacity:1 })
          p.drawText(a.text, { x:textX, y:textY, size:fontSize, font, color:c, opacity:a.opacity, maxWidth:boxWidth })
          if(a.underline)p.drawLine({start:{x:textX,y:textY-1.5},end:{x:Math.min(textX+textWidth,a.x*width+boxWidth),y:textY-1.5},color:c,thickness:Math.max(.6,fontSize/18),opacity:a.opacity})
        }
        else if(a.type==='image'&&a.imageDataUrl){const data=await fetch(a.imageDataUrl).then((r)=>r.arrayBuffer());const embedded=a.imageDataUrl.startsWith('data:image/png')?await doc.embedPng(data):await doc.embedJpg(data);p.drawImage(embedded,{x:a.x*width,y:height-(a.y+a.height)*height,width:a.width*width,height:a.height*height,opacity:a.opacity})}
        else if (a.type === 'highlight') p.drawRectangle({ x: a.x*width, y: height-(a.y+a.height)*height, width: a.width*width, height: a.height*height, color: c, opacity: a.opacity })
        else if (a.points && a.points.length > 1) for (let i=1;i<a.points.length;i++) p.drawLine({ start:{x:a.points[i-1].x*width,y:height-a.points[i-1].y*height}, end:{x:a.points[i].x*width,y:height-a.points[i].y*height}, color:c, thickness:a.type==='signature'?2.2:1.8, opacity:a.opacity })
      }
      return new Uint8Array(await doc.save())
  }
  const exportPdf = async () => {
    if (!bytes || !info) return
    setBusy(true)
    try {
      const out=await buildPdfBytes(), blob = new Blob([out as BlobPart], { type: 'application/pdf' }), url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href=url; a.download=info.name.replace(/\.pdf$/i,'')+'-edited.pdf'; a.click(); URL.revokeObjectURL(url)
      log('document.exported', 'Xuất tài liệu PDF thành công', { fileName: info.name, annotationCount: annotations.length, pageCount: info.pages }, 'success')
    } catch { log('document.export_failed', 'Xuất tài liệu PDF thất bại', { fileName: info.name }, 'warning'); alert('Could not export this PDF.') } finally { setBusy(false) }
  }

  const insertImage = async (file: File) => {
    if(!file.type.match(/^image\/(png|jpeg)$/)){alert('Chỉ hỗ trợ ảnh PNG hoặc JPEG.');return}
    const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file)})
    const image=new Image();image.src=dataUrl;await image.decode()
    const width=.28,height=Math.min(.35,width*(image.height/image.width)*.77)
    const annotation:Annotation={id:uid(),page,type:'image',x:(1-width)/2,y:(1-height)/2,width,height,color:'#000000',opacity:1,imageDataUrl:dataUrl}
    commit([...annotations,annotation],{action:'image.inserted',description:'Chèn hình ảnh',metadata:{page,fileName:file.name,fileSize:file.size}})
    setSelectedId(annotation.id)
  }

  const insertPages = async (file: File) => {
    if(!bytes||!pdf||!info)return
    setBusy(true)
    try{
      const source=await PDFDocument.load(await file.arrayBuffer()),target=await PDFDocument.load(bytes)
      const copied=await target.copyPages(source,source.getPageIndices())
      copied.forEach((copiedPage,index)=>target.insertPage(page+index,copiedPage))
      const merged=new Uint8Array(await target.save()),loaded=await pdfjs.getDocument({data:merged.slice()}).promise
      const count=copied.length
      setBytes(merged);setPdf(loaded);setInfo({...info,size:merged.byteLength,pages:loaded.numPages})
      commit(annotations.map((a)=>a.page>page?{...a,page:a.page+count}:a),{action:'pages.inserted',description:'Chèn trang từ PDF khác',metadata:{afterPage:page,insertedPages:count,fileName:file.name}})
      setTextRegions({});setPage(page+1)
    }catch(error){console.error(error);alert(`Không thể chèn trang PDF.\n\n${error instanceof Error?error.message:String(error)}`)}finally{setBusy(false)}
  }

  const editTextRegion = useCallback((region: TextRegion) => {
    const next = window.prompt('Chỉnh sửa nội dung vùng chữ', region.text)
    if (next === null || next === region.text) return
    const replacement: Annotation = { id:uid(), page:region.page, type:'text', x:region.x, y:region.y, width:Math.max(region.width,.04), height:Math.max(region.height,.015), opacity:1, text:next, replaceOriginal:true, ...textStyle, fontSize:Math.max(7,textStyle.fontSize||region.fontSize) }
    commit([...annotations,replacement], { action:'text_region.edited', description:'Chỉnh sửa vùng chữ', metadata:{ page:region.page, source:region.source } })
    setTextRegions((current)=>({...current,[region.page]:(current[region.page]||[]).filter((x)=>x.id!==region.id)}))
  }, [annotations, commit, textStyle])

  const editTextAnnotation = useCallback((annotation: Annotation) => {
    const next=window.prompt('Chỉnh sửa nội dung văn bản',annotation.text||'')
    if(next===null||next===annotation.text)return
    commit(annotations.map((a)=>a.id===annotation.id?{...a,text:next}:a),{action:'text.content_changed',description:'Chỉnh sửa nội dung văn bản',metadata:{page:annotation.page}})
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
      const regions = tsv.split(/\r?\n/).slice(1).flatMap((line,index):TextRegion[]=>{
        const cols=line.split('\t'); if(cols.length<12||cols[0]!=='5')return []
        const left=Number(cols[6]),top=Number(cols[7]),w=Number(cols[8]),h=Number(cols[9]),confidence=Number(cols[10]),text=cols.slice(11).join('\t').trim()
        if(!text||confidence<35||w<=0||h<=0)return []
        return [{id:`ocr-${page}-${index}-${uid()}`,page,text,x:left/canvas.width,y:top/canvas.height,width:w/canvas.width,height:h/canvas.height,fontSize:Math.max(7,h/2),confidence,source:'ocr'}]
      })
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
      log('signature.digital_completed','Ký số tài liệu thành công',{mode,fileName:info.name},'security');setShowDigitalSign(false)
    }catch(error){console.error(error);log('signature.digital_failed','Ký số tài liệu thất bại',{mode,reason:error instanceof Error?error.message:String(error)},'warning');alert(`Không thể ký số.\n\n${error instanceof Error?error.message:String(error)}`)}finally{setBusy(false)}
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
    <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg" onChange={(e)=>{const file=e.target.files?.[0];if(file)insertImage(file);e.target.value=''}}/>
    <input ref={insertPdfInput} hidden type="file" accept="application/pdf,.pdf" onChange={(e)=>{const file=e.target.files?.[0];if(file)insertPages(file);e.target.value=''}}/>
    <header className="topbar">
      <button className="brand" onClick={() => fileInput.current?.click()}><img className="official-logo" src="/pace-logo.svg" alt="PACE Institute of Management"/><span className="product-name">PDF Workspace<small>DOCUMENT EDITOR</small></span></button>
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
          <div className="colors">{COLORS.map((c) => <button key={c} aria-label={`Color ${c}`} className={color===c?'active':''} style={{background:c}} onClick={() => {setColor(c);if(tool==='text'||selectedText)changeTextStyle({color:c})}}/>)}</div>
          <div className="toolbar-spacer"/>
          <button className="action-tool" onClick={()=>imageInput.current?.click()}><ImagePlus/>Chèn ảnh</button>
          <button className="action-tool" onClick={()=>insertPdfInput.current?.click()}><FilePlus2/>Chèn trang</button>
          <button className="action-tool sign" onClick={()=>setShowDigitalSign(true)}><BadgeCheck/>Ký số</button>
          <button className={`ocr-button ${ocrBusy?'busy':''}`} onClick={scanCurrentPage} disabled={ocrBusy}><ScanText/>{ocrBusy?`OCR ${ocrProgress}%`:'Scan OCR'}</button>
          <IconButton label="Undo" onClick={() => { setHistoryIndex(i=>Math.max(0,i-1)); log('edit.undo', 'Hoàn tác thay đổi') }} disabled={!historyIndex}><Undo2/></IconButton>
          <IconButton label="Redo" onClick={() => { setHistoryIndex(i=>Math.min(history.length-1,i+1)); log('edit.redo', 'Làm lại thay đổi') }} disabled={historyIndex===history.length-1}><Redo2/></IconButton>
          <IconButton label="Rotate view"><RotateCw/></IconButton>
        </div>
        {(tool==='text'||selectedText) && <TextFormatBar style={textStyle} onChange={changeTextStyle}/>}
        <div className="document-area" onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault(); const f=e.dataTransfer.files[0]; if(f)openFile(f)}}>
          <PdfCanvas pdf={pdf} pageNumber={page} zoom={zoom} annotations={pageAnnotations} tool={tool} color={color} onAdd={(a)=>{const next=a.type==='text'?{...a,...textStyle}:a;commit([...annotations,next], { action: 'annotation.added', description: 'Thêm annotation', metadata: { type: a.type, page: a.page, color: next.color } })}} selectedId={selectedId} onSelect={selectAnnotation} textRegions={textRegions[page]||[]} onTextRegions={handleTextRegions} onEditRegion={editTextRegion} onEditAnnotation={editTextAnnotation}/>
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
    {showDigitalSign && <div className="sign-backdrop" onMouseDown={(e)=>e.target===e.currentTarget&&setShowDigitalSign(false)}><section className="sign-dialog"><button className="sign-close" onClick={()=>setShowDigitalSign(false)}>×</button><BadgeCheck/><h2>Ký điện tử tài liệu</h2><p>Chữ ký số PAdES cần dịch vụ ký giữ khóa bí mật. Chọn phương thức đã được quản trị viên cấu hình.</p><button onClick={()=>signDocument('usb-token')}><b>USB Token</b><span>Ký qua middleware/agent cài trên máy người dùng</span></button><button onClick={()=>signDocument('remote-token')}><b>Remote Token</b><span>Ký qua API của nhà cung cấp CA / CSC</span></button><small>Công cụ “Chữ ký” trên toolbar chỉ tạo chữ ký hiển thị, không phải chữ ký số có chứng thư.</small></section></div>}
  </div>
}

export default App
