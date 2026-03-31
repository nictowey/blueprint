export default function Header() {
  return (
    <header className="border-b border-dark-border bg-dark-card/50 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="white" opacity="0.9"/>
              <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="8" y="8" width="5" height="5" rx="1" fill="white" opacity="0.3"/>
            </svg>
          </div>
          <span className="text-xl font-bold text-slate-100 tracking-tight">Blueprint</span>
        </div>
        <span className="text-slate-500 text-sm hidden sm:block">
          Find tomorrow's breakouts by matching yesterday's winners
        </span>
      </div>
    </header>
  );
}
