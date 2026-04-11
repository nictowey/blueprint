#!/usr/bin/env node

/**
 * CLI script for running Blueprint's walk-forward validation.
 *
 * Usage: node server/scripts/run-validation.js [--profile growth_breakout] [--top 10]
 * Requires: FMP_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN env vars
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { runValidation, DEFAULT_TEST_CASES } = require('../services/validation');
const { loadCacheFromRedis, isReady } = require('../services/universe');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

function fmt(v) {
  if (v == null) return '  N/A  ';
  const sign = v >= 0 ? '+' : '';
  return (sign + v.toFixed(2) + '%').padStart(9);
}

function interpretCorrelation(rho) {
  if (rho == null) return 'Insufficient data';
  if (rho > 0.15) return 'Positive (good)';
  if (rho > 0.05) return 'Weak positive';
  if (rho > -0.05) return 'No correlation';
  if (rho > -0.15) return 'Weak negative';
  return 'Negative (concerning)';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const profile = getArg(args, '--profile') || 'growth_breakout';
  const topN = parseInt(getArg(args, '--top') || '10', 10);

  console.log('='.repeat(70));
  console.log('  Blueprint Walk-Forward Validation');
  console.log('='.repeat(70));
  console.log(`  Profile : ${profile}`);
  console.log(`  Top N   : ${topN}`);
  console.log(`  Cases   : ${DEFAULT_TEST_CASES.length}`);
  console.log('='.repeat(70));
  console.log();

  // Load universe from Redis
  console.log('Loading universe from Redis...');
  await loadCacheFromRedis();

  if (!isReady()) {
    console.error('ERROR: Universe cache not ready. Ensure Redis is populated.');
    process.exit(1);
  }
  console.log('Universe loaded.\n');

  // Run validation
  const report = await runValidation({
    profile,
    topN,
    onProgress: msg => console.log(msg),
  });

  console.log();

  // ------- Summary stats -------
  console.log('-'.repeat(70));
  console.log('  SUMMARY');
  console.log('-'.repeat(70));
  console.log(`  Completed : ${report.completedCount}`);
  console.log(`  Skipped   : ${report.skippedCount}`);
  console.log(`  Errors    : ${report.errorCount}`);
  console.log();

  // ------- Survivorship bias warning -------
  console.log('  WARNING: ' + report.survivorshipBiasWarning);
  console.log();

  // ------- Aggregate table -------
  if (report.aggregate) {
    console.log('-'.repeat(70));
    console.log('  AGGREGATE RESULTS');
    console.log('-'.repeat(70));
    console.log('  Period | Matches Avg | SPY Avg    | Alpha      | Win Rate | Cases');
    console.log('  ' + '-'.repeat(66));

    for (const period of ['1m', '3m', '6m', '12m']) {
      const a = report.aggregate[period];
      if (!a) {
        console.log(`  ${period.padEnd(6)} | ${'  N/A  '.padStart(11)} | ${'  N/A  '.padStart(10)} | ${'  N/A  '.padStart(10)} | ${'  N/A '.padStart(8)} | N/A`);
        continue;
      }
      console.log(
        `  ${period.padEnd(6)} |` +
        ` ${fmt(a.avgReturn).padStart(11)} |` +
        ` ${fmt(a.avgBenchmarkReturn).padStart(10)} |` +
        ` ${fmt(a.alpha).padStart(10)} |` +
        ` ${(a.avgWinRate != null ? a.avgWinRate.toFixed(0) + '%' : 'N/A').padStart(8)} |` +
        ` ${a.caseCount}`
      );
    }
    console.log();
  }

  // ------- Correlation table -------
  if (report.correlation) {
    console.log('-'.repeat(70));
    console.log('  SCORE-RETURN CORRELATION (Spearman)');
    console.log('-'.repeat(70));
    console.log('  Period | Spearman rho | N pairs | Interpretation');
    console.log('  ' + '-'.repeat(58));

    for (const period of ['1m', '3m', '6m', '12m']) {
      const c = report.correlation[period];
      if (!c) continue;
      const rhoStr = c.rho != null ? c.rho.toFixed(4).padStart(12) : '         N/A';
      const nStr = String(c.n).padStart(7);
      const interp = interpretCorrelation(c.rho);
      console.log(`  ${period.padEnd(6)} | ${rhoStr} | ${nStr} | ${interp}`);
    }
    console.log();
  }

  // ------- Per-case 12m results -------
  const completedCases = report.cases.filter(c => c.status === 'completed');
  if (completedCases.length > 0) {
    console.log('-'.repeat(70));
    console.log('  PER-CASE 12M RESULTS');
    console.log('-'.repeat(70));
    console.log('  Ticker | Date       | Matches Avg | SPY        | Alpha      | Win Rate');
    console.log('  ' + '-'.repeat(68));

    for (const c of completedCases) {
      const s = c.summary?.['12m'];
      if (!s) {
        console.log(`  ${c.ticker.padEnd(6)} | ${c.date} |   N/A       |   N/A      |   N/A      |   N/A`);
        continue;
      }
      const alpha = s.avgReturn != null && s.benchmarkReturn != null
        ? s.avgReturn - s.benchmarkReturn
        : null;
      console.log(
        `  ${c.ticker.padEnd(6)} | ${c.date} |` +
        ` ${fmt(s.avgReturn).padStart(11)} |` +
        ` ${fmt(s.benchmarkReturn).padStart(10)} |` +
        ` ${fmt(alpha).padStart(10)} |` +
        ` ${(s.winRate != null ? s.winRate.toFixed(0) + '%' : 'N/A').padStart(8)}`
      );
    }
    console.log();
  }

  // ------- Verdict -------
  console.log('='.repeat(70));
  const alpha12m = report.aggregate?.['12m']?.alpha;
  let verdict;
  if (alpha12m == null) {
    verdict = 'INCONCLUSIVE';
  } else if (alpha12m > 5) {
    verdict = 'PASS';
  } else if (alpha12m > 0) {
    verdict = 'MARGINAL';
  } else {
    verdict = 'FAIL';
  }
  console.log(`  VERDICT: ${verdict}` + (alpha12m != null ? ` (12m alpha: ${alpha12m > 0 ? '+' : ''}${alpha12m.toFixed(2)}%)` : ''));

  const corr12m = report.correlation?.['12m']?.rho;
  if (corr12m != null) {
    console.log(`  Correlation: ${corr12m.toFixed(4)} — ${interpretCorrelation(corr12m)}`);
  }
  console.log('='.repeat(70));

  // ------- Save JSON report -------
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(__dirname, `validation-report-${today}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${outPath}`);
}

main().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});
