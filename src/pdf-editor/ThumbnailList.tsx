import { useEffect, useRef, useState } from 'react'
import type * as pdfjs from 'pdfjs-dist'

export interface ThumbnailListProps {
  pdf: pdfjs.PDFDocumentProxy
  pageCount: number
  currentPage: number
  onSelectPage: (page: number) => void
  bytesVersion?: number | string
}

interface SingleThumbProps {
  pdf: pdfjs.PDFDocumentProxy
  pageNumber: number
  isActive: boolean
  onClick: () => void
  bytesVersion?: number | string
}

function SingleThumbnail({
  pdf,
  pageNumber,
  isActive,
  onClick,
  bytesVersion,
}: SingleThumbProps) {
  const containerRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  const [rendered, setRendered] = useState(false)
  const [aspectRatio, setAspectRatio] = useState(4 / 3) // default portrait aspect

  useEffect(() => {
    if (isActive && typeof containerRef.current?.scrollIntoView === 'function') {
      containerRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [isActive])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
          }
        }
      },
      { rootMargin: '100px 0px' },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!inView || rendered || !canvasRef.current) return

    let cancelled = false
    let task: pdfjs.RenderTask | undefined

    ;(async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return

        const unscaled = page.getViewport({ scale: 1 })
        const targetWidthCss = 120
        const scale = targetWidthCss / unscaled.width
        const viewport = page.getViewport({ scale })

        const nextRatio = unscaled.height / unscaled.width
        setAspectRatio((prev) => (Math.abs(prev - nextRatio) > 0.01 ? nextRatio : prev))

        const canvas = canvasRef.current
        if (!canvas || cancelled) return

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        const transform = dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0]
        task = page.render({
          canvas,
          viewport,
          transform,
        })

        await task.promise
        if (!cancelled) {
          setRendered(true)
        }
      } catch (err: unknown) {
        if ((err as { name?: string })?.name !== 'RenderingCancelledException') {
          console.error(`Error rendering thumbnail for page ${pageNumber}:`, err)
        }
      }
    })()

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [inView, rendered, pdf, pageNumber, bytesVersion])

  return (
    <button
      ref={containerRef}
      type="button"
      className={`real-thumb ${isActive ? 'active' : ''}`}
      onClick={onClick}
      aria-label={`Trang ${pageNumber}`}
    >
      <div
        className="real-thumb-canvas-wrap"
        style={{ minHeight: `${Math.round(120 * aspectRatio)}px` }}
      >
        <canvas ref={canvasRef} className="real-thumb-canvas" />
        {!rendered && (
          <div className="real-thumb-placeholder">
            <span>{pageNumber}</span>
          </div>
        )}
      </div>
      <small>{pageNumber}</small>
    </button>
  )
}

export function ThumbnailList({
  pdf,
  pageCount,
  currentPage,
  onSelectPage,
  bytesVersion,
}: ThumbnailListProps) {
  return (
    <div className="real-thumbs-container thumbs">
      {Array.from({ length: pageCount }, (_, i) => {
        const pageNumber = i + 1
        return (
          <SingleThumbnail
            key={`${bytesVersion ?? 0}-${pageNumber}`}
            pdf={pdf}
            pageNumber={pageNumber}
            isActive={currentPage === pageNumber}
            onClick={() => onSelectPage(pageNumber)}
            bytesVersion={bytesVersion}
          />
        )
      })}
    </div>
  )
}
