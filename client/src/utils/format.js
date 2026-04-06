/**
 * Format a metric value for display.
 * Returns '—' when value is null/undefined.
 */
export function formatMetric(key, value) {
  if (value == null) return '—';

  switch (key) {
    // Dollar: price
    case 'price':
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Dollar per share
    case 'eps':
      return `$${value.toFixed(2)}`;

    // Multiplier ratios (x suffix)
    case 'peRatio':
    case 'priceToBook':
    case 'priceToSales':
    case 'evToEBITDA':
    case 'evToRevenue':
    case 'pegRatio':
      return `${value.toFixed(1)}x`;

    // Percentage — stored as decimal (multiply by 100)
    case 'revenueGrowthYoY':
    case 'revenueGrowth3yr':
    case 'epsGrowthYoY':
    case 'grossMargin':
    case 'operatingMargin':
    case 'netMargin':
    case 'ebitdaMargin':
    case 'returnOnEquity':
    case 'returnOnAssets':
    case 'returnOnCapital':
    case 'earningsYield':
    case 'freeCashFlowYield':
    case 'dividendYield':
      return `${(value * 100).toFixed(1)}%`;

    // Percentage — already a percentage value (do not multiply)
    case 'pctBelowHigh':
    case 'shortInterestPct':
      return `${value.toFixed(1)}%`;

    // Percentage with sign — priceVsMa already in percentage points
    case 'priceVsMa50':
    case 'priceVsMa200':
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

    // Raw number (RSI 0–100)
    case 'rsi14':
      return value.toFixed(1);

    // Raw ratio (2 decimals)
    case 'currentRatio':
    case 'debtToEquity':
    case 'interestCoverage':
    case 'netDebtToEBITDA':
    case 'beta':
      return value.toFixed(2);

    // Large dollar amounts
    case 'marketCap':
    case 'totalCash':
    case 'totalDebt':
    case 'freeCashFlow':
    case 'operatingCashFlow':
      return formatDollars(value);

    // Volume
    case 'avgVolume':
      return formatVolume(value);

    default:
      return String(value);
  }
}

function formatDollars(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(1)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  return `${sign}$${abs.toLocaleString()}`;
}

function formatVolume(value) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(value);
}

export const METRIC_LABELS = {
  // Overview
  price:             'Price',
  marketCap:         'Market Cap',
  eps:               'EPS (TTM)',
  dividendYield:     'Dividend Yield',
  // Valuation
  peRatio:           'P/E Ratio',
  priceToBook:       'Price-to-Book',
  priceToSales:      'Price-to-Sales',
  evToEBITDA:        'EV/EBITDA',
  evToRevenue:       'EV/Revenue',
  pegRatio:          'PEG Ratio',
  earningsYield:     'Earnings Yield',
  // Profitability
  grossMargin:       'Gross Margin',
  operatingMargin:   'Operating Margin',
  netMargin:         'Net Margin',
  ebitdaMargin:      'EBITDA Margin',
  returnOnEquity:    'Return on Equity',
  returnOnAssets:    'Return on Assets',
  returnOnCapital:   'Return on Capital',
  // Growth
  revenueGrowthYoY:  'Revenue Growth YoY',
  revenueGrowth3yr:  'Revenue 3yr CAGR',
  epsGrowthYoY:      'EPS Growth YoY',
  // Financial Health
  currentRatio:      'Current Ratio',
  debtToEquity:      'Debt / Equity',
  interestCoverage:  'Interest Coverage',
  netDebtToEBITDA:   'Net Debt / EBITDA',
  freeCashFlowYield: 'FCF Yield',
  totalCash:         'Total Cash',
  totalDebt:         'Total Debt',
  freeCashFlow:      'Free Cash Flow',
  operatingCashFlow: 'Operating Cash Flow',
  // Technical
  rsi14:             'RSI (14-day)',
  pctBelowHigh:      '% Below 52W High',
  priceVsMa50:       'vs 50-Day MA',
  priceVsMa200:      'vs 200-Day MA',
  beta:              'Beta',
  avgVolume:         'Avg Volume',
  // Misc
  shortInterestPct:  'Short Interest %',
};
