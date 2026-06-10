require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const { execFile } = require('child_process');
const path = require('path');

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3001;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    execFile('node', [scriptName], { cwd: path.resolve(__dirname) }, (error, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);

      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function runSync() {
  try {
    console.log('📡 Running crawler...');
    await runScript('crawler.js');

    console.log('💹 Running price fetcher...');
    await runScript('priceFetcher.js');

    console.log('✅ Sync complete!');
  } catch (err) {
    console.error('Sync failed:', err);
  }
}

// Allow frontend (React on port 5173 or 3000) to call this API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.json());

app.get('/api/sync', (req, res) => {
  res.json({ success: true, message: 'Sync started — check logs' });
  runSync();
});

// ─── GET /api/signals ─────────────────────────────────────────────────────────
// Returns all signals with their price events joined
app.get('/api/signals', async (req, res) => {
  try {
    const { sector, type, limit = 50 } = req.query;

    let where = [];
    let params = [];

    if (sector) {
      params.push(sector);
      where.push(`s.sector = $${params.length}`);
    }
    if (type) {
      params.push(type);
      where.push(`s.type = $${params.length}`);
    }

    const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    params.push(parseInt(limit));

    const { rows } = await pool.query(`
      SELECT
        s.id,
        s.date,
        s.type,
        s.agency,
        s.company,
        s.ticker,
        s.amount / 100.0 AS amount_dollars,
        s.sector,
        s.description,
        s.source_url,
        p.price_before,
        p.price_1w,
        p.price_1m,
        p.delta_1w,
        p.delta_1m
      FROM signals s
      LEFT JOIN price_events p ON p.signal_id = s.id
      ${whereClause}
      ORDER BY s.amount DESC
      LIMIT $${params.length}
    `, params);

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/sectors ─────────────────────────────────────────────────────────
// Returns sector summary stats
app.get('/api/sectors', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        s.sector,
        COUNT(*) AS signal_count,
        SUM(s.amount) / 100.0 AS total_dollars,
        AVG(p.delta_1m) AS avg_delta_1m,
        AVG(p.delta_1w) AS avg_delta_1w
      FROM signals s
      LEFT JOIN price_events p ON p.signal_id = s.id
      GROUP BY s.sector
      ORDER BY total_dollars DESC
    `);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/stats ───────────────────────────────────────────────────────────
// Returns top-level dashboard numbers
app.get('/api/stats', async (req, res) => {
  try {
    const [signals, priced, topMover] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total, SUM(amount)/100.0 as total_dollars FROM signals`),
      pool.query(`SELECT COUNT(*) as total FROM price_events WHERE delta_1m IS NOT NULL`),
      pool.query(`
        SELECT s.ticker, s.company, p.delta_1m
        FROM signals s
        JOIN price_events p ON p.signal_id = s.id
        WHERE p.delta_1m IS NOT NULL
        ORDER BY ABS(p.delta_1m) DESC
        LIMIT 1
      `),
    ]);

    res.json({
      success: true,
      data: {
        total_signals: parseInt(signals.rows[0].total),
        total_dollars: parseFloat(signals.rows[0].total_dollars),
        priced_signals: parseInt(priced.rows[0].total),
        top_mover: topMover.rows[0] || null,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/top-movers ──────────────────────────────────────────────────────
// Returns top 10 stocks by price movement after contract
app.get('/api/top-movers', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (s.ticker)
        s.ticker,
        s.company,
        s.sector,
        s.amount / 100.0 AS amount_dollars,
        s.date,
        p.price_before,
        p.price_1m,
        p.delta_1w,
        p.delta_1m
      FROM signals s
      JOIN price_events p ON p.signal_id = s.id
      WHERE p.delta_1m IS NOT NULL AND s.ticker IS NOT NULL
      ORDER BY s.ticker, ABS(p.delta_1m) DESC
      LIMIT 10
    `);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/health ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start server ─────────────────────────────────────────────────────────────
cron.schedule('0 */6 * * *', () => {
  runSync();
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log('⏰ Cron scheduler active — syncing every 6 hours');
  console.log(`\nEndpoints:`);
  console.log(`  GET http://localhost:${PORT}/api/health`);
  console.log(`  GET http://localhost:${PORT}/api/sync`);
  console.log(`  GET http://localhost:${PORT}/api/stats`);
  console.log(`  GET http://localhost:${PORT}/api/signals`);
  console.log(`  GET http://localhost:${PORT}/api/sectors`);
  console.log(`  GET http://localhost:${PORT}/api/top-movers`);
  console.log(`\nFilters:`);
  console.log(`  /api/signals?sector=Defense`);
  console.log(`  /api/signals?type=CONTRACT&limit=10`);
});
