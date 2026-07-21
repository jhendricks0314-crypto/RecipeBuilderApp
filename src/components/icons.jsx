// Minimal line icons (stroke = currentColor) for nav + brand.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const IconGenerate = () => (
  <svg viewBox="0 0 24 24" {...S}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3.2"/></svg>
)
export const IconCart = () => (
  <svg viewBox="0 0 24 24" {...S}><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2l2.2 12.2a1.5 1.5 0 0 0 1.5 1.3h8.8a1.5 1.5 0 0 0 1.5-1.2L21.5 7H6"/></svg>
)
export const IconList = () => (
  <svg viewBox="0 0 24 24" {...S}><path d="M8 6h12M8 12h12M8 18h12"/><path d="M3.5 6l1 1 1.5-2M3.5 12l1 1 1.5-2M3.5 18l1 1 1.5-2"/></svg>
)
export const IconBook = () => (
  <svg viewBox="0 0 24 24" {...S}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z"/></svg>
)
export const IconScan = () => (
  <svg viewBox="0 0 24 24" {...S}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M8 12h8M12 9v6"/></svg>
)
export const IconPantry = () => (
  <svg viewBox="0 0 24 24" {...S}><path d="M8 2h8a1 1 0 0 1 1 1v1.5a2.5 2.5 0 0 1-1 2V21a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V7.5a2.5 2.5 0 0 1-1-2V3a1 1 0 0 1 1-1z"/><path d="M11 11h2"/></svg>
)
export const IconBarcode = () => (
  <svg viewBox="0 0 24 24" {...S}><path d="M3 5v14M7 5v14M11 5v14M14 5v10M14 17v2M17 5v14M21 5v14"/></svg>
)
export const IconCamera = () => (
  <svg viewBox="0 0 24 24" {...S}><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6h0a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.2"/></svg>
)
export const IconFork = () => (
  <svg viewBox="0 0 24 24" {...S}><path d="M7 3v6a2.5 2.5 0 0 0 5 0V3M9.5 3v18M17 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4 2.5-1 2.5-4-1-5-2.5-5zM17 12v9"/></svg>
)
export const IconGoogle = () => (
  <svg viewBox="0 0 24 24" width="20" height="20"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.4-.2-2H12v3.9h5.9c-.1 1-.8 2.5-2.3 3.5l3.6 2.8c2.1-2 3.3-4.9 3.3-8.2z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .6-2.3 1.1-3.7 1.1-2.8 0-5.2-1.9-6.1-4.5l-3.7 2.9C4 19.9 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.9 14.1c-.2-.6-.4-1.3-.4-2.1s.1-1.5.4-2.1L2.2 7C1.4 8.5 1 10.2 1 12s.4 3.5 1.2 5z"/><path fill="#EA4335" d="M12 4.9c1.6 0 2.7.7 3.3 1.3l2.5-2.4C16.5 2.3 14 1 12 1 7.7 1 4 4.1 2.2 7l3.7 2.9C6.8 6.8 9.2 4.9 12 4.9z"/></svg>
)
export const IconClose = () => (
  <svg viewBox="0 0 24 24" {...S} width="20" height="20"><path d="M6 6l12 12M18 6L6 18"/></svg>
)
