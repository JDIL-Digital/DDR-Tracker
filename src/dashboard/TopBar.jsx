// TopBar — search (static) + icons + "DDR MISSION CONTROL". Matches the mockup.
export default function TopBar() {
  return (
    <div className="topbar">
      <div className="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        Search rigs, wells, or activity codes…
      </div>
      <div className="right">
        <svg className="ic" viewBox="0 0 24 24"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" /></svg>
        <svg className="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01" /></svg>
        <div className="mc">DDR <span>MISSION CONTROL</span></div>
      </div>
    </div>
  )
}
