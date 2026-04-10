/**
 * Build a user-friendly error message from a fetch Response.
 * Tries to extract `error` from a JSON body; falls back to status text.
 */
export async function httpError(res, fallbackMsg = 'Request failed') {
  let serverMsg = '';
  try {
    const body = await res.json();
    serverMsg = body.error || '';
  } catch {
    // non-JSON response — use status text
  }

  const statusHint = {
    400: 'Bad request',
    404: 'Not found',
    429: 'Too many requests — please wait a moment',
    500: 'Server error',
    502: 'Server unreachable',
    503: 'Server is warming up',
  }[res.status] || `HTTP ${res.status}`;

  return serverMsg || `${fallbackMsg} (${statusHint})`;
}
