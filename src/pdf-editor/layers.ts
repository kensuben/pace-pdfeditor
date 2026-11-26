import type { Annotation } from '../types'

export type LayerAction = 'front' | 'forward' | 'backward' | 'back'

/**
 * Reorders annotations on the same page based on LayerAction.
 * Returns the exact same array reference if the action has no effect.
 */
export function reorderAnnotations(
  annotations: Annotation[],
  id: string,
  action: LayerAction,
): Annotation[] {
  const target = annotations.find((a) => a.id === id)
  if (!target) return annotations

  const targetPage = target.page
  // Active (non-deleted) annotations on the same page in current order
  const pageActiveAnns = annotations.filter((a) => a.page === targetPage && !a.deleted)
  const idx = pageActiveAnns.findIndex((a) => a.id === id)
  if (idx === -1) return annotations

  const newPageActive = [...pageActiveAnns]
  let hasChanged = false

  switch (action) {
    case 'front': {
      let updatedTarget = target
      if (target.sourceImage && target.pageLayer !== 'top') {
        updatedTarget = { ...target, pageLayer: 'top' }
        hasChanged = true
      }
      if (idx !== pageActiveAnns.length - 1) {
        newPageActive.splice(idx, 1)
        newPageActive.push(updatedTarget)
        hasChanged = true
      } else if (hasChanged) {
        newPageActive[idx] = updatedTarget
      }
      break
    }
    case 'forward': {
      if (idx < pageActiveAnns.length - 1) {
        const next = newPageActive[idx + 1]
        newPageActive[idx] = next
        newPageActive[idx + 1] = target
        hasChanged = true
      }
      break
    }
    case 'backward': {
      if (idx > 0) {
        const prev = newPageActive[idx - 1]
        newPageActive[idx] = prev
        newPageActive[idx - 1] = target
        hasChanged = true
      }
      break
    }
    case 'back': {
      let updatedTarget = target
      if (target.sourceImage && target.pageLayer !== 'bottom') {
        updatedTarget = { ...target, pageLayer: 'bottom' }
        hasChanged = true
      }
      if (idx !== 0) {
        newPageActive.splice(idx, 1)
        newPageActive.unshift(updatedTarget)
        hasChanged = true
      } else if (hasChanged) {
        newPageActive[idx] = updatedTarget
      }
      break
    }
  }

  if (!hasChanged) {
    return annotations
  }

  // Place reordered pageActive items back into original page active slots
  let activeCursor = 0
  return annotations.map((a) => {
    if (a.page === targetPage && !a.deleted) {
      return newPageActive[activeCursor++]
    }
    return a
  })
}

export function canReorder(
  annotations: Annotation[],
  id: string,
  action: LayerAction,
): boolean {
  return reorderAnnotations(annotations, id, action) !== annotations
}
