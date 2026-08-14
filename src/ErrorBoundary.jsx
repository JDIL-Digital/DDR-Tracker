import { Component } from 'react'

// Friendly fallback shown when a subtree throws during render/lifecycle.
// level="app"   -> full-screen (top-level catch-all)
// level="panel" -> compact inline card (per-view / per-panel)
function Fallback({ level, onReset }) {
  const isApp = level === 'app'
  return (
    <div className={`error-boundary ${isApp ? 'eb-app' : 'eb-panel'}`} role="alert">
      <div className="eb-badge">!</div>
      <div className="eb-title">Something went wrong{isApp ? '' : ' here'}</div>
      <div className="eb-msg">
        {isApp
          ? 'The app hit an unexpected error. Your data is safe — reload to continue.'
          : 'This section failed to render. The rest of the app still works.'}
      </div>
      <div className="eb-actions">
        <button type="button" className="btn" onClick={onReset}>Try again</button>
        <button type="button" className="btn ghost" onClick={() => window.location.reload()}>Reload page</button>
      </div>
    </div>
  )
}

// Class component — error boundaries must be class-based (no hooks equivalent).
// A `resetKey` prop lets a parent auto-clear the error when it changes (e.g. the
// active view), so navigating away from a broken screen recovers automatically.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Log for diagnosis; never rethrow (that would white-screen).
    console.error('[ErrorBoundary]', error, info?.componentStack)
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) return <Fallback level={this.props.level || 'panel'} onReset={this.reset} />
    return this.props.children
  }
}
