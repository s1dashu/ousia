export type ToolPreviewTextRow = {
  key: string
  text: string
}

export type ToolPreviewTextReveal = ToolPreviewTextRow & {
  startOffset: number
}

/**
 * Finds the text suffixes introduced by the latest streamed preview snapshot.
 * Pierre rebuilds its line DOM when a file changes, so the renderer cannot use
 * node identity to distinguish new text from code that was already visible.
 */
export function streamedToolPreviewReveals(
  previousRows: ToolPreviewTextRow[],
  currentRows: ToolPreviewTextRow[],
  maximumRevealRows: number,
): ToolPreviewTextReveal[] {
  if (maximumRevealRows <= 0) {
    return []
  }

  const previousTextByKey = new Map(
    previousRows.map((row) => [row.key, row.text]),
  )
  const reveals: ToolPreviewTextReveal[] = []

  for (const row of currentRows) {
    const previousText = previousTextByKey.get(row.key)
    if (previousText === row.text) {
      continue
    }

    const startOffset =
      previousText !== undefined && row.text.startsWith(previousText)
        ? previousText.length
        : 0
    if (startOffset >= row.text.length) {
      continue
    }
    reveals.push({ ...row, startOffset })
  }

  return reveals.slice(-maximumRevealRows)
}
