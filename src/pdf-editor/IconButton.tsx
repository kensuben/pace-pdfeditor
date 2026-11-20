import type { ReactNode } from 'react'

export function IconButton({
  label,
  children,
  onClick,
  disabled,
  active,
}: {
  label: string
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      className={`icon-button ${active ? 'active' : ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}
