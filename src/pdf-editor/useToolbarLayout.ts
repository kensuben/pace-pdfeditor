import { useState, useEffect } from 'react'

export type OverflowGroupId = 'signOcr' | 'boundingBox' | 'page' | 'insert'

export interface ToolbarLayoutResult {
  mode: 'full' | 'compact'
  hiddenGroups: OverflowGroupId[]
}

export interface ToolbarItemWidths {
  tools?: number
  colors?: number
  divider?: number
  edit?: number
  insertFull?: number
  insertCompact?: number
  page?: number
  signOcrFull?: number
  signOcrCompact?: number
  boundingBox?: number
  overflowBtn?: number
  paddingAndGaps?: number
}

export interface ComputeToolbarLayoutOptions {
  includeBoundingBox?: boolean
  isDesktop?: boolean
}

export const DEFAULT_TOOLBAR_WIDTHS: Required<ToolbarItemWidths> = {
  tools: 320,
  colors: 120,
  divider: 19,
  edit: 108,
  insertFull: 200,
  insertCompact: 70,
  page: 146,
  signOcrFull: 180,
  signOcrCompact: 70,
  boundingBox: 38,
  overflowBtn: 38,
  paddingAndGaps: 40,
}

export function computeToolbarLayout(
  itemWidths: ToolbarItemWidths = {},
  availableWidth: number,
  opts?: ComputeToolbarLayoutOptions
): ToolbarLayoutResult {
  const w: Required<ToolbarItemWidths> = {
    ...DEFAULT_TOOLBAR_WIDTHS,
    ...itemWidths,
  }

  const hasBoundingBox = opts?.includeBoundingBox ?? (opts?.isDesktop ?? true)
  const bbWidth = hasBoundingBox ? w.boundingBox : 0

  // Base fixed items that are NEVER hidden: tools, colors, divider, edit (delete, undo, redo)
  const fixedWidth = w.tools + w.colors + w.divider + w.edit + w.paddingAndGaps

  // 1. Check Full mode: all items visible with full text labels
  const fullWidth =
    fixedWidth + w.insertFull + w.page + w.signOcrFull + bbWidth

  if (availableWidth >= fullWidth) {
    return {
      mode: 'full',
      hiddenGroups: [],
    }
  }

  // 2. Check Compact mode (no overflow): all items visible with icon-only buttons
  const compactWidth =
    fixedWidth + w.insertCompact + w.page + w.signOcrCompact + bbWidth

  if (availableWidth >= compactWidth) {
    return {
      mode: 'compact',
      hiddenGroups: [],
    }
  }

  // 3. Overflow menu: mode is 'compact', groups hide progressively into overflow menu (⋯ button)
  // Order of hiding: signOcr -> boundingBox -> page -> insert

  // Step 3a: Hide signOcr
  const wHideSignOcr =
    fixedWidth + w.insertCompact + w.page + bbWidth + w.overflowBtn
  if (availableWidth >= wHideSignOcr) {
    return {
      mode: 'compact',
      hiddenGroups: ['signOcr'],
    }
  }

  // Step 3b: Hide boundingBox (if present)
  const wHideBB = fixedWidth + w.insertCompact + w.page + w.overflowBtn
  const groupsAfterBB: OverflowGroupId[] = hasBoundingBox
    ? ['signOcr', 'boundingBox']
    : ['signOcr']
  if (availableWidth >= wHideBB) {
    return {
      mode: 'compact',
      hiddenGroups: groupsAfterBB,
    }
  }

  // Step 3c: Hide page ops
  const wHidePage = fixedWidth + w.insertCompact + w.overflowBtn
  const groupsAfterPage: OverflowGroupId[] = hasBoundingBox
    ? ['signOcr', 'boundingBox', 'page']
    : ['signOcr', 'page']
  if (availableWidth >= wHidePage) {
    return {
      mode: 'compact',
      hiddenGroups: groupsAfterPage,
    }
  }

  // Step 3d: Hide insert group (all collapsible groups hidden)
  // Non-collapsible: tools, colors, edit (delete, undo, redo) are NEVER hidden
  const allHidden: OverflowGroupId[] = hasBoundingBox
    ? ['signOcr', 'boundingBox', 'page', 'insert']
    : ['signOcr', 'page', 'insert']
  return {
    mode: 'compact',
    hiddenGroups: allHidden,
  }
}

export function useToolbarLayout(
  toolbarRef: React.RefObject<HTMLElement | null>,
  opts?: ComputeToolbarLayoutOptions
): ToolbarLayoutResult {
  const includeBoundingBox = opts?.includeBoundingBox
  const isDesktop = opts?.isDesktop

  const [layout, setLayout] = useState<ToolbarLayoutResult>(() =>
    computeToolbarLayout(
      DEFAULT_TOOLBAR_WIDTHS,
      typeof window !== 'undefined' ? window.innerWidth : 1280,
      { includeBoundingBox, isDesktop }
    )
  )

  useEffect(() => {
    const el = toolbarRef.current
    if (!el) return

    const update = (width: number) => {
      if (width > 0) {
        setLayout(
          computeToolbarLayout(DEFAULT_TOOLBAR_WIDTHS, width, {
            includeBoundingBox,
            isDesktop,
          })
        )
      }
    }

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width || el.clientWidth
          update(w)
        }
      })
      ro.observe(el)
      return () => ro.disconnect()
    } else {
      const onResize = () => update(el.clientWidth || window.innerWidth)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
  }, [toolbarRef, includeBoundingBox, isDesktop])

  return layout
}
