import { describe, expect, it } from 'vitest'
import { editorKeyAction } from './editorKeys'

describe('editorKeyAction', () => {
  it('maps Enter to confirm and Escape to close', () => {
    expect(editorKeyAction({ key: 'Enter', repeat: false, target: { tagName: 'BODY' } })).toBe('confirm')
    expect(editorKeyAction({ key: 'Escape', repeat: false, target: { tagName: 'DIV' } })).toBe('close')
    expect(editorKeyAction({ key: 'a', repeat: false, target: null })).toBeNull()
  })

  it('ignores keys typed inside form fields', () => {
    expect(editorKeyAction({ key: 'Enter', repeat: false, target: { tagName: 'INPUT' } })).toBeNull()
    expect(editorKeyAction({ key: 'Escape', repeat: false, target: { tagName: 'TEXTAREA' } })).toBeNull()
    expect(editorKeyAction({ key: 'Enter', repeat: false, target: { tagName: 'SELECT' } })).toBeNull()
  })

  it('ignores auto-repeat so a held Enter confirms one image only', () => {
    expect(editorKeyAction({ key: 'Enter', repeat: true, target: { tagName: 'BODY' } })).toBeNull()
  })
})
