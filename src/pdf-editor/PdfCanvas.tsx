import { useEffect, useRef, useState } from 'react'
import type * as pdfjs from 'pdfjs-dist'
import type { Annotation, PageImageRegion, Point, TextRegion, TextStyle, Tool } from '../types'
import { clamp, uid } from './geometry'
import { groupTextItemsIntoLines, groupLinesIntoBlocks } from './textExtraction'
import { cssFontStack } from './fonts'
import { SelectionFrame } from './selection/SelectionFrame'
import { getBounds, moveBy, nudgeDelta } from './selection/geometry'
import { useDesktopEditor } from './useDesktopEditor'
import { annotationFill, draftRect } from './annotationStyle'
import { globalRenderQueue } from './viewMath'
import { croppedPreviewLayout, sampleBackground } from './imagePlacement'

export interface PdfCanvasProps {
  pdf: pdfjs.PDFDocumentProxy
  pageNumber: number
  zoom: number
  annotations: Annotation[]
  tool: Tool
  color: string
  textStyle?: TextStyle
  onAdd: (a: Annotation) => void
  onUpdate: (a: Annotation) => void
  onResize?: (a: Annotation) => void
  onNudge?: (a: Annotation) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  textRegions: TextRegion[]
  onTextRegions: (regions: TextRegion[]) => void
  onEditRegion: (region: TextRegion, text: string) => void
  onEditAnnotation: (annotation: Annotation, text: string) => void
  showBoundingBoxes?: boolean
  aspectLocked?: boolean
  pageImages?: PageImageRegion[]
}

export function PdfCanvas({
  pdf,
  pageNumber,
  zoom,
  annotations,
  tool,
  color,
  textStyle,
  onAdd,
  onUpdate,
  onResize,
  onNudge,
  selectedId,
  onSelect,
  textRegions,
  onTextRegions,
  onEditRegion,
  onEditAnnotation,
  showBoundingBoxes,
  aspectLocked,
  pageImages = [],
}: PdfCanvasProps) {
  const isDesktop = useDesktopEditor()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 612, height: 792 })
  const [pagePt, setPagePt] = useState({ width: 612, height: 792 })
  const [draft, setDraft] = useState<Point[]>([])
  const [preview, setPreview] = useState<Annotation | null>(null)
  const [creatingText, setCreatingText] = useState<{
    id: string
    x: number
    y: number
    width: number
    height: number
    value: string
  } | null>(null)
  const [inlineEdit, setInlineEdit] = useState<{
    kind: 'region' | 'annotation'
    id: string
    value: string
    backgroundColor?: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    let task: pdfjs.RenderTask | undefined
    let releasePermit: (() => void) | undefined
    const canvasElement = canvasRef.current
    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: zoom })
      const unscaled = page.getViewport({ scale: 1 })
      if (cancelled || !canvasRef.current) return
      setPagePt({ width: unscaled.width, height: unscaled.height })
      const canvas = canvasRef.current
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setSize({ width: viewport.width, height: viewport.height })

      releasePermit = await globalRenderQueue.acquire()
      if (cancelled) {
        releasePermit()
        return
      }

      task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
      await task.promise
    })().catch((error) => {
      if (error?.name !== 'RenderingCancelledException') console.error(error)
    }).finally(() => {
      releasePermit?.()
    })
    return () => {
      cancelled = true
      task?.cancel()
      releasePermit?.()
      if (canvasElement) {
        canvasElement.width = 0
        canvasElement.height = 0
      }
    }
  }, [pdf, pageNumber, zoom])

  const onTextRegionsRef = useRef(onTextRegions)
  useEffect(() => {
    onTextRegionsRef.current = onTextRegions
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      if (cancelled) return
      const rawLines = groupTextItemsIntoLines(content.items, content.styles, viewport, pageNumber)
      const regions = groupLinesIntoBlocks(rawLines, viewport, pageNumber)
      onTextRegionsRef.current(regions)
    })().catch(console.error)
    return () => {
      cancelled = true
    }
  }, [pageNumber, pdf])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
          return
        }
        if (target.closest('input, textarea, select, [contenteditable="true"]')) {
          return
        }
      }

      if (e.key === 'Escape') {
        if (selectedId) {
          e.preventDefault()
          onSelect(null)
        }
        return
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        if (!isDesktop) return
        if (!selectedId) return
        const active = annotations.find((a) => a.id === selectedId)
        if (!active || active.page !== pageNumber || active.replaceOriginal) return

        e.preventDefault()
        const stepPt = e.shiftKey ? 10 : 1
        const delta = nudgeDelta(pagePt, stepPt, e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight')
        const updated = moveBy(active, delta.dx, delta.dy)
        if (onNudge) {
          onNudge(updated)
        } else {
          onUpdate(updated)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [annotations, isDesktop, onNudge, onSelect, onUpdate, pageNumber, pagePt, selectedId])

  const pointFromEvent = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect()
    return {
      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
    }
  }

  const pointerDown = (e: React.PointerEvent) => {
    if (tool === 'select') {
      if (e.target === e.currentTarget) onSelect(null)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraft([pointFromEvent(e)])
  }

  const pointerMove = (e: React.PointerEvent) => {
    if (draft.length) setDraft((p) => [...p, pointFromEvent(e)])
  }

  const pointerUp = (e: React.PointerEvent) => {
    if (!draft.length) return
    const end = pointFromEvent(e),
      start = draft[0]
    const x = Math.min(start.x, end.x),
      y = Math.min(start.y, end.y)
    const width = Math.max(Math.abs(end.x - start.x), tool === 'text' ? 0.22 : 0.03)
    const height = Math.max(Math.abs(end.y - start.y), tool === 'text' ? 0.045 : 0.018)
    const base = {
      id: uid(),
      page: pageNumber,
      type: tool as Annotation['type'],
      x,
      y,
      width,
      height,
      color,
      opacity: tool === 'highlight' ? 0.38 : 1,
    }
    if (tool === 'text') {
      setCreatingText({
        id: uid(),
        x,
        y,
        width,
        height,
        value: '',
      })
    } else if (tool === 'draw' || tool === 'signature') {
      onAdd({ ...base, points: [...draft, end], width: 0, height: 0 })
    } else onAdd(base)
    setDraft([])
  }

  const finishCreatingText = (commitChange: boolean) => {
    if (!creatingText) return
    const item = creatingText
    setCreatingText(null)
    const trimmed = item.value.trim()
    if (commitChange && trimmed) {
      const newAnnotation: Annotation = {
        id: item.id,
        page: pageNumber,
        type: 'text',
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        color: textStyle?.color || color,
        opacity: 1,
        text: trimmed,
        fontSize: textStyle?.fontSize || 16,
        fontFamily: textStyle?.fontFamily ?? 'Helvetica',
        bold: textStyle?.bold,
        italic: textStyle?.italic,
        underline: textStyle?.underline,
        align: textStyle?.align || 'left',
      }
      onAdd(newAnnotation)
      onSelect(newAnnotation.id)
    }
  }

  const creatingTextKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      finishCreatingText(false)
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      finishCreatingText(true)
    }
  }

  const path = (points: Point[]) =>
    points.map((p, i) => `${i ? 'L' : 'M'} ${p.x * size.width} ${p.y * size.height}`).join(' ')

  const sampleBg = (region: Pick<TextRegion, 'x' | 'y' | 'width' | 'height'>, options?: { outside?: boolean }) =>
    sampleBackground(region, canvasRef.current, size, options)


  const captureImagePreview = (region: Pick<PageImageRegion, 'x' | 'y' | 'width' | 'height'>): string => {
    const canvas = canvasRef.current
    if (!canvas) return ''
    const ratioX = canvas.width / size.width
    const ratioY = canvas.height / size.height
    const cropX = Math.round(region.x * size.width * ratioX)
    const cropY = Math.round(region.y * size.height * ratioY)
    const cropW = Math.max(1, Math.round(region.width * size.width * ratioX))
    const cropH = Math.max(1, Math.round(region.height * size.height * ratioY))
    try {
      const offscreen = document.createElement('canvas')
      offscreen.width = cropW
      offscreen.height = cropH
      const ctx = offscreen.getContext('2d')
      if (!ctx) return ''
      ctx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
      return offscreen.toDataURL?.('image/png') || ''
    } catch {
      return ''
    }
  }

  const finishInlineEdit = (commitChange: boolean) => {
    if (!inlineEdit) return
    const edit = inlineEdit
    setInlineEdit(null)
    if (!commitChange) return
    if (edit.kind === 'region') {
      const region = textRegions.find((item) => item.id === edit.id)
      if (region && edit.value !== region.text)
        onEditRegion(
          { ...region, backgroundColor: edit.backgroundColor || region.backgroundColor },
          edit.value,
        )
    } else {
      const annotation = annotations.find((item) => item.id === edit.id)
      if (annotation && edit.value !== annotation.text)
        onEditAnnotation(
          { ...annotation, backgroundColor: edit.backgroundColor || annotation.backgroundColor },
          edit.value,
        )
    }
  }

  const editorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      finishInlineEdit(false)
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      finishInlineEdit(true)
    }
  }

  const handleAnnotationDoubleClick = (a: Annotation) => {
    if (a.type === 'text')
      setInlineEdit({
        kind: 'annotation',
        id: a.id,
        value: a.text || '',
        backgroundColor: a.replaceOriginal ? sampleBg(a) : a.backgroundColor,
      })
  }

  const selectedAnnotation = annotations.find((a) => a.id === selectedId && a.page === pageNumber)
  const activeSourceImageKeys = new Set(
    annotations
      .filter((a) => Boolean(a.sourceImage))
      .map((a) => `${a.sourceImage!.resourceName}-${a.sourceImage!.occurrence}`),
  )

  return (
    <div className="page-shell" style={{ width: size.width, height: size.height }}>
      <canvas ref={canvasRef} />
      <div
        ref={wrapRef}
        className={`annotation-layer tool-${tool}`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
      >
        {tool === 'select' &&
          textRegions.map((region) =>
            inlineEdit?.kind === 'region' && inlineEdit.id === region.id ? (
              <textarea
                key={region.id}
                ref={(el) => {
                  if (el) {
                    el.style.height = 'auto'
                    const minH = Math.max(region.height * size.height, 0.018 * size.height)
                    el.style.height = `${Math.max(el.scrollHeight, minH)}px`
                  }
                }}
                autoFocus
                className="inline-text-editor"
                title="Enter: lưu · Shift+Enter: xuống dòng · Esc: huỷ"
                value={inlineEdit.value}
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${Math.max(region.width, 0.04) * 100}%`,
                  minHeight: `${Math.max(region.height, 0.018) * 100}%`,
                  fontSize: region.fontSize * zoom,
                  lineHeight: region.lineHeight ? `${region.lineHeight * zoom}px` : undefined,
                  whiteSpace: 'pre-wrap',
                  fontFamily: cssFontStack(region.fontFamily),
                  fontWeight: region.bold ? 700 : 400,
                  fontStyle: region.italic ? 'italic' : 'normal',
                  color: region.color || '#000',
                  textAlign: region.align || 'left',
                  backgroundColor: inlineEdit.backgroundColor || '#fff',
                }}
                onChange={(e) => {
                  setInlineEdit({ ...inlineEdit, value: e.target.value })
                  e.target.style.height = 'auto'
                  const minH = Math.max(region.height * size.height, 0.018 * size.height)
                  e.target.style.height = `${Math.max(e.target.scrollHeight, minH)}px`
                }}
                onKeyDown={editorKeyDown}
                onBlur={() => finishInlineEdit(true)}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : (
              <button
                key={region.id}
                className={`text-region ${region.source}${region.rotation !== undefined ? ' rotated' : ''}`}
                aria-disabled={region.rotation !== undefined ? 'true' : undefined}
                title={
                  region.rotation !== undefined
                    ? 'Chữ xoay: chưa hỗ trợ sửa'
                    : `${region.source === 'ocr' ? 'OCR' : 'PDF'}: ${region.text}`
                }
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (region.rotation !== undefined) return
                  setInlineEdit({
                    kind: 'region',
                    id: region.id,
                    value: region.text,
                    backgroundColor: sampleBg(region),
                  })
                }}
              >
                <span>{region.text}</span>
              </button>
            ),
          )}
        {tool === 'select' &&
          pageImages.map((img) => {
            if (activeSourceImageKeys.has(`${img.resourceName}-${img.occurrence}`)) return null
            return (
              <button
                key={img.id}
                className={`page-image-region${img.editable ? '' : ' disabled'}`}
                aria-disabled={img.editable ? undefined : 'true'}
                title={img.editable ? 'Ảnh trong PDF' : 'Ảnh này chưa hỗ trợ sửa'}
                style={{
                  left: `${img.x * 100}%`,
                  top: `${img.y * 100}%`,
                  width: `${img.width * 100}%`,
                  height: `${img.height * 100}%`,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!img.editable) return
                  const previewUrl = captureImagePreview(img)
                  const bg = sampleBg(img, { outside: true })
                  const newAnnotation: Annotation = {
                    id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    page: pageNumber,
                    type: 'image',
                    x: img.x,
                    y: img.y,
                    width: img.width,
                    height: img.height,
                    color: '#000000',
                    opacity: 1,
                    imageDataUrl: previewUrl,
                    backgroundColor: bg,
                    sourceImage: {
                      resourceName: img.resourceName,
                      occurrence: img.occurrence,
                      originalRect: {
                        x: img.x,
                        y: img.y,
                        width: img.width,
                        height: img.height,
                      },
                    },
                  }
                  onAdd(newAnnotation)
                  onSelect(newAnnotation.id)
                }}
              />
            )
          })}
        {annotations.map((a) => {
          const display = preview && preview.id === a.id ? preview : a
          return display.points ? (
            <svg
              key={a.id}
              className={`ink ${selectedId === a.id ? 'selected' : ''}`}
              viewBox={`0 0 ${size.width} ${size.height}`}
              onPointerDown={(e) => {
                e.stopPropagation()
                onSelect(a.id)
              }}
            >
              <path
                d={path(display.points)}
                stroke={a.color}
                strokeWidth={a.type === 'signature' ? 3 : 2.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : a.type === 'image' && (a.imageDataUrl || a.replacementDataUrl) ? (
            <div key={a.id}>
              {a.sourceImage && (
                <div
                  className="source-image-mask"
                  style={{
                    position: 'absolute',
                    left: `${a.sourceImage.originalRect.x * 100}%`,
                    top: `${a.sourceImage.originalRect.y * 100}%`,
                    width: `${a.sourceImage.originalRect.width * 100}%`,
                    height: `${a.sourceImage.originalRect.height * 100}%`,
                    backgroundColor: a.backgroundColor || '#ffffff',
                    pointerEvents: 'none',
                    zIndex: 9,
                  }}
                />
              )}
              {!a.deleted && (
                <div
                  className={`image-annotation-wrapper ${selectedId === a.id ? 'selected' : ''}`}
                  style={{
                    position: 'absolute',
                    left: `${display.x * 100}%`,
                    top: `${display.y * 100}%`,
                    width: `${display.width * 100}%`,
                    height: `${display.height * 100}%`,
                    overflow: 'hidden',
                    zIndex: 20,
                  }}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    onSelect(a.id)
                  }}
                >
                  {(() => {
                    const rot = display.imageRotation ?? 0
                    const layout = croppedPreviewLayout(display, size)
                    const scaleX = display.flipH ? -1 : 1
                    const scaleY = display.flipV ? -1 : 1
                    return (
                      <img
                        draggable={false}
                        className={`image-annotation ${selectedId === a.id ? 'selected' : ''}`}
                        src={display.replacementDataUrl || display.imageDataUrl}
                        alt="Inserted"
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: '50%',
                          width: `${layout.fullWidth}px`,
                          height: `${layout.fullHeight}px`,
                          transform: `translate(-50%, -50%) rotate(${rot}deg) scale(${scaleX}, ${scaleY}) translate(${layout.dx}px, ${layout.dy}px)`,
                          opacity: display.opacity ?? 1,
                          pointerEvents: 'none',
                        }}
                      />
                    )
                  })()}
                </div>
              )}
            </div>
          ) : a.deleted ? null : inlineEdit?.kind === 'annotation' && inlineEdit.id === a.id ? (
            <textarea
              key={a.id}
              ref={(el) => {
                if (el) {
                  el.style.height = 'auto'
                  const minH = a.height * size.height
                  el.style.height = `${Math.max(el.scrollHeight, minH)}px`
                }
              }}
              autoFocus
              className="inline-text-editor annotation-editor"
              title="Enter: lưu · Shift+Enter: xuống dòng · Esc: huỷ"
              value={inlineEdit.value}
              style={{
                left: `${a.x * 100}%`,
                top: `${a.y * 100}%`,
                width: `${a.width * 100}%`,
                minHeight: `${a.height * 100}%`,
                fontSize: (a.fontSize || 16) * zoom,
                lineHeight: a.lineHeight ? `${a.lineHeight * zoom}px` : undefined,
                whiteSpace: 'pre-wrap',
                fontFamily: cssFontStack(a.fontFamily),
                fontWeight: a.bold ? 700 : 400,
                fontStyle: a.italic ? 'italic' : 'normal',
                textDecoration: a.underline ? 'underline' : 'none',
                color: a.color,
                textAlign: a.align || 'left',
                backgroundColor: inlineEdit.backgroundColor || '#fff',
              }}
              onChange={(e) => {
                setInlineEdit({ ...inlineEdit, value: e.target.value })
                e.target.style.height = 'auto'
                const minH = a.height * size.height
                e.target.style.height = `${Math.max(e.target.scrollHeight, minH)}px`
              }}
              onKeyDown={editorKeyDown}
              onBlur={() => finishInlineEdit(true)}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            <div
              key={a.id}
              className={`annotation ${a.type} ${a.replaceOriginal ? 'replacement' : ''} ${selectedId === a.id ? 'selected' : ''}`}
              style={
                {
                  left: `${display.x * 100}%`,
                  top: `${display.y * 100}%`,
                  width: `${(a.replaceOriginal && !a.originalLineRects && a.maxWidth !== undefined ? Math.max(display.width, a.maxWidth) : display.width) * 100}%`,
                  height: `${display.height * 100}%`,
                  backgroundColor: annotationFill(display),
                  '--replacement-background': a.backgroundColor || '#fff',
                  '--mask-pad-x': `${(a.maskPadX ?? 0.0015) * size.width}px`,
                  '--mask-pad-top': `${(a.maskPadTop ?? 0.001) * size.height}px`,
                  '--mask-pad-bottom': `${(a.maskPadBottom ?? 0.0015) * size.height}px`,
                  opacity: a.opacity,
                  color: a.color,
                  fontSize: (a.fontSize || 16) * zoom,
                  lineHeight: a.replaceOriginal && a.lineHeight ? `${a.lineHeight * zoom}px` : undefined,
                  whiteSpace: a.replaceOriginal ? 'pre-wrap' : undefined,
                  overflow: a.replaceOriginal ? 'visible' : undefined,
                  fontFamily: cssFontStack(a.fontFamily),
                  fontWeight: a.bold ? 700 : 400,
                  fontStyle: a.italic ? 'italic' : 'normal',
                  textDecoration: a.underline ? 'underline' : 'none',
                  textAlign: a.align || 'left',
                } as React.CSSProperties
              }
              onPointerDown={(e) => {
                e.stopPropagation()
                onSelect(a.id)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                handleAnnotationDoubleClick(a)
              }}
            >
              {a.text}
            </div>
          )
        })}
        {showBoundingBoxes &&
          textRegions.map((region) => {
            if (inlineEdit?.kind === 'region' && inlineEdit.id === region.id) return null
            return (
              <div
                key={`bbox-reg-${region.id}`}
                className="bounding-box-region"
                style={{
                  position: 'absolute',
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                  border: '1px dashed var(--accent, #0047af)',
                  pointerEvents: 'none',
                  zIndex: 44,
                  boxSizing: 'border-box',
                }}
              />
            )
          })}
        {showBoundingBoxes &&
          pageImages.map((img) => {
            if (activeSourceImageKeys.has(`${img.resourceName}-${img.occurrence}`)) return null
            return (
              <div
                key={`bbox-img-${img.id}`}
                className="bounding-box-image"
                style={{
                  position: 'absolute',
                  left: `${img.x * 100}%`,
                  top: `${img.y * 100}%`,
                  width: `${img.width * 100}%`,
                  height: `${img.height * 100}%`,
                  border: '1px dashed var(--accent, #0047af)',
                  pointerEvents: 'none',
                  zIndex: 44,
                  boxSizing: 'border-box',
                }}
              />
            )
          })}
        {showBoundingBoxes &&
          annotations.map((a) => {
            if (a.deleted) return null
            if (inlineEdit?.kind === 'annotation' && inlineEdit.id === a.id) return null
            const b = getBounds(a)
            return (
              <div
                key={`bbox-ann-${a.id}`}
                className="bounding-box-annotation"
                style={{
                  position: 'absolute',
                  left: `${b.x * 100}%`,
                  top: `${b.y * 100}%`,
                  width: `${b.width * 100}%`,
                  height: `${b.height * 100}%`,
                  border: '1px dashed var(--accent, #0047af)',
                  pointerEvents: 'none',
                  zIndex: 44,
                  boxSizing: 'border-box',
                }}
              />
            )
          })}
        {selectedAnnotation && !inlineEdit && !selectedAnnotation.deleted && (
          <SelectionFrame
            annotation={preview && preview.id === selectedAnnotation.id ? preview : selectedAnnotation}
            zoom={zoom}
            pageSize={size}
            isDesktop={isDesktop}
            onPreviewChange={setPreview}
            onCommit={(updated, kind) => {
              setPreview(null)
              if (kind === 'resize' && onResize) {
                onResize(updated)
              } else {
                onUpdate(updated)
              }
            }}
            onDoubleClick={() => handleAnnotationDoubleClick(selectedAnnotation)}
            pageAnnotations={annotations}
            aspectLocked={aspectLocked}
          />
        )}
        {creatingText && (
          <textarea
            autoFocus
            className="inline-text-editor annotation-editor"
            value={creatingText.value}
            style={{
              left: `${creatingText.x * 100}%`,
              top: `${creatingText.y * 100}%`,
              width: `${creatingText.width * 100}%`,
              height: `${creatingText.height * 100}%`,
              fontSize: (textStyle?.fontSize || 16) * zoom,
              fontFamily: cssFontStack(textStyle?.fontFamily),
              fontWeight: textStyle?.bold ? 700 : 400,
              fontStyle: textStyle?.italic ? 'italic' : 'normal',
              textDecoration: textStyle?.underline ? 'underline' : 'none',
              color: textStyle?.color || color,
              textAlign: textStyle?.align || 'left',
              backgroundColor: '#fff',
            }}
            onChange={(e) => setCreatingText({ ...creatingText, value: e.target.value })}
            onKeyDown={creatingTextKeyDown}
            onBlur={() => finishCreatingText(true)}
            onPointerDown={(e) => e.stopPropagation()}
          />
        )}
        {draft.length > 1 && (tool === 'draw' || tool === 'signature') && (
          <svg className="ink draft" viewBox={`0 0 ${size.width} ${size.height}`}>
            <path d={path(draft)} stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </svg>
        )}
        {draft.length > 1 && tool === 'highlight' && (() => {
          const r = draftRect(draft[0], draft[draft.length - 1])
          return (
            <div
              className="annotation highlight draft"
              style={{
                position: 'absolute',
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.width * 100}%`,
                height: `${r.height * 100}%`,
                backgroundColor: color,
                opacity: 0.38,
                mixBlendMode: 'multiply',
                pointerEvents: 'none',
              }}
            />
          )
        })()}
        {draft.length > 1 && tool === 'text' && (() => {
          const r = draftRect(draft[0], draft[draft.length - 1])
          return (
            <div
              className="annotation text draft"
              style={{
                position: 'absolute',
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.width * 100}%`,
                height: `${r.height * 100}%`,
                border: '1px dashed var(--accent, #0047af)',
                backgroundColor: 'transparent',
                pointerEvents: 'none',
              }}
            />
          )
        })()}
      </div>
    </div>
  )
}

