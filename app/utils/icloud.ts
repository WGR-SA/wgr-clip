// iCloud Drive placeholders are tiny stubs named `.<original>.<ext>.icloud`
// that don't contain the file content; ffmpeg can't read them.
export function splitIcloudStubs(paths: string[]): { stubs: string[], paths: string[] } {
  const isStub = (p: string) => p.toLowerCase().endsWith('.icloud')
  return { stubs: paths.filter(isStub), paths: paths.filter(p => !isStub(p)) }
}

// .Elouan.wav.icloud → Elouan.wav
export function icloudDisplayName(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path
  return base.replace(/^\./, '').replace(/\.icloud$/i, '')
}

export function icloudToast(stubs: string[]) {
  return {
    title: 'Fichier iCloud non téléchargé',
    description: `${stubs.map(icloudDisplayName).join(', ')} : ouvrez-le dans Finder (clic droit → Télécharger maintenant) puis réessayez.`,
    color: 'warning' as const,
    duration: 7000
  }
}
