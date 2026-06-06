require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const KNOWN_TICKERS = {
  'LOCKHEED MARTIN': 'LMT',
  'BOEING': 'BA',
  'NORTHROP GRUMMAN': 'NOC',
  'RAYTHEON': 'RTX',
  'RTX CORPORATION': 'RTX',
  'GENERAL DYNAMICS': 'GD',
  'HUMANA': 'HUM',
  'UNITEDHEALTH': 'UNH',
  'HEALTH NET': 'CNC',
  'PALANTIR': 'PLTR',
  'INTEL': 'INTC',
  'NVIDIA': 'NVDA',
  'MICROSOFT': 'MSFT',
  'AMAZON': 'AMZN',
  'GOOGLE': 'GOOGL',
  'ALPHABET': 'GOOGL',
  'HONEYWELL': 'HON',
  'HUNTINGTON INGALLS': 'HII',
  'L3HARRIS': 'LHX',
  'BECHTEL': null,
  'BATTELLE': null,
  'UT-BATTELLE': null,
  'ELECTRIC BOAT': 'GD',
  'SPACEX': null,
  'STANFORD': null,
  'UNIVERSITY OF CALIFORNIA': null,
  'ARGONNE': null,
  'SANDIA': null,
  'LOS ALAMOS': null,
  'SAVANNAH RIVER': null,
  'FLUOR': 'FLR',
  'LEIDOS': 'LDOS',
  'SAIC': 'SAIC',
  'BOOZ ALLEN': 'BAH',
  'MODERNA': 'MRNA',
  'PFIZER': 'PFE',
};

function findTicker(companyName) {
  const upper = companyName.toUpperCase();
  for (const [key, ticker] of Object.entries(KNOWN_TICKERS)) {
    if (upper.includes(key.toUpperCase())) {
      return ticker;
    }
  }
  return null;
}

async function getStockPrice(ticker, date) {
  try {
    const d = new Date(date);
    
    // Clamp date: if older than 2 years or in future, use 1 year ago
    const now = new Date();
    const twoYearsAgo = new Date(); twoYearsAgo.setFullYear(now.getFullYear() - 2);
    if (d < twoYearsAgo || d > now) d.setTime(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const end = new Date(d);
    end.setDate(end.getDate() + 5);
    // end can't be in the future
    if (end > now) end.setTime(now.getTime());

    const period1 = Math.floor(d.getTime() / 1000);
    const period2 = Math.floor(end.getTime() / 1000);

    // period2 must be greater than period1
    if (period2 <= period1) return null;

    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${period1}&period2=${period2}&interval=1d`;

    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com',
      },
      timeout: 10000,
    });

    const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
    if (!closes || closes.length === 0) return null;
    return closes.find(p => p !== null) ?? null;
  } catch (e) {
    console.log(`    ⚠ ${ticker}: ${e.message}`);
    return null;
  }
}

function calcDelta(before, after) {
  if (!before || !after) return null;
  return parseFloat((((after - before) / before) * 100).toFixed(2));
}

async function runPriceFetcher() {
  console.log('💹 Starting price fetcher...');
  console.log('━'.repeat(50));

  const client = await pool.connect();
  const { rows: signals } = await client.query(`
    SELECT s.id, s.company, s.date, s.sector, s.amount
    FROM signals s
    LEFT JOIN price_events p ON p.signal_id = s.id
    WHERE p.id IS NULL
    ORDER BY s.amount DESC
  `);
  console.log(`Found ${signals.length} signals without price data\n`);
  client.release();

  let processed = 0;
  let found = 0;
  let skipped = 0;

  for (const signal of signals) {
    const ticker = findTicker(signal.company);
    processed++;

    if (!ticker) {
      console.log(`  ⚪ [${processed}/${signals.length}] ${signal.company.slice(0, 40)} — no ticker`);
      const c = await pool.connect();
      await c.query(
        `INSERT INTO tickers (company_name, ticker, confirmed)
         VALUES ($1, $2, false)
         ON CONFLICT (company_name) DO NOTHING`,
        [signal.company, null]
      );
      c.release();
      skipped++;
      continue;
    }

    const c = await pool.connect();
    await c.query(
      `INSERT INTO tickers (company_name, ticker, confirmed)
       VALUES ($1, $2, true)
       ON CONFLICT (company_name) DO UPDATE SET ticker = $2`,
      [signal.company, ticker]
    );
    await c.query('UPDATE signals SET ticker = $1 WHERE id = $2', [ticker, signal.id]);

    const signalDate = new Date(signal.date);
    const dayBefore = new Date(signalDate); dayBefore.setDate(dayBefore.getDate() - 1);
    const weekAfter = new Date(signalDate); weekAfter.setDate(weekAfter.getDate() + 7);
    const monthAfter = new Date(signalDate); monthAfter.setMonth(monthAfter.getMonth() + 1);

    const [priceBefore, price1w, price1m] = await Promise.all([
      getStockPrice(ticker, dayBefore),
      getStockPrice(ticker, weekAfter),
      getStockPrice(ticker, monthAfter),
    ]);

    const delta1w = calcDelta(priceBefore, price1w);
    const delta1m = calcDelta(priceBefore, price1m);

    await c.query(
      `INSERT INTO price_events (signal_id, ticker, price_before, price_1w, price_1m, delta_1w, delta_1m)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [signal.id, ticker, priceBefore, price1w, price1m, delta1w, delta1m]
    );
    c.release();

    const millions = Math.round(signal.amount / 100 / 1_000_000);
    const d1w = delta1w !== null ? `${delta1w > 0 ? '+' : ''}${delta1w}%` : 'n/a';
    const d1m = delta1m !== null ? `${delta1m > 0 ? '+' : ''}${delta1m}%` : 'n/a';

    console.log(
      `  ✅ [${processed}/${signals.length}] ${ticker.padEnd(5)} ${signal.company.slice(0, 30).padEnd(32)}` +
      ` $${String(millions) + 'M'.padEnd(8)} 1w: ${d1w.padEnd(8)} 1m: ${d1m}`
    );
    found++;

    await new Promise((r) => setTimeout(r, 400));
  }

  console.log('\n' + '━'.repeat(50));
  console.log(`✅ Done! Priced: ${found} | Skipped: ${skipped}`);

  const summary = await pool.connect();
  const { rows } = await summary.query(`
    SELECT s.company, s.ticker, s.sector,
           s.amount/100/1000000 as millions,
           p.price_before, p.price_1w, p.delta_1w, p.delta_1m
    FROM signals s
    JOIN price_events p ON p.signal_id = s.id
    WHERE p.delta_1m IS NOT NULL
    ORDER BY p.delta_1m DESC
    LIMIT 10
  `);
  summary.release();

  if (rows.length > 0) {
    console.log('\n🏆 Top movers after contract award (1 month):');
    rows.forEach((r) => {
      const sign = r.delta_1m > 0 ? '+' : '';
      console.log(
        `  ${r.ticker.padEnd(6)} ${sign}${r.delta_1m}%`.padEnd(18) +
        ` $${Math.round(r.millions)}M`.padEnd(12) +
        ` ${r.company.slice(0, 35)}`
      );
    });
  }

  await pool.end();
}

runPriceFetcher();