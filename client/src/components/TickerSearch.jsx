import { useState, useEffect, useRef } from 'react';

export default function TickerSearch({ value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const wrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
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

  function handleChange(e) {
    const val = e.target.value.toUpperCase();
    onChange(val);

    clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    if (val.length < 1) { setSuggestions([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`, { signal: controller.signal });
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
        setOpen(true);
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
    setSuggestions([]);
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          className="input-field pr-10 uppercase tracking-widest font-mono"
          placeholder="NVDA"
          value={value || ''}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-dark-card border border-dark-border rounded-lg shadow-xl overflow-hidden backdrop-blur-sm">
          {suggestions.map(item => (
            <button
              key={item.symbol}
              className="w-full text-left px-4 py-2.5 hover:bg-dark-card-hover flex items-center justify-between gap-3 transition-colors duration-150"
              onMouseDown={() => handleSelect(item)}
            >
              <span className="font-mono font-semibold text-warm-white text-sm">{item.symbol}</span>
              <span className="text-warm-gray text-sm truncate font-light">{item.name}</span>
              <span className="text-warm-muted text-xs flex-shrink-0 font-mono">{item.exchangeShortName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
