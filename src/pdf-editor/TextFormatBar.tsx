import { Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight } from 'lucide-react'
import type { TextStyle } from '../types'
import { IconButton } from './IconButton'

export function TextFormatBar({
  style,
  onChange,
}: {
  style: TextStyle
  onChange: (patch: Partial<TextStyle>) => void
}) {
  return (
    <div className="text-format-bar" aria-label="Định dạng văn bản">
      <select
        aria-label="Font chữ"
        value={style.fontFamily}
        onChange={(e) => onChange({ fontFamily: e.target.value as TextStyle['fontFamily'] })}
      >
        <option>Be Vietnam Pro</option>
        <option>Arimo</option>
        <option>Helvetica</option>
        <option>Times Roman</option>
        <option>Courier</option>
      </select>
      <select
        className="font-size"
        aria-label="Cỡ chữ"
        value={style.fontSize}
        onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
      >
        {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <span className="format-divider" />
      <IconButton label="Đậm" active={style.bold} onClick={() => onChange({ bold: !style.bold })}>
        <Bold />
      </IconButton>
      <IconButton label="Nghiêng" active={style.italic} onClick={() => onChange({ italic: !style.italic })}>
        <Italic />
      </IconButton>
      <IconButton label="Gạch chân" active={style.underline} onClick={() => onChange({ underline: !style.underline })}>
        <Underline />
      </IconButton>
      <span className="format-divider" />
      <IconButton label="Căn trái" active={style.align === 'left'} onClick={() => onChange({ align: 'left' })}>
        <AlignLeft />
      </IconButton>
      <IconButton label="Căn giữa" active={style.align === 'center'} onClick={() => onChange({ align: 'center' })}>
        <AlignCenter />
      </IconButton>
      <IconButton label="Căn phải" active={style.align === 'right'} onClick={() => onChange({ align: 'right' })}>
        <AlignRight />
      </IconButton>
      <label className="text-color" title="Màu chữ">
        <input type="color" value={style.color} onChange={(e) => onChange({ color: e.target.value })} />
        <span style={{ '--text-color': style.color } as React.CSSProperties}>A</span>
      </label>
    </div>
  )
}
