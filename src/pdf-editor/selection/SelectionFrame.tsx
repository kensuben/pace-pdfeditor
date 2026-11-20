import React, { useRef } from 'react'
import type { Annotation } from '../../types'
import { getBounds, moveBy, resizeFromHandle, type Handle } from './geometry'
import './selection.css'

export interface SelectionFrameProps {
  annotation: Annotation
  zoom: number
  pageSize: { width: number; height: number }
  isDesktop: boolean
  onPreviewChange: (preview: Annotation | null) => void
  onCommit: (updated: Annotation, kind: 'move' | 'resize') => void
  onDoubleClick?: () => void
}

const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'Kéo giãn góc trên trái',
  n: 'Kéo giãn cạnh trên',
  ne: 'Kéo giãn góc trên phải',
  e: 'Kéo giãn cạnh phải',
  se: 'Kéo giãn góc dưới phải',
  s: 'Kéo giãn cạnh dưới',
  sw: 'Kéo giãn góc dưới trái',
  w: 'Kéo giãn cạnh trái',
}

const CORNER_HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw']
const ALL_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function SelectionFrame({
  annotation,
  pageSize,
  isDesktop,
  onPreviewChange,
  onCommit,
  onDoubleClick,
}: SelectionFrameProps) {
  const activeInteraction = useRef<{
    mode: 'move' | 'resize'
    handle?: Handle
    startClientX: number
    startClientY: number
    originalAnnotation: Annotation
    currentAnnotation: Annotation
  } | null>(null)

  const bounds = getBounds(annotation)
  const isReplacement = Boolean(annotation.replaceOriginal)

  // Determine which handles to show
  let handles: Handle[] = []
  if (isDesktop && !isReplacement) {
    if (annotation.type === 'draw' || annotation.type === 'signature') {
      handles = CORNER_HANDLES
    } else {
      handles = ALL_HANDLES
    }
  }

  const minSize = {
    w: Math.max(0.005, 8 / pageSize.width),
    h: Math.max(0.005, 8 / pageSize.height),
  }

  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    if (!isDesktop || isReplacement) return
    e.currentTarget.setPointerCapture(e.pointerId)

    activeInteraction.current = {
      mode: 'move',
      startClientX: e.clientX,
      startClientY: e.clientY,
      originalAnnotation: annotation,
      currentAnnotation: annotation,
    }
  }

  const onHandlePointerDown = (e: React.PointerEvent<HTMLButtonElement>, handle: Handle) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)

    activeInteraction.current = {
      mode: 'resize',
      handle,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originalAnnotation: annotation,
      currentAnnotation: annotation,
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const active = activeInteraction.current
    if (!active) return

    const dx = (e.clientX - active.startClientX) / pageSize.width
    const dy = (e.clientY - active.startClientY) / pageSize.height

    if (active.mode === 'move') {
      const updated = moveBy(active.originalAnnotation, dx, dy)
      active.currentAnnotation = updated
      onPreviewChange(updated)
    } else if (active.mode === 'resize' && active.handle) {
      let keepAspect = false
      if (active.originalAnnotation.type === 'draw' || active.originalAnnotation.type === 'signature') {
        keepAspect = true
      } else if (active.originalAnnotation.type === 'image') {
        keepAspect = !e.shiftKey
      }

      const updated = resizeFromHandle(active.originalAnnotation, active.handle, dx, dy, {
        keepAspect,
        minSize,
      })
      active.currentAnnotation = updated
      onPreviewChange(updated)
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const active = activeInteraction.current
    if (!active) return

    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Ignore if pointer capture already released
    }

    activeInteraction.current = null
    onPreviewChange(null)

    // Check if changed
    const origBounds = getBounds(active.originalAnnotation)
    const newBounds = getBounds(active.currentAnnotation)
    const moved = Math.abs(newBounds.x - origBounds.x) > 1e-5 || Math.abs(newBounds.y - origBounds.y) > 1e-5
    const resized = Math.abs(newBounds.width - origBounds.width) > 1e-5 || Math.abs(newBounds.height - origBounds.height) > 1e-5

    if (active.mode === 'resize' && (resized || moved)) {
      onCommit(active.currentAnnotation, 'resize')
    } else if (active.mode === 'move' && (moved || resized)) {
      onCommit(active.currentAnnotation, 'move')
    }
  }

  return (
    <div
      className={`selection-frame ${isReplacement ? 'not-allowed' : isDesktop ? 'movable' : ''}`}
      title={
        isReplacement
          ? 'Chữ thay thế chữ gốc chưa di chuyển được (sẽ hỗ trợ khi xoá chữ gốc thật)'
          : undefined
      }
      style={{
        left: `${bounds.x * 100}%`,
        top: `${bounds.y * 100}%`,
        width: `${bounds.width * 100}%`,
        height: `${bounds.height * 100}%`,
      }}
      onPointerDown={onBodyPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick?.()
      }}
    >
      {handles.map((h) => (
        <button
          key={h}
          type="button"
          className={`selection-handle handle-${h}`}
          aria-label={HANDLE_LABELS[h]}
          onPointerDown={(e) => onHandlePointerDown(e, h)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      ))}
    </div>
  )
}
