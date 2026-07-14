export type ComposerScrollResize = {
  followLatest: boolean
  maxScrollTop: number
  previousScrollTop: number
}

export function isComposerSelectionAtLatest(
  valueLength: number,
  selectionStart: number,
  selectionEnd: number,
) {
  return selectionStart === valueLength && selectionEnd === valueLength
}

export function composerScrollTopAfterResize({
  followLatest,
  maxScrollTop,
  previousScrollTop,
}: ComposerScrollResize) {
  if (followLatest) {
    return maxScrollTop
  }
  return Math.min(previousScrollTop, maxScrollTop)
}
