import SearchBar from './SearchBar'

// TopBar — functional search on the left; the light/dark toggle + notifications
// bell sit at the top-right.
export default function TopBar({ theme, onToggleTheme, onSearchNavigate = () => {} }) {
  const isDark = theme === 'dark'
  return (
    <div className="topbar">
      <SearchBar onNavigate={onSearchNavigate} />
      <div className="right">
        <button
          type="button"
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? (
            // sun — click to go light
            <svg viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
            </svg>
          ) : (
            // moon — click to go dark
            <svg viewBox="0 0 24 24">
              <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
            </svg>
          )}
        </button>
        {/* notifications bell (static) */}
        <button type="button" className="theme-toggle" aria-label="Notifications" title="Notifications">
          <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
        </button>
      </div>
    </div>
  )
}
