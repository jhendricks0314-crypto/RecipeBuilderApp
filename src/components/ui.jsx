import { useEffect } from 'react'
import { recipeIconSVG } from '../lib/util.js'
import { IconClose } from './icons.jsx'

export function RecipeIcon({ recipe, className = 'recipe-icon' }) {
  // If the user uploaded photos, show the first; otherwise the generated icon.
  if (recipe?.photos?.length) {
    return (
      <div className={className}>
        <img src={recipe.photos[0]} alt={recipe.name} />
      </div>
    )
  }
  return <div className={className} dangerouslySetInnerHTML={{ __html: recipeIconSVG(recipe) }} />
}

export function Stars({ value = 0, onChange, readOnly }) {
  return (
    <span className="stars" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= value ? 'on' : ''}
          disabled={readOnly}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange && onChange(n === value ? 0 : n)}
        >
          ★
        </button>
      ))}
    </span>
  )
}

export function Spinner({ light }) {
  return <span className={`spinner${light ? ' light' : ''}`} aria-hidden="true" />
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="center-load">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}

export function Banner({ kind = 'info', children }) {
  if (!children) return null
  return <div className={`banner ${kind}`}>{children}</div>
}

export function Empty({ emoji = '🍽️', title, children }) {
  return (
    <div className="empty">
      <div className="emoji">{emoji}</div>
      <h3 style={{ margin: '10px 0 6px' }}>{title}</h3>
      <p className="muted" style={{ margin: 0 }}>{children}</p>
    </div>
  )
}

export function Toast({ message }) {
  if (!message) return null
  return <div className="toast" role="status">{message}</div>
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row-between" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 24 }}>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        {children}
        {footer && <div className="btn-row" style={{ marginTop: 18 }}>{footer}</div>}
      </div>
    </div>
  )
}
