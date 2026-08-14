// Shared loading + error states for data-fetch views, so every screen fails the
// same way: a clear message and a working Retry — never a blank panel.

export function Loading({ label = 'Loading…' }) {
  return <div className="state">{label}</div>
}

export function LoadError({ message, onRetry }) {
  return (
    <div className="state err" role="alert">
      <span className="state-err-msg">Couldn't load data{message ? ` — ${message}` : ''}</span>
      {onRetry && (
        <button type="button" className="btn retry" onClick={onRetry}>Retry</button>
      )}
    </div>
  )
}
