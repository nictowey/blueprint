import { useState, useEffect, useRef } from 'react';

export default function TickerSearch({ value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
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

  function handleChange(e) {
    const val = e.target.value.toUpperCase();
    onChange(val);

    clearTimeout(debounceRef.current);
    if (val.length < 1) { setSuggestions([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
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
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-dark-card border border-dark-border rounded-lg shadow-xl overflow-hidden">
          {suggestions.map(item => (
            <button
              key={item.symbol}
              className="w-full text-left px-4 py-2.5 hover:bg-dark-border flex items-center justify-between gap-3 transition-colors"
              onMouseDown={() => handleSelect(item)}
            >
              <span className="font-mono font-semibold text-slate-100 text-sm">{item.symbol}</span>
              <span className="text-slate-400 text-sm truncate">{item.name}</span>
              <span className="text-slate-600 text-xs flex-shrink-0">{item.exchangeShortName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
