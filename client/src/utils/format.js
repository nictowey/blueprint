/**
 * Format a metric value for display.
 * Returns '—' when value is null/undefined.
 */
export function formatMetric(key, value) {
  if (value == null) return '—';

  switch (key) {
    case 'price':
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'peRatio':
      return `${value.toFixed(1)}x`;
    case 'priceToSales':
      return `${value.toFixed(1)}x`;
    case 'revenueGrowthYoY':
      return `${(value * 100).toFixed(1)}%`;
    case 'grossMargin':
      return `${(value * 100).toFixed(1)}%`;
    case 'rsi14':
      return value.toFixed(1);
    case 'pctBelowHigh':
      return `${value.toFixed(1)}%`;
    case 'marketCap':
      return formatMarketCap(value);
    case 'shortInterestPct':
      return `${value.toFixed(1)}%`;
    default:
      return String(value);
  }
}

function formatMarketCap(value) {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9)  return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6)  return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString()}`;
}

export const METRIC_LABELS = {
  price:             'Price',
  peRatio:           'P/E Ratio',
  priceToSales:      'Price-to-Sales',
  revenueGrowthYoY:  'Revenue Growth YoY',
  grossMargin:       'Gross Margin',
  rsi14:             'RSI (14-day)',
  pctBelowHigh:      '% Below 52W High',
  marketCap:         'Market Cap',
  shortInterestPct:  'Short Interest %',
};
