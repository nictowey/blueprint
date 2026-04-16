import { Link } from 'react-router-dom';

export default function Proof() {
  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 animate-fade-in">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-2xl sm:text-3xl font-display text-warm-white mb-2">
          How Blueprint Works
        </h1>
        <p className="text-warm-gray text-sm font-light max-w-xl mx-auto">
          Blueprint finds stocks with similar financial DNA to proven breakout winners
          by comparing 28 metrics across 6 categories.
        </p>
      </div>

      {/* Visual process flow */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <div className="card text-center py-6">
          <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-3">
            <span className="text-accent font-display text-lg">1</span>
          </div>
          <p className="text-warm-white font-medium text-sm mb-1">Capture the fingerprint</p>
          <p className="text-warm-muted text-xs font-light">
            Pick a stock that broke out. Blueprint extracts its exact financial profile at that moment — 28 metrics across valuation, growth, profitability, and more.
          </p>
        </div>
        <div className="card text-center py-6">
          <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-3">
            <span className="text-accent font-display text-lg">2</span>
          </div>
          <p className="text-warm-white font-medium text-sm mb-1">Scan for lookalikes</p>
          <p className="text-warm-muted text-xs font-light">
            The algorithm compares that fingerprint against 3,500+ current stocks using specialized similarity functions tuned to each metric type.
          </p>
        </div>
        <div className="card text-center py-6">
          <div className="w-12 h-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-3">
            <span className="text-accent font-display text-lg">3</span>
          </div>
          <p className="text-warm-white font-medium text-sm mb-1">Investigate matches</p>
          <p className="text-warm-muted text-xs font-light">
            Compare side-by-side, drill into individual metrics, check historical backtests, and build your watchlist of candidates.
          </p>
        </div>
      </div>

      {/* The concept */}
      <div className="card mb-6">
        <p className="section-label mb-3">Why This Approach</p>
        <div className="divider-gold mb-4" />
        <div className="text-sm text-warm-gray leading-relaxed space-y-3 font-light">
          <p>
            Traditional stock screeners require you to manually define criteria — "show me stocks with P/E under 20
            and revenue growth above 15%." But what criteria should you use? How do you know what mattered for a
            stock like CLS before its +490% run?
          </p>
          <p>
            <span className="text-warm-white font-medium">Blueprint flips the approach.</span> Instead of defining
            criteria, you point at a company that already worked and the algorithm extracts the criteria from it.
            CLS had a P/E of 16.1, revenue growth of 17%, operating margin of 4.4% — Blueprint finds
            current stocks that match all 28 of those metrics simultaneously.
          </p>
        </div>
      </div>

      {/* 28 Metrics */}
      <div className="card mb-6">
        <p className="section-label mb-3">28 Financial Metrics</p>
        <div className="divider-gold mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-warm-white font-medium mb-2">Valuation (6)</p>
            <ul className="text-warm-gray font-light space-y-1">
              <li>P/E Ratio</li>
              <li>Price-to-Book</li>
              <li>Price-to-Sales</li>
              <li>EV/EBITDA</li>
              <li>EV/Revenue</li>
              <li>PEG Ratio</li>
            </ul>
          </div>
          <div>
            <p className="text-warm-white font-medium mb-2">Profitability (7)</p>
            <ul className="text-warm-gray font-light space-y-1">
              <li>Gross Margin</li>
              <li>Operating Margin</li>
              <li>Net Margin</li>
              <li>EBITDA Margin</li>
              <li>Return on Equity</li>
              <li>Return on Assets</li>
              <li>Return on Capital</li>
            </ul>
          </div>
          <div>
            <p className="text-warm-white font-medium mb-2">Growth (3)</p>
            <ul className="text-warm-gray font-light space-y-1">
              <li>Revenue Growth YoY</li>
              <li>Revenue 3yr CAGR</li>
              <li>EPS Growth YoY</li>
            </ul>
          </div>
          <div>
            <p className="text-warm-white font-medium mb-2">Financial Health (5)</p>
            <ul className="text-warm-gray font-light space-y-1">
              <li>Current Ratio</li>
              <li>Debt-to-Equity</li>
              <li>Interest Coverage</li>
              <li>Net Debt / EBITDA</li>
              <li>Free Cash Flow Yield</li>
            </ul>
          </div>
          <div>
            <p className="text-warm-white font-medium mb-2">Technical (6)</p>
            <ul className="text-warm-gray font-light space-y-1">
              <li>RSI (14-day)</li>
              <li>% Below 52-Week High</li>
              <li>Price vs 50-Day MA</li>
              <li>Price vs 200-Day MA</li>
              <li>Beta</li>
              <li>Relative Volume</li>
            </ul>
          </div>
          <div>
            <p className="text-warm-white font-medium mb-2">Size (1)</p>
            <ul className="text-warm-gray font-light space-y-1">
              <li>Market Cap</li>
            </ul>
          </div>
        </div>
      </div>

      {/* How similarity is calculated */}
      <div className="card mb-6">
        <p className="section-label mb-3">Similarity Scoring</p>
        <div className="divider-gold mb-4" />
        <div className="text-sm text-warm-gray leading-relaxed space-y-3 font-light">
          <p>
            Each metric type uses a <span className="text-warm-white font-medium">specialized comparison function</span> tuned
            to how that metric actually behaves:
          </p>
          <ul className="space-y-2 pl-4">
            <li><span className="text-warm-white font-medium">Valuation ratios</span> (P/E, EV/EBITDA) — log-scale comparison, because a P/E of 15 vs 30 is more meaningful than 150 vs 165</li>
            <li><span className="text-warm-white font-medium">Margins</span> (gross, operating, net) — hybrid absolute/relative, so 3% vs 0.5% FCF yield is recognized as fundamentally different even though the point gap is small</li>
            <li><span className="text-warm-white font-medium">Growth rates</span> — dampened comparison with direction penalty, because +20% vs -10% growth are opposite stories regardless of the 30-point gap</li>
            <li><span className="text-warm-white font-medium">Technical indicators</span> — bounded scales matched to each indicator's natural range (RSI 0-100, % below high 0-100)</li>
            <li><span className="text-warm-white font-medium">Market cap</span> — log-scale, so two $5B companies are "similar size" but a $500M and $50B company are not</li>
          </ul>
          <p>
            Metrics are grouped into 6 categories, each with its own weight reflecting importance to breakout detection:
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {[
              { name: 'Growth', weight: '25%' },
              { name: 'Profitability', weight: '25%' },
              { name: 'Valuation', weight: '22%' },
              { name: 'Financial Health', weight: '10%' },
              { name: 'Technical', weight: '10%' },
              { name: 'Size', weight: '8%' },
            ].map(c => (
              <span key={c.name} className="text-xs border border-dark-border/50 rounded-full px-3 py-1">
                <span className="text-warm-white font-medium">{c.name}</span>
                <span className="text-warm-muted ml-1">{c.weight}</span>
              </span>
            ))}
          </div>
          <p className="mt-2">
            This category-first architecture prevents any single metric from dominating. Technical indicators
            can only contribute 10% of the score regardless of how many individual technicals look similar.
          </p>
        </div>
      </div>

      {/* Strategy profiles */}
      <div className="card mb-6">
        <p className="section-label mb-3">Strategy Profiles</p>
        <div className="divider-gold mb-4" />
        <div className="text-sm text-warm-gray leading-relaxed space-y-3 font-light">
          <p>
            <span className="text-warm-white font-medium">5 strategy profiles</span> shift the metric weights
            to match different investing styles. The same two stocks can score differently depending on
            what you're looking for:
          </p>
          <div className="space-y-3 mt-3">
            <div>
              <p className="text-warm-white font-medium">Growth Breakout</p>
              <p className="text-warm-muted text-xs">Emphasizes revenue/EPS acceleration, PEG ratio, and momentum near highs</p>
            </div>
            <div>
              <p className="text-warm-white font-medium">Value Inflection</p>
              <p className="text-warm-muted text-xs">Prioritizes cheap valuations (P/E, EV/EBITDA, P/B) with improving cash flow</p>
            </div>
            <div>
              <p className="text-warm-white font-medium">Momentum / Technical</p>
              <p className="text-warm-muted text-xs">Matches on RSI, moving average positioning, proximity to highs, and volatility</p>
            </div>
            <div>
              <p className="text-warm-white font-medium">Quality Compounder</p>
              <p className="text-warm-muted text-xs">Focuses on return on capital, strong margins, consistent multi-year growth</p>
            </div>
            <div>
              <p className="text-warm-white font-medium">GARP</p>
              <p className="text-warm-muted text-xs">Growth at a Reasonable Price — balances PEG ratio with revenue growth and valuation</p>
            </div>
          </div>
        </div>
      </div>

      {/* Data sources */}
      <div className="card mb-6">
        <p className="section-label mb-3">Data & Accuracy</p>
        <div className="divider-gold mb-4" />
        <div className="text-sm text-warm-gray leading-relaxed space-y-3 font-light">
          <p>
            All financial data comes from <span className="text-warm-white font-medium">Financial Modeling Prep (FMP)</span>.
            Metrics are computed from trailing twelve months (TTM) of quarterly reports, validated to ensure the
            4 most recent quarters span an 8-15 month window.
          </p>
          <p>
            Historical snapshots reconstruct what a company looked like at any past date using only data
            that was actually filed as of that date — no look-ahead bias.
          </p>
          <p>
            The stock universe is refreshed continuously, with approximately <span className="text-warm-white font-medium">3,500+
            stocks</span> across all sectors on NASDAQ and NYSE.
          </p>
        </div>
      </div>

      {/* Disclaimers */}
      <div className="card border-dark-border/30">
        <p className="section-label mb-3">Disclaimers</p>
        <div className="space-y-2">
          <p className="text-xs text-warm-muted leading-relaxed font-light">
            Blueprint is a screening tool that identifies stocks with similar financial profiles. It does not
            predict future stock performance or provide investment recommendations. All investment decisions
            should be made based on your own research and risk tolerance.
          </p>
          <p className="text-xs text-warm-muted leading-relaxed font-light">
            Data sourced from Financial Modeling Prep. While we validate data quality, we cannot guarantee
            100% accuracy of third-party financial data. Not financial advice.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="text-center mt-10">
        <Link to="/" className="btn-primary px-6 py-3 text-sm">
          Start Screening →
        </Link>
      </div>
    </main>
  );
}
