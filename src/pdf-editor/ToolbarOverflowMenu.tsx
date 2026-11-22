import { useState, useRef, useEffect, useCallback } from 'react'
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
}: ToolbarOverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

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
    triggerRef.current?.focus()
  }, [])

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

  // Focus first item on open
  useEffect(() => {
    if (isOpen && menuRef.current) {
      const firstBtn = menuRef.current.querySelector<HTMLButtonElement>(
        'button[role="menuitem"]:not([disabled])'
      )
      if (firstBtn) {
        firstBtn.focus()
      } else {
        const anyBtn = menuRef.current.querySelector<HTMLButtonElement>(
          'button[role="menuitem"]'
        )
        anyBtn?.focus()
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
      menuItems[nextIndex].focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : menuItems.length - 1
      menuItems[prevIndex].focus()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
    }
  }

  if (items.length === 0) {
    return null
  }

  return (
    <div className="toolbar-overflow-container">
      <button
        ref={triggerRef}
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

      {isOpen && (
        <div
          ref={menuRef}
          className="toolbar-overflow-menu"
          role="menu"
          aria-label="Thêm thao tác"
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
      )}
    </div>
  )
}
