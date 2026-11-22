import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  ImagePlus,
  FilePlus2,
  ArrowUp,
  ArrowDown,
  RotateCw,
  Trash2,
  BadgeCheck,
  ScanText,
  BoxSelect,
} from 'lucide-react'
import type { OverflowGroupId } from './useToolbarLayout'

export interface ToolbarOverflowMenuProps {
  hiddenGroups: OverflowGroupId[]
  onInsertImage: () => void
  onInsertPage: () => void
  page: number
  pageCount: number
  onMovePage: (delta: -1 | 1) => void
  onRotatePage: () => void
  canRotate: boolean
  rotateLabel: string
  onDeletePage: () => void
  onSign: () => void
  onScanOcr: () => void
  ocrBusy: boolean
  ocrProgress: number
  showBoundingBoxes?: boolean
  onToggleBoundingBoxes?: () => void
  portalTarget?: HTMLElement | null
}

interface MenuItemConfig {
  id: string
  label: string
  icon: React.ComponentType<{ size?: number }>
  onClick: () => void
  disabled?: boolean
  title?: string
}

export function ToolbarOverflowMenu({
  hiddenGroups,
  onInsertImage,
  onInsertPage,
  page,
  pageCount,
  onMovePage,
  onRotatePage,
  canRotate,
  rotateLabel,
  onDeletePage,
  onSign,
  onScanOcr,
  ocrBusy,
  ocrProgress,
  showBoundingBoxes,
  onToggleBoundingBoxes,
  portalTarget: explicitPortalTarget,
}: ToolbarOverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [isInsideToolbar, setIsInsideToolbar] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const triggerCallbackRef = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node
    if (node) {
      setIsInsideToolbar(Boolean(node.closest('.toolbar')))
    }
  }, [])

  // Build items grouped by hiddenGroups
  const items: MenuItemConfig[] = []

  if (hiddenGroups.includes('insert')) {
    items.push({
      id: 'insert-image',
      label: 'Chèn ảnh',
      icon: ImagePlus,
      onClick: onInsertImage,
    })
    items.push({
      id: 'insert-page',
      label: 'Chèn trang',
      icon: FilePlus2,
      onClick: onInsertPage,
    })
  }

  if (hiddenGroups.includes('page')) {
    items.push({
      id: 'move-page-up',
      label: 'Di chuyển trang lên',
      icon: ArrowUp,
      disabled: page <= 1,
      onClick: () => onMovePage(-1),
    })
    items.push({
      id: 'move-page-down',
      label: 'Di chuyển trang xuống',
      icon: ArrowDown,
      disabled: page >= pageCount,
      onClick: () => onMovePage(1),
    })
    items.push({
      id: 'rotate-page',
      label: 'Xoay trang',
      icon: RotateCw,
      disabled: !canRotate,
      title: rotateLabel,
      onClick: onRotatePage,
    })
    items.push({
      id: 'delete-page',
      label: 'Xóa trang hiện tại',
      icon: Trash2,
      disabled: pageCount <= 1,
      onClick: onDeletePage,
    })
  }

  if (hiddenGroups.includes('signOcr')) {
    items.push({
      id: 'sign',
      label: 'Ký số',
      icon: BadgeCheck,
      onClick: onSign,
    })
    items.push({
      id: 'scan-ocr',
      label: ocrBusy ? `OCR ${ocrProgress}%` : 'Scan OCR',
      icon: ScanText,
      disabled: ocrBusy,
      onClick: onScanOcr,
    })
  }

  if (hiddenGroups.includes('boundingBox') && onToggleBoundingBoxes) {
    items.push({
      id: 'toggle-bounding-box',
      label: showBoundingBoxes ? 'Ẩn khung bao' : 'Hiện khung bao',
      icon: BoxSelect,
      onClick: onToggleBoundingBoxes,
    })
  }

  const closeMenu = useCallback(() => {
    setIsOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }, [])

  useLayoutEffect(() => {
    if (!isOpen) return

    const btn = triggerRef.current
    const menuEl = menuRef.current
    if (!btn) return

    const btnRect = btn.getBoundingClientRect()
    const viewportWidth =
      typeof window !== 'undefined'
        ? window.innerWidth || document.documentElement.clientWidth || 1024
        : 1024
    const viewportHeight =
      typeof window !== 'undefined'
        ? window.innerHeight || document.documentElement.clientHeight || 768
        : 768

    const menuWidth = menuEl?.offsetWidth || menuEl?.getBoundingClientRect().width || 200
    const menuHeight = menuEl?.offsetHeight || menuEl?.getBoundingClientRect().height || 260

    let left = btnRect.right - menuWidth
    if (left < 8) {
      left = 8
    }
    if (left + menuWidth > viewportWidth - 8) {
      left = Math.max(8, viewportWidth - 8 - menuWidth)
    }

    let top = btnRect.bottom + 6
    if (top + menuHeight > viewportHeight && btnRect.top - 6 - menuHeight >= 0) {
      top = btnRect.top - 6 - menuHeight
    } else if (top + menuHeight > viewportHeight) {
      if (btnRect.top > viewportHeight - btnRect.bottom) {
        top = Math.max(8, btnRect.top - 6 - menuHeight)
      }
    }

    const nextTop = Math.round(top)
    const nextLeft = Math.round(left)
    setCoords({ top: nextTop, left: nextLeft })

    if (menuEl) {
      menuEl.style.top = `${nextTop}px`
      menuEl.style.left = `${nextLeft}px`
    }
  }, [isOpen])

  // Close on window resize or scroll outside menu (capture phase)
  useEffect(() => {
    if (!isOpen) return

    const handleWindowResize = () => {
      closeMenu()
    }

    const handleScroll = () => {
      closeMenu()
    }

    window.addEventListener('resize', handleWindowResize)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      window.removeEventListener('resize', handleWindowResize)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [isOpen, closeMenu])

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen])

  // Focus first item on open without scrolling
  useEffect(() => {
    if (isOpen && menuRef.current) {
      const firstBtn = menuRef.current.querySelector<HTMLButtonElement>(
        'button[role="menuitem"]:not([disabled])'
      )
      if (firstBtn) {
        firstBtn.focus({ preventScroll: true })
      } else {
        const anyBtn = menuRef.current.querySelector<HTMLButtonElement>(
          'button[role="menuitem"]'
        )
        anyBtn?.focus({ preventScroll: true })
      }
    }
  }, [isOpen])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!menuRef.current) return

    const menuItems = Array.from(
      menuRef.current.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')
    )
    if (menuItems.length === 0) return

    const currentIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const nextIndex = currentIndex < menuItems.length - 1 ? currentIndex + 1 : 0
      menuItems[nextIndex].focus({ preventScroll: true })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1
      menuItems[prevIndex].focus({ preventScroll: true })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
    }
  }

  if (items.length === 0) {
    return null
  }

  // Determine portal target:
  // When inside .toolbar, portal to document.body so the toolbar scroll container
  // never clips the menu and never scrolls when focused.
  const resolvedPortalTarget =
    explicitPortalTarget !== undefined
      ? explicitPortalTarget
      : isInsideToolbar && typeof document !== 'undefined'
        ? document.body
        : null

  const menuElement = (
    <div
      ref={menuRef}
      className="toolbar-overflow-menu"
      role="menu"
      aria-label="Thêm thao tác"
      style={{
        position: 'fixed',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
      }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="toolbar-overflow-item"
            disabled={item.disabled}
            aria-disabled={item.disabled ? 'true' : undefined}
            title={item.title}
            onClick={() => {
              if (item.disabled) return
              item.onClick()
              closeMenu()
            }}
          >
            <Icon size={16} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )

  return (
    <div className="toolbar-overflow-container">
      <button
        ref={triggerCallbackRef}
        type="button"
        className="icon-button toolbar-overflow-btn"
        aria-label="Thêm thao tác"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
        title="Thêm thao tác"
      >
        ⋯
      </button>

      {isOpen &&
        (resolvedPortalTarget
          ? createPortal(menuElement, resolvedPortalTarget)
          : menuElement)}
    </div>
  )
}
