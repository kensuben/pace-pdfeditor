import { useState } from 'react'
import type { Annotation, TextStyle, Tool } from '../types'
import { getBounds, applyPanelDimensions } from './selection/geometry'
import { TextFormatBar } from './TextFormatBar'
import './panel.css'

export interface PropertiesPanelProps {
  selectedAnnotation: Annotation | null
  pageSizePt: { width: number; height: number }
  tool: Tool
  textStyle: TextStyle
  onTextStyleChange: (patch: Partial<TextStyle>) => void
  onUpdateAnnotation: (updated: Annotation, kind: 'move' | 'resize' | 'update') => void
  aspectLocked: boolean
  onToggleAspectLock: (locked: boolean) => void
}

export function PropertiesPanel({
  selectedAnnotation,
  pageSizePt,
  tool,
  textStyle,
  onTextStyleChange,
  onUpdateAnnotation,
  aspectLocked,
  onToggleAspectLock,
}: PropertiesPanelProps) {
  const bounds = selectedAnnotation ? getBounds(selectedAnnotation) : null
  const pageW = pageSizePt.width || 1
  const pageH = pageSizePt.height || 1

  const currentXPt = bounds ? Math.round(bounds.x * pageW * 10) / 10 : 0
  const currentYPt = bounds ? Math.round(bounds.y * pageH * 10) / 10 : 0
  const currentWPt = bounds ? Math.round(bounds.width * pageW * 10) / 10 : 0
  const currentHPt = bounds ? Math.round(bounds.height * pageH * 10) / 10 : 0

  const [prevId, setPrevId] = useState(selectedAnnotation?.id)
  const [inputX, setInputX] = useState(String(currentXPt))
  const [inputY, setInputY] = useState(String(currentYPt))
  const [inputW, setInputW] = useState(String(currentWPt))
  const [inputH, setInputH] = useState(String(currentHPt))

  // Synchronize local input state during render when selected annotation changes
  if (selectedAnnotation?.id !== prevId) {
    setPrevId(selectedAnnotation?.id)
    setInputX(String(currentXPt))
    setInputY(String(currentYPt))
    setInputW(String(currentWPt))
    setInputH(String(currentHPt))
  }

  const commitPosition = (dim: 'x' | 'y') => {
    if (!selectedAnnotation || selectedAnnotation.replaceOriginal) return
    const numX = Number(inputX)
    const numY = Number(inputY)

    if (dim === 'x' && !isNaN(numX) && Math.abs(numX - currentXPt) > 0.05) {
      const updated = applyPanelDimensions(selectedAnnotation, { xPt: numX }, pageSizePt)
      onUpdateAnnotation(updated, 'move')
    } else if (dim === 'y' && !isNaN(numY) && Math.abs(numY - currentYPt) > 0.05) {
      const updated = applyPanelDimensions(selectedAnnotation, { yPt: numY }, pageSizePt)
      onUpdateAnnotation(updated, 'move')
    } else {
      setInputX(String(currentXPt))
      setInputY(String(currentYPt))
    }
  }

  const commitSize = (dim: 'w' | 'h') => {
    if (!selectedAnnotation || selectedAnnotation.replaceOriginal) return
    const numW = Number(inputW)
    const numH = Number(inputH)

    if (dim === 'w' && !isNaN(numW) && Math.abs(numW - currentWPt) > 0.05) {
      const updated = applyPanelDimensions(
        selectedAnnotation,
        { widthPt: Math.max(2, numW), keepAspect: aspectLocked },
        pageSizePt,
      )
      onUpdateAnnotation(updated, 'resize')
    } else if (dim === 'h' && !isNaN(numH) && Math.abs(numH - currentHPt) > 0.05) {
      const updated = applyPanelDimensions(
        selectedAnnotation,
        { heightPt: Math.max(2, numH), keepAspect: aspectLocked },
        pageSizePt,
      )
      onUpdateAnnotation(updated, 'resize')
    } else {
      setInputW(String(currentWPt))
      setInputH(String(currentHPt))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  const currentOpacityPct = selectedAnnotation
    ? Math.round((selectedAnnotation.opacity ?? 1) * 100)
    : 100

  return (
    <aside className="properties-panel" aria-label="Bảng thuộc tính">
      <div className="properties-header">
        <h3>Thuộc tính</h3>
      </div>

      {!selectedAnnotation ? (
        tool === 'text' ? (
          <div className="properties-section">
            <div className="properties-section-title">Định dạng chữ mặc định</div>
            <TextFormatBar style={textStyle} onChange={onTextStyleChange} />
          </div>
        ) : (
          <div className="properties-empty">Chọn một đối tượng để chỉnh</div>
        )
      ) : selectedAnnotation.replaceOriginal ? (
        <div className="properties-section">
          <div className="properties-section-title">Chữ thay thế chữ gốc</div>
          <div className="properties-notice">Chữ thay thế chữ gốc chưa di chuyển được</div>
          <div className="properties-readonly-info">
            <div className="properties-readonly-row">
              <span>Vị trí X:</span>
              <span>{currentXPt} pt</span>
            </div>
            <div className="properties-readonly-row">
              <span>Vị trí Y:</span>
              <span>{currentYPt} pt</span>
            </div>
            <div className="properties-readonly-row">
              <span>Chiều rộng:</span>
              <span>{currentWPt} pt</span>
            </div>
            <div className="properties-readonly-row">
              <span>Chiều cao:</span>
              <span>{currentHPt} pt</span>
            </div>
            {selectedAnnotation.text && (
              <div className="properties-readonly-row">
                <span>Nội dung:</span>
                <span>{selectedAnnotation.text}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="properties-section">
            <div className="properties-section-title">Vị trí &amp; Kích thước</div>
            <div className="properties-grid-2x2">
              <div className="properties-field">
                <label htmlFor="prop-x">X</label>
                <div>
                  <input
                    id="prop-x"
                    type="number"
                    step="0.5"
                    value={inputX}
                    onChange={(e) => setInputX(e.target.value)}
                    onBlur={() => commitPosition('x')}
                    onKeyDown={handleKeyDown}
                  />
                  <span className="unit">pt</span>
                </div>
              </div>
              <div className="properties-field">
                <label htmlFor="prop-y">Y</label>
                <div>
                  <input
                    id="prop-y"
                    type="number"
                    step="0.5"
                    value={inputY}
                    onChange={(e) => setInputY(e.target.value)}
                    onBlur={() => commitPosition('y')}
                    onKeyDown={handleKeyDown}
                  />
                  <span className="unit">pt</span>
                </div>
              </div>
              <div className="properties-field">
                <label htmlFor="prop-w">Rộng</label>
                <div>
                  <input
                    id="prop-w"
                    type="number"
                    step="0.5"
                    value={inputW}
                    onChange={(e) => setInputW(e.target.value)}
                    onBlur={() => commitSize('w')}
                    onKeyDown={handleKeyDown}
                  />
                  <span className="unit">pt</span>
                </div>
              </div>
              <div className="properties-field">
                <label htmlFor="prop-h">Cao</label>
                <div>
                  <input
                    id="prop-h"
                    type="number"
                    step="0.5"
                    value={inputH}
                    onChange={(e) => setInputH(e.target.value)}
                    onBlur={() => commitSize('h')}
                    onKeyDown={handleKeyDown}
                  />
                  <span className="unit">pt</span>
                </div>
              </div>
            </div>

            <label className="properties-checkbox-row">
              <input
                type="checkbox"
                checked={aspectLocked}
                onChange={(e) => onToggleAspectLock(e.target.checked)}
              />
              <span>Khoá tỉ lệ</span>
            </label>
          </div>

          {(selectedAnnotation.type === 'highlight' ||
            selectedAnnotation.type === 'image' ||
            selectedAnnotation.type === 'text') && (
            <div className="properties-section">
              <div className="properties-section-title">Độ mờ</div>
              <div className="properties-slider-row">
                <label htmlFor="prop-opacity">Mức</label>
                <input
                  id="prop-opacity"
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={currentOpacityPct}
                  onChange={(e) => {
                    const pct = Number(e.target.value)
                    const updated = applyPanelDimensions(
                      selectedAnnotation,
                      { opacity: pct / 100 },
                      pageSizePt,
                    )
                    onUpdateAnnotation(updated, 'update')
                  }}
                />
                <span>{currentOpacityPct}%</span>
              </div>
            </div>
          )}

          {selectedAnnotation.type === 'text' && (
            <div className="properties-section">
              <div className="properties-section-title">Định dạng chữ</div>
              <TextFormatBar
                style={{
                  fontFamily: selectedAnnotation.fontFamily || textStyle.fontFamily || 'Helvetica',
                  fontSize: selectedAnnotation.fontSize || textStyle.fontSize || 16,
                  bold: selectedAnnotation.bold,
                  italic: selectedAnnotation.italic,
                  underline: selectedAnnotation.underline,
                  align: selectedAnnotation.align || textStyle.align || 'left',
                  color: selectedAnnotation.color || textStyle.color || '#000',
                }}
                onChange={(patch) => {
                  const updated: Annotation = {
                    ...selectedAnnotation,
                    ...patch,
                  }
                  onUpdateAnnotation(updated, 'update')
                  onTextStyleChange(patch)
                }}
              />
            </div>
          )}
        </>
      )}
    </aside>
  )
}
