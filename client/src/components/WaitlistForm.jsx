import { useState } from 'react';

export default function WaitlistForm({ compact = false }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState(null); // null | 'loading' | 'success' | 'error'
  const [count, setCount] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.includes('@')) return;

    setStatus('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setStatus('success');
      setCount(data.count);
      setEmail('');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'success') {
    return (
      <div className={`text-center ${compact ? 'py-2' : 'py-4'}`}>
        <p className="text-emerald-400 text-sm font-medium">You're on the list!</p>
        <p className="text-warm-muted text-xs mt-1 font-light">
          We'll notify you when premium features launch.
          {count > 1 && <span className="text-warm-gray"> You're #{count} on the waitlist.</span>}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={compact ? '' : 'text-center'}>
      {!compact && (
        <>
          <p className="text-warm-white text-sm font-medium mb-1">Get early access</p>
          <p className="text-warm-muted text-xs mb-3 font-light">
            Alerts, saved screens, and more — coming soon.
          </p>
        </>
      )}
      <div className={`flex gap-2 ${compact ? '' : 'justify-center'} max-w-md ${compact ? '' : 'mx-auto'}`}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="input-field text-sm py-2 px-3 flex-1 min-w-0"
          required
        />
        <button
          type="submit"
          className="btn-primary text-sm px-4 py-2 whitespace-nowrap"
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Joining...' : compact ? 'Join' : 'Join Waitlist'}
        </button>
      </div>
      {status === 'error' && (
        <p className="text-red-400 text-xs mt-2">Something went wrong. Try again.</p>
      )}
    </form>
  );
}
