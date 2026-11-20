import { useEffect, useRef } from 'react'

export interface ZoomMenuProps {
  isOpen: boolean
  onClose: () => void
  currentZoom: number
  onSelectZoom: (zoom: number) => void
  onFitWidth: () => void
  onFitPage: () => void
}

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

export function ZoomMenu({
  isOpen,
  onClose,
  currentZoom,
  onSelectZoom,
  onFitWidth,
  onFitPage,
}: ZoomMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const menu = menuRef.current
        if (!menu) return
        const items = Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        if (items.length === 0) return

        const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement)
        const nextIndex =
          e.key === 'ArrowDown'
            ? activeIndex < items.length - 1
              ? activeIndex + 1
              : 0
            : activeIndex > 0
              ? activeIndex - 1
              : items.length - 1
        items[nextIndex]?.focus()
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handleClickOutside)

    // Auto-focus first item or current item
    const timer = setTimeout(() => {
      const activeBtn = menuRef.current?.querySelector<HTMLButtonElement>('.zoom-menu-item.active')
      const firstBtn = menuRef.current?.querySelector<HTMLButtonElement>('.zoom-menu-item')
      ;(activeBtn || firstBtn)?.focus()
    }, 10)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      ref={menuRef}
      className="zoom-menu"
      role="menu"
      aria-label="Tùy chọn thu phóng"
    >
      <button
        type="button"
        role="menuitem"
        className="zoom-menu-item"
        onClick={() => {
          onFitWidth()
          onClose()
        }}
      >
        <span>Vừa chiều rộng</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="zoom-menu-item"
        onClick={() => {
          onFitPage()
          onClose()
        }}
      >
        <span>Vừa trang</span>
      </button>
      <div className="zoom-menu-divider" role="separator" />
      {ZOOM_PRESETS.map((preset) => {
        const percent = Math.round(preset * 100)
        const isSelected = Math.abs(currentZoom - preset) < 0.01
        return (
          <button
            key={preset}
            type="button"
            role="menuitem"
            className={`zoom-menu-item ${isSelected ? 'active' : ''}`}
            onClick={() => {
              onSelectZoom(preset)
              onClose()
            }}
          >
            <span>{percent}%</span>
            {isSelected && <span>✓</span>}
          </button>
        )
      })}
    </div>
  )
}
