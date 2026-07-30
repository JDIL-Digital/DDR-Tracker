// Sidebar — brand, nav, user. Static chrome (matches the mockup); nav is
// non-functional for this local-only step.
export default function Sidebar() {
  return (
    <aside className="side">
      <div className="brand">
        <div className="j">JINDAL</div>
        <div className="sub">DRILLING &amp; INDUSTRIES LTD.</div>
        <div className="app-name">DDR Tracker</div>
        <div className="app-tag">Offshore Ops</div>
      </div>
      <nav className="nav">
        <a className="on">
          <svg viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
          Fleet
        </a>
        <a>
          <svg viewBox="0 0 24 24"><path d="M3 3v18h18M18.7 8l-5.1 5.2-2.8-2.8L7 14.3" /></svg>
          Analytics
        </a>
        <a>
          <svg viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.6L19 8.4V19a2 2 0 01-2 2z" /></svg>
          Reports
        </a>
        <a>
          <svg viewBox="0 0 24 24"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10m-8-4V7" /></svg>
          Assets
        </a>
        <a>
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-2.82 1.17V21a2 2 0 11-4 0v-.09A1.65 1.65 0 007 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15H4.5a2 2 0 110-4h.09A1.65 1.65 0 006 8.6l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 0011 4.6V4.5a2 2 0 114 0v.09a1.65 1.65 0 001.17 2.82l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9H21a2 2 0 110 4h-.09z" /></svg>
          Settings
        </a>
      </nav>
      <div className="user">
        <div className="av">AM</div>
        <div>
          <div className="nm">Akshay M.</div>
          <div className="rl">Drilling Ops</div>
        </div>
      </div>
    </aside>
  )
}
