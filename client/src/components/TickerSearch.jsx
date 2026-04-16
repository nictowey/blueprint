import { useState, useEffect, useRef } from 'react';

export default function TickerSearch({ value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const wrapperRef = useRef(null);
  const listRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Cancel in-flight requests on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      clearTimeout(debounceRef.current);
    };
  }, []);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const item = listRef.current.children[activeIndex];
      if (item) item.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  function handleChange(e) {
    const val = e.target.value.toUpperCase();
    onChange(val);
    setActiveIndex(-1);

    clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    if (val.length < 1) { setSuggestions([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setOpen(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`, { signal: controller.signal });
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
      } catch (err) {
        if (err.name !== 'AbortError') setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
  }

  function handleSelect(item) {
    onChange(item.symbol);
    onSelect(item.symbol);
    setOpen(false);
    setActiveIndex(-1);
    setSuggestions([]);
  }

  function handleKeyDown(e) {
    if (!open) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && suggestions[activeIndex]) {
          handleSelect(suggestions[activeIndex]);
        }
        break;
      case 'Escape':
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  }

  const showDropdown = open && (loading || suggestions.length > 0 || (value?.length >= 2 && !loading));
  const activeId = activeIndex >= 0 ? `ticker-option-${activeIndex}` : undefined;

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          className="input-field pr-10 uppercase tracking-widest font-mono min-h-[44px]"
          placeholder="NVDA"
          value={value || ''}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls="ticker-listbox"
          aria-activedescendant={activeId}
          inputMode="search"
          autoComplete="off"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-brand/40 border-t-brand rounded-full animate-spin" />
          </div>
        )}
      </div>

      {showDropdown && (
        <div
          id="ticker-listbox"
          role="listbox"
          ref={listRef}
          className="absolute z-30 w-full mt-1.5 bg-surface shadow-dropdown rounded-card overflow-hidden backdrop-blur-sm max-h-[60vh] overflow-y-auto"
        >
          {loading && suggestions.length === 0 ? (
            /* Skeleton loading state */
            <div className="p-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-12 h-4 bg-surface rounded animate-shimmer" />
                  <div className="flex-1 h-4 bg-surface rounded animate-shimmer" style={{ animationDelay: `${i * 0.15}s` }} />
                  <div className="w-10 h-3 bg-surface rounded animate-shimmer" style={{ animationDelay: `${i * 0.1}s` }} />
                </div>
              ))}
            </div>
          ) : suggestions.length === 0 && value?.length >= 2 && !loading ? (
            /* Empty state */
            <div className="px-4 py-5 text-center">
              <p className="text-sm text-text-muted">No results for <span className="font-mono text-text-secondary">{value}</span></p>
            </div>
          ) : (
            /* Results */
            suggestions.map((item, i) => (
              <button
                key={item.symbol}
                id={`ticker-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors duration-100 ${
                  i === activeIndex ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                }`}
                onMouseDown={() => handleSelect(item)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="font-mono font-bold text-text-primary text-sm w-14 shrink-0">{item.symbol}</span>
                <span className="text-sm text-text-secondary truncate flex-1">{item.name}</span>
                <span className="text-label shrink-0">{item.exchangeShortName}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
