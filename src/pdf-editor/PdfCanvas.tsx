import { useEffect, useRef, useState } from 'react'
import type * as pdfjs from 'pdfjs-dist'
import type { Annotation, Point, TextRegion, Tool } from '../types'
import { clamp, uid } from './geometry'
import { groupTextItemsIntoLines } from './textExtraction'

export interface PdfCanvasProps {
  pdf: pdfjs.PDFDocumentProxy
  pageNumber: number
  zoom: number
  annotations: Annotation[]
  tool: Tool
  color: string
  onAdd: (a: Annotation) => void
  onUpdate: (a: Annotation) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  textRegions: TextRegion[]
  onTextRegions: (regions: TextRegion[]) => void
  onEditRegion: (region: TextRegion, text: string) => void
  onEditAnnotation: (annotation: Annotation, text: string) => void
}

export function PdfCanvas({
  pdf,
  pageNumber,
  zoom,
  annotations,
  tool,
  color,
  onAdd,
  onUpdate,
  selectedId,
  onSelect,
  textRegions,
  onTextRegions,
  onEditRegion,
  onEditAnnotation,
}: PdfCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 612, height: 792 })
  const [draft, setDraft] = useState<Point[]>([])
  const [inlineEdit, setInlineEdit] = useState<{
    kind: 'region' | 'annotation'
    id: string
    value: string
    backgroundColor?: string
  } | null>(null)
  const [imageDrag, setImageDrag] = useState<{
    id: string
    startClientX: number
    startClientY: number
    startX: number
    startY: number
    x: number
    y: number
  } | null>(null)

  useEffect(() => {
    if (!imageDrag) return
    const move = (event: PointerEvent) => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      setImageDrag((drag) =>
        drag
          ? {
              ...drag,
              x: clamp(drag.startX + (event.clientX - drag.startClientX) / rect.width, 0, 1),
              y: clamp(drag.startY + (event.clientY - drag.startClientY) / rect.height, 0, 1),
            }
          : null,
      )
    }
    const up = () => {
      setImageDrag((drag) => {
        if (drag) {
          const annotation = annotations.find((item) => item.id === drag.id)
          if (annotation) {
            onUpdate({
              ...annotation,
              x: clamp(drag.x, 0, 1 - annotation.width),
              y: clamp(drag.y, 0, 1 - annotation.height),
            })
          }
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [annotations, imageDrag, onUpdate])

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
    })().catch((error) => {
      if (error?.name !== 'RenderingCancelledException') console.error(error)
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdf, pageNumber, zoom])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      if (cancelled) return
      const regions = groupTextItemsIntoLines(content.items, content.styles, viewport, pageNumber)
      onTextRegions(regions)
    })().catch(console.error)
    return () => {
      cancelled = true
    }
  }, [onTextRegions, pageNumber, pdf])

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
      const text = window.prompt('Enter text')?.trim()
      if (text) onAdd({ ...base, text, fontSize: 16 })
    } else if (tool === 'draw' || tool === 'signature') {
      onAdd({ ...base, points: [...draft, end], width: 0, height: 0 })
    } else onAdd(base)
    setDraft([])
  }

  const path = (points: Point[]) =>
    points.map((p, i) => `${i ? 'L' : 'M'} ${p.x * size.width} ${p.y * size.height}`).join(' ')

  const sampleBackground = (region: Pick<TextRegion, 'x' | 'y' | 'width' | 'height'>) => {
    const canvas = canvasRef.current
    if (!canvas) return '#ffffff'
    const ratioX = canvas.width / size.width,
      ratioY = canvas.height / size.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return '#ffffff'
    const samples: number[][] = []
    for (let row = 0; row < 7; row++)
      for (let column = 0; column < 13; column++) {
        const px = (column + 0.5) / 13,
          py = (row + 0.5) / 7
        const x = clamp(Math.round((region.x + region.width * px) * size.width * ratioX), 0, canvas.width - 1)
        const y = clamp(Math.round((region.y + region.height * py) * size.height * ratioY), 0, canvas.height - 1)
        samples.push(Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)))
      }
    const buckets = new Map<string, number[][]>()
    samples.forEach((pixel) => {
      const key = pixel.map((channel) => Math.round(channel / 12) * 12).join(',')
      buckets.set(key, [...(buckets.get(key) || []), pixel])
    })
    const dominant = [...buckets.values()].sort((a, b) => b.length - a.length)[0] || [[255, 255, 255]]
    const channel = (index: number) =>
      Math.round(dominant.reduce((sum, pixel) => sum + pixel[index], 0) / dominant.length)
    return `#${[channel(0), channel(1), channel(2)].map((value) => value.toString(16).padStart(2, '0')).join('')}`
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
                autoFocus
                className="inline-text-editor"
                value={inlineEdit.value}
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${Math.max(region.width, 0.04) * 100}%`,
                  height: `${Math.max(region.height, 0.018) * 100}%`,
                  fontSize: region.fontSize * zoom,
                  fontFamily: region.fontFamily || 'Helvetica',
                  fontWeight: region.bold ? 700 : 400,
                  fontStyle: region.italic ? 'italic' : 'normal',
                  color: region.color || '#000',
                  textAlign: region.align || 'left',
                  backgroundColor: inlineEdit.backgroundColor || '#fff',
                }}
                onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                onKeyDown={editorKeyDown}
                onBlur={() => finishInlineEdit(true)}
                onPointerDown={(e) => e.stopPropagation()}
              />
            ) : (
              <button
                key={region.id}
                className={`text-region ${region.source}`}
                title={`${region.source === 'ocr' ? 'OCR' : 'PDF'}: ${region.text}`}
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  setInlineEdit({
                    kind: 'region',
                    id: region.id,
                    value: region.text,
                    backgroundColor: sampleBackground(region),
                  })
                }}
              >
                <span>{region.text}</span>
              </button>
            ),
          )}
        {annotations.map((a) =>
          a.points ? (
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
                d={path(a.points)}
                stroke={a.color}
                strokeWidth={a.type === 'signature' ? 3 : 2.5}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : a.type === 'image' && a.imageDataUrl ? (
            <img
              key={a.id}
              draggable={false}
              className={`image-annotation ${selectedId === a.id ? 'selected' : ''} ${imageDrag?.id === a.id ? 'dragging' : ''}`}
              src={a.imageDataUrl}
              alt="Inserted"
              style={{
                left: `${(imageDrag?.id === a.id ? clamp(imageDrag.x, 0, 1 - a.width) : a.x) * 100}%`,
                top: `${(imageDrag?.id === a.id ? clamp(imageDrag.y, 0, 1 - a.height) : a.y) * 100}%`,
                width: `${a.width * 100}%`,
                height: `${a.height * 100}%`,
              }}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onSelect(a.id)
                setImageDrag({
                  id: a.id,
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  startX: a.x,
                  startY: a.y,
                  x: a.x,
                  y: a.y,
                })
              }}
            />
          ) : inlineEdit?.kind === 'annotation' && inlineEdit.id === a.id ? (
            <textarea
              key={a.id}
              autoFocus
              className="inline-text-editor annotation-editor"
              value={inlineEdit.value}
              style={{
                left: `${a.x * 100}%`,
                top: `${a.y * 100}%`,
                width: `${a.width * 100}%`,
                height: `${a.height * 100}%`,
                fontSize: (a.fontSize || 16) * zoom,
                fontFamily: a.fontFamily || 'Helvetica',
                fontWeight: a.bold ? 700 : 400,
                fontStyle: a.italic ? 'italic' : 'normal',
                textDecoration: a.underline ? 'underline' : 'none',
                color: a.color,
                textAlign: a.align || 'left',
                backgroundColor: inlineEdit.backgroundColor || '#fff',
              }}
              onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
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
                  left: `${a.x * 100}%`,
                  top: `${a.y * 100}%`,
                  width: `${a.width * 100}%`,
                  height: `${a.height * 100}%`,
                  '--replacement-background': a.backgroundColor || '#fff',
                  '--mask-pad-x': `${(a.maskPadX ?? 0.0015) * size.width}px`,
                  '--mask-pad-top': `${(a.maskPadTop ?? 0.001) * size.height}px`,
                  '--mask-pad-bottom': `${(a.maskPadBottom ?? 0.0015) * size.height}px`,
                  opacity: a.opacity,
                  color: a.color,
                  fontSize: (a.fontSize || 16) * zoom,
                  fontFamily: a.fontFamily || 'Helvetica',
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
                if (a.type === 'text')
                  setInlineEdit({
                    kind: 'annotation',
                    id: a.id,
                    value: a.text || '',
                    backgroundColor: a.replaceOriginal ? sampleBackground(a) : a.backgroundColor,
                  })
              }}
            >
              {a.text}
            </div>
          ),
        )}
        {draft.length > 1 && (
          <svg className="ink draft" viewBox={`0 0 ${size.width} ${size.height}`}>
            <path d={path(draft)} stroke={color} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          </svg>
        )}
      </div>
    </div>
  )
}
