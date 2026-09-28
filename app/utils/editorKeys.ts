export type EditorKeyAction = 'confirm' | 'close'

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

// Enter/Escape are window-wide shortcuts for the crop editor; they must not
// steal keystrokes from the custom-params inputs sitting above it.
export function editorKeyAction(e: { key: string, repeat: boolean, target: { tagName?: string } | null }): EditorKeyAction | null {
  if (e.repeat) return null
  if (e.target?.tagName && FIELD_TAGS.has(e.target.tagName.toUpperCase())) return null
  if (e.key === 'Enter') return 'confirm'
  if (e.key === 'Escape') return 'close'
  return null
}
