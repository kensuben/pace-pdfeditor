import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'

export type OverflowGroupId = 'signOcr' | 'boundingBox' | 'page' | 'insert'

export type ToolbarLevel = 0 | 1 | 2 | 3 | 4 | 5
export type ToolbarLevelName = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5'
export type ToolbarLevelInput = ToolbarLevel | ToolbarLevelName

export interface ToolbarLayoutResult {
  mode: 'full' | 'compact'
  hiddenGroups: OverflowGroupId[]
  level: ToolbarLevel
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

export const TOOLBAR_LEVEL_MAP: Record<
  ToolbarLevel,
  { mode: 'full' | 'compact'; hiddenGroups: OverflowGroupId[] }
> = {
  0: { mode: 'full', hiddenGroups: [] },
  1: { mode: 'compact', hiddenGroups: [] },
  2: { mode: 'compact', hiddenGroups: ['signOcr'] },
  3: { mode: 'compact', hiddenGroups: ['signOcr', 'boundingBox'] },
  4: { mode: 'compact', hiddenGroups: ['signOcr', 'boundingBox', 'page'] },
  5: { mode: 'compact', hiddenGroups: ['signOcr', 'boundingBox', 'page', 'insert'] },
}

export function parseToolbarLevel(lvl: ToolbarLevelInput): ToolbarLevel {
  if (typeof lvl === 'string') {
    const num = parseInt(lvl.replace(/^L/i, ''), 10)
    return (isNaN(num) ? 0 : Math.min(Math.max(num, 0), 5)) as ToolbarLevel
  }
  return Math.min(Math.max(lvl, 0), 5) as ToolbarLevel
}

export function nextToolbarLevel<T extends ToolbarLevelInput>(
  level: T,
  overflowing: boolean
): T {
  if (!overflowing) {
    return level
  }

  if (typeof level === 'string') {
    switch (level) {
      case 'L0':
        return 'L1' as T
      case 'L1':
        return 'L2' as T
      case 'L2':
        return 'L3' as T
      case 'L3':
        return 'L4' as T
      case 'L4':
        return 'L5' as T
      case 'L5':
        return 'L5' as T
      default:
        return 'L1' as T
    }
  }

  const num = Number(level)
  if (num < 5) {
    return (num + 1) as T
  }
  return 5 as T
}

export function getToolbarLevelConfig(
  level: ToolbarLevelInput,
  opts?: ComputeToolbarLayoutOptions
): { mode: 'full' | 'compact'; hiddenGroups: OverflowGroupId[] } {
  const num = parseToolbarLevel(level)
  const base = TOOLBAR_LEVEL_MAP[num] || TOOLBAR_LEVEL_MAP[0]
  const hasBoundingBox = opts?.includeBoundingBox ?? (opts?.isDesktop ?? true)

  const hiddenGroups = hasBoundingBox
    ? base.hiddenGroups
    : base.hiddenGroups.filter((g) => g !== 'boundingBox')

  return {
    mode: base.mode,
    hiddenGroups,
  }
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

  const fixedWidth = w.tools + w.colors + w.divider + w.edit + w.paddingAndGaps

  const fullWidth =
    fixedWidth + w.insertFull + w.page + w.signOcrFull + bbWidth

  if (availableWidth >= fullWidth) {
    return {
      mode: 'full',
      hiddenGroups: [],
      level: 0,
    }
  }

  const compactWidth =
    fixedWidth + w.insertCompact + w.page + w.signOcrCompact + bbWidth

  if (availableWidth >= compactWidth) {
    return {
      mode: 'compact',
      hiddenGroups: [],
      level: 1,
    }
  }

  const wHideSignOcr =
    fixedWidth + w.insertCompact + w.page + bbWidth + w.overflowBtn
  if (availableWidth >= wHideSignOcr) {
    return {
      mode: 'compact',
      hiddenGroups: ['signOcr'],
      level: 2,
    }
  }

  const wHideBB = fixedWidth + w.insertCompact + w.page + w.overflowBtn
  const groupsAfterBB: OverflowGroupId[] = hasBoundingBox
    ? ['signOcr', 'boundingBox']
    : ['signOcr']
  if (availableWidth >= wHideBB) {
    return {
      mode: 'compact',
      hiddenGroups: groupsAfterBB,
      level: 3,
    }
  }

  const wHidePage = fixedWidth + w.insertCompact + w.overflowBtn
  const groupsAfterPage: OverflowGroupId[] = hasBoundingBox
    ? ['signOcr', 'boundingBox', 'page']
    : ['signOcr', 'page']
  if (availableWidth >= wHidePage) {
    return {
      mode: 'compact',
      hiddenGroups: groupsAfterPage,
      level: 4,
    }
  }

  const allHidden: OverflowGroupId[] = hasBoundingBox
    ? ['signOcr', 'boundingBox', 'page', 'insert']
    : ['signOcr', 'page', 'insert']
  return {
    mode: 'compact',
    hiddenGroups: allHidden,
    level: 5,
  }
}

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function useToolbarLayout(
  target?: React.RefObject<HTMLElement | null> | HTMLElement | null,
  opts?: ComputeToolbarLayoutOptions
): ToolbarLayoutResult & {
  toolbarRef: (node: HTMLElement | null) => void
} {
  const [callbackNode, setCallbackNode] = useState<HTMLElement | null>(null)
  const el =
    callbackNode ||
    (target && 'current' in target ? target.current : (target as HTMLElement | null)) ||
    null

  const [level, setLevel] = useState<ToolbarLevel>(0)
  const prevWidthRef = useRef<number>(0)

  const isDesktop = opts?.isDesktop
  const includeBoundingBox = opts?.includeBoundingBox

  const toolbarRefCallback = useCallback((node: HTMLElement | null) => {
    setCallbackNode(node)
  }, [])

  // Check overflow via real measurement (scrollWidth > clientWidth + 1)
  // useLayoutEffect runs before paint to avoid visual jump
  useIsomorphicLayoutEffect(() => {
    if (!el) return

    const isOverflowing = el.scrollWidth > el.clientWidth + 1

    if (isOverflowing && level < 5) {
      setLevel((curr) => nextToolbarLevel(curr, true))
    }
  }, [el, level, isDesktop, includeBoundingBox])

  // Attach ResizeObserver when .toolbar actually mounts; disconnect on unmount
  useEffect(() => {
    if (!el) return

    prevWidthRef.current = el.clientWidth

    const handleResize = (newWidth: number) => {
      if (newWidth > prevWidthRef.current + 2) {
        prevWidthRef.current = newWidth
        // Container became wider: retry from L0 to show more buttons if possible
        setLevel(0)
      } else if (newWidth < prevWidthRef.current - 2) {
        prevWidthRef.current = newWidth
        // Container became narrower: step up if overflowing
        if (el.scrollWidth > el.clientWidth + 1 && level < 5) {
          setLevel((curr) => nextToolbarLevel(curr, true))
        }
      }
    }

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width || el.clientWidth
          handleResize(w)
        }
      })
      ro.observe(el)
      return () => ro.disconnect()
    } else {
      const onResize = () => handleResize(el.clientWidth)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }
  }, [el, level])

  const config = getToolbarLevelConfig(level, { isDesktop, includeBoundingBox })

  return {
    mode: config.mode,
    hiddenGroups: config.hiddenGroups,
    level,
    toolbarRef: toolbarRefCallback,
  }
}
