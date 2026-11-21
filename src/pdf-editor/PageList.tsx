import { useCallback, useEffect, useRef, useState } from 'react'
import type * as pdfjs from 'pdfjs-dist'
import type { Annotation, TextRegion, TextStyle, Tool } from '../types'
import { clamp } from './geometry'
import { PdfCanvas } from './PdfCanvas'
import { FIT_PADDING, fitZoom, pickCurrentPage, anchorScrollDelta, type ClientRectLike } from './viewMath'

export interface PageListProps {
  pdf: pdfjs.PDFDocumentProxy
  pageCount: number
  zoom: number
  annotations: Annotation[]
  tool: Tool
  color: string
  textStyle?: TextStyle
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAdd: (a: Annotation) => void
  onUpdate: (a: Annotation) => void
  onResize?: (a: Annotation) => void
  onNudge?: (a: Annotation) => void
  textRegions: Record<number, TextRegion[]>
  onTextRegions: (page: number, regions: TextRegion[]) => void
  onEditRegion: (region: TextRegion, text: string) => void
  onEditAnnotation: (annotation: Annotation, text: string) => void
  currentPage: number
  onCurrentPageChange: (page: number) => void
  containerRef?: React.RefObject<HTMLDivElement | null>
  onZoomChange?: (nextZoom: number) => void
  onInitialFit?: (initialZoom: number) => void
  showBoundingBoxes?: boolean
  aspectLocked?: boolean
}

interface PageDimensions {
  width: number
  height: number
}

// End PageDimensions

export function PageList({
  pdf,
  pageCount,
  zoom,
  annotations,
  tool,
  color,
  textStyle,
  selectedId,
  onSelect,
  onAdd,
  onUpdate,
  onResize,
  onNudge,
  textRegions,
  onTextRegions,
  onEditRegion,
  onEditAnnotation,
  currentPage,
  onCurrentPageChange,
  containerRef: externalContainerRef,
  onZoomChange,
  onInitialFit,
  showBoundingBoxes,
  aspectLocked,
}: PageListProps) {
  const localContainerRef = useRef<HTMLDivElement>(null)
  const containerRef = externalContainerRef || localContainerRef
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const [dimensions, setDimensions] = useState<PageDimensions[]>([])
  const [visiblePageNumbers, setVisiblePageNumbers] = useState<Set<number>>(
    () => new Set(Array.from({ length: Math.min(pageCount, 6) }, (_, i) => i + 1)),
  )
  const visibleAreasRef = useRef<number[]>([])
  const onCurrentPageChangeRef = useRef(onCurrentPageChange)
  useEffect(() => {
    onCurrentPageChangeRef.current = onCurrentPageChange
  })

  const zoomRef = useRef(zoom)
  useEffect(() => {
    zoomRef.current = zoom
  }, [zoom])

  const onZoomChangeRef = useRef(onZoomChange)
  useEffect(() => {
    onZoomChangeRef.current = onZoomChange
  })

  interface ZoomAnchor {
    pageIndex: number
    fx: number
    fy: number
    pointer: { x: number; y: number }
    beforeRect: ClientRectLike
  }

  const pendingAnchorRef = useRef<ZoomAnchor | null>(null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const prevZoomRef = useRef(zoom)

  const findAnchorAt = useCallback(
    (clientX: number, clientY: number): ZoomAnchor | null => {
      let bestIdx = -1
      let bestRect: ClientRectLike | null = null

      for (let i = 0; i < pageRefs.current.length; i++) {
        const el = pageRefs.current[i]
        if (!el) continue
        const shellEl = el.querySelector<HTMLElement>('.page-shell') || el
        const r = shellEl.getBoundingClientRect()
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          bestIdx = i
          bestRect = r
          break
        }
      }

      if (bestIdx === -1) {
        const fallbackIdx = Math.max(0, Math.min(pageCount - 1, currentPage - 1))
        const el = pageRefs.current[fallbackIdx]
        if (el) {
          bestIdx = fallbackIdx
          const shellEl = el.querySelector<HTMLElement>('.page-shell') || el
          bestRect = shellEl.getBoundingClientRect()
        }
      }

      if (bestIdx === -1 || !bestRect) return null

      const fx = (clientX - bestRect.left) / (bestRect.width || 1)
      const fy = (clientY - bestRect.top) / (bestRect.height || 1)

      return {
        pageIndex: bestIdx,
        fx,
        fy,
        pointer: { x: clientX, y: clientY },
        beforeRect: {
          left: bestRect.left,
          top: bestRect.top,
          width: bestRect.width,
          height: bestRect.height,
        },
      }
    },
    [pageCount, currentPage],
  )

  // Wheel zoom with anchor preservation attached directly to .page-list-scroll
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handlePointerMove = (e: MouseEvent) => {
      lastPointerRef.current = { x: e.clientX, y: e.clientY }
    }

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
        const currentZ = zoomRef.current
        const nextZoom = clamp(Math.round(currentZ * factor * 100) / 100, 0.25, 4)
        if (nextZoom === currentZ) return

        const anchor = findAnchorAt(e.clientX, e.clientY)
        if (anchor) {
          pendingAnchorRef.current = anchor
        }

        onZoomChangeRef.current?.(nextZoom)
      }
    }

    el.addEventListener('mousemove', handlePointerMove)
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      el.removeEventListener('mousemove', handlePointerMove)
      el.removeEventListener('wheel', handleWheel)
    }
  }, [containerRef, findAnchorAt])

  // Anchored scroll adjustment when zoom changes (covers Ctrl+Wheel, Ctrl +/-, Zoom controls)
  useEffect(() => {
    if (prevZoomRef.current === zoom) return
    prevZoomRef.current = zoom

    const container = containerRef.current
    if (!container) return

    if (!pendingAnchorRef.current) {
      let pt = lastPointerRef.current
      if (!pt && container) {
        const cr = container.getBoundingClientRect()
        pt = { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 }
      }
      if (pt) {
        pendingAnchorRef.current = findAnchorAt(pt.x, pt.y)
      }
    }

    const anchor = pendingAnchorRef.current
    if (!anchor) return
    pendingAnchorRef.current = null

    requestAnimationFrame(() => {
      const pageEl = pageRefs.current[anchor.pageIndex]
      const scrollEl = containerRef.current
      if (!pageEl || !scrollEl) return
      const shellEl = pageEl.querySelector<HTMLElement>('.page-shell') || pageEl
      const afterRect = shellEl.getBoundingClientRect()
      const { deltaX, deltaY } = anchorScrollDelta(
        anchor.beforeRect,
        afterRect,
        anchor.fx,
        anchor.fy,
        anchor.pointer,
      )
      scrollEl.scrollLeft += deltaX
      scrollEl.scrollTop += deltaY
    })
  }, [zoom, containerRef, findAnchorAt])

  // Calculate initial zoom after layout when container has clientWidth > 0
  const initialFitDoneRef = useRef(false)
  useEffect(() => {
    initialFitDoneRef.current = false
  }, [pdf])

  const onInitialFitRef = useRef(onInitialFit)
  useEffect(() => {
    onInitialFitRef.current = onInitialFit
  })

  useEffect(() => {
    if (initialFitDoneRef.current || dimensions.length === 0) return
    const container = containerRef.current
    if (!container) return

    const tryInitialFit = () => {
      if (initialFitDoneRef.current) return
      const w = container.clientWidth
      if (w > 0) {
        initialFitDoneRef.current = true
        const page1 = dimensions[0]
        const availableW = w - FIT_PADDING
        if (page1.width > availableW) {
          const nextZ = fitZoom({ width: w, height: container.clientHeight || 700 }, page1, 'width')
          onInitialFitRef.current?.(nextZ)
        }
      }
    }

    tryInitialFit()
    if (!initialFitDoneRef.current && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        tryInitialFit()
      })
      ro.observe(container)
      return () => ro.disconnect()
    }
  }, [dimensions, containerRef])

  // Load unscaled page dimensions for all pages once per document
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const dims: PageDimensions[] = []
      for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i)
        if (cancelled) return
        const vp = page.getViewport({ scale: 1 })
        dims.push({ width: vp.width, height: vp.height })
      }
      if (!cancelled) {
        setDimensions(dims)
        visibleAreasRef.current = new Array(pageCount).fill(0)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [pdf, pageCount])

  // Track page intersections for virtualization (rootMargin ~100%) and current page
  useEffect(() => {
    const container = containerRef.current
    if (!container || dimensions.length === 0) return

    const intersectingSet = new Set<number>()
    let throttleTimeout: ReturnType<typeof setTimeout> | null = null

    const handleIntersect = (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        const pageIndex = Number(entry.target.getAttribute('data-page-index'))
        if (isNaN(pageIndex)) continue
        const pageNumber = pageIndex + 1

        if (entry.isIntersecting) {
          intersectingSet.add(pageNumber)
          visibleAreasRef.current[pageIndex] =
            entry.intersectionRect.width * entry.intersectionRect.height
        } else {
          intersectingSet.delete(pageNumber)
          visibleAreasRef.current[pageIndex] = 0
        }
      }

      // Limit active rendered canvases to at most 6 (centered around currentPage)
      let activePages = Array.from(intersectingSet)
      if (activePages.length > 6) {
        activePages.sort(
          (a, b) => Math.abs(a - currentPage) - Math.abs(b - currentPage),
        )
        activePages = activePages.slice(0, 6)
      }
      setVisiblePageNumbers(new Set(activePages))

      // Throttle current page detection to <= 10 times/sec (100ms)
      if (!throttleTimeout) {
        throttleTimeout = setTimeout(() => {
          throttleTimeout = null
          const next = pickCurrentPage(visibleAreasRef.current, currentPage)
          if (next !== currentPage && next >= 1 && next <= pageCount) {
            onCurrentPageChangeRef.current(next)
          }
        }, 100)
      }
    }

    if (typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(handleIntersect, {
      root: container,
      rootMargin: '100% 0px 100% 0px',
      threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    })

    pageRefs.current.forEach((el) => {
      if (el) observer.observe(el)
    })

    return () => {
      if (throttleTimeout) clearTimeout(throttleTimeout)
      observer.disconnect()
    }
  }, [dimensions, pageCount, currentPage, containerRef])

  const selectedAnnotation = annotations.find((a) => a.id === selectedId)

  const handleSelect = useCallback(
    (id: string | null) => {
      onSelect(id)
    },
    [onSelect],
  )

  return (
    <div ref={containerRef} className="page-list-scroll document-pages-scroll">
      {Array.from({ length: pageCount }, (_, i) => {
        const pageNumber = i + 1
        const dim = dimensions[i] || { width: 612, height: 792 }
        const pWidth = Math.round(dim.width * zoom)
        const pHeight = Math.round(dim.height * zoom)
        const isRendered = visiblePageNumbers.has(pageNumber)
        const pageAnnotations = annotations.filter((a) => a.page === pageNumber)

        return (
          <div
            key={pageNumber}
            ref={(el) => {
              pageRefs.current[i] = el
            }}
            data-page-index={i}
            data-page-number={pageNumber}
            className="page-container"
            style={{
              width: `${pWidth}px`,
              minHeight: `${pHeight}px`,
            }}
          >
            {isRendered ? (
              <PdfCanvas
                pdf={pdf}
                pageNumber={pageNumber}
                zoom={zoom}
                annotations={pageAnnotations}
                tool={tool}
                color={color}
                textStyle={textStyle}
                onAdd={(a) => onAdd({ ...a, page: pageNumber })}
                onUpdate={onUpdate}
                onResize={onResize}
                onNudge={onNudge}
                selectedId={
                  selectedAnnotation?.page === pageNumber ? selectedId : null
                }
                onSelect={handleSelect}
                textRegions={textRegions[pageNumber] || []}
                onTextRegions={(regions) => onTextRegions(pageNumber, regions)}
                onEditRegion={onEditRegion}
                onEditAnnotation={onEditAnnotation}
                showBoundingBoxes={showBoundingBoxes}
                aspectLocked={aspectLocked}
              />
            ) : (
              <div
                className="page-placeholder"
                style={{
                  width: `${pWidth}px`,
                  height: `${pHeight}px`,
                }}
              >
                <span className="page-placeholder-badge">Trang {pageNumber}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
