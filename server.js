require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const { execFile } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const SYNC_CRON = process.env.SYNC_CRON || '0 */6 * * *';
const SYNC_SECRET = process.env.SYNC_SECRET;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4,
});

let activeSync = null;
let lastSync = null;
let syncTableReady = false;

app.use(cors());
app.use(express.json());

async function ensureSyncRunsTable() {
  if (syncTableReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMP,
      status VARCHAR(20) NOT NULL DEFAULT 'running',
      trigger VARCHAR(50),
      error TEXT
    );
  `);

  syncTableReady = true;
}

async function loadLastSyncFromDb() {
  await ensureSyncRunsTable();

  const { rows } = await pool.query(`
    SELECT id, status, trigger, started_at, finished_at, error
    FROM sync_runs
    WHERE finished_at IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 1
  `);

  if (!rows[0]) return;

  lastSync = {
    id: rows[0].id,
    status: rows[0].status,
    trigger: rows[0].trigger,
    startedAt: new Date(rows[0].started_at),
    finishedAt: new Date(rows[0].finished_at),
    error: rows[0].error,
  };
}

function getNextSyncTime() {
  if (activeSync?.startedAt) return null;

  if (lastSync?.finishedAt) {
    return new Date(lastSync.finishedAt.getTime() + 6 * 60 * 60 * 1000);
  }

  return null;
}

function runScript(scriptName) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, scriptName);

    execFile(process.execPath, [scriptPath], {
      cwd: __dirname,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);

      if (error) {
        const details = (stderr || stdout || error.message).trim().slice(-4000);
        const exitCode = error.code ?? error.signal ?? 'unknown';
        reject(new Error(`${scriptName} failed (${exitCode}): ${details}`));
        return;
      }

      resolve();
    });
  });
}

async function recordSyncStart(trigger) {
  await ensureSyncRunsTable();
  const { rows } = await pool.query(
    `INSERT INTO sync_runs (trigger) VALUES ($1) RETURNING id, started_at`,
    [trigger]
  );

  return rows[0];
}

async function recordSyncFinish(syncId, status, error = null) {
  await pool.query(
    `UPDATE sync_runs
     SET finished_at = NOW(), status = $2, error = $3
     WHERE id = $1`,
    [syncId, status, error]
  );
}

function runSync(trigger = 'manual') {
  if (activeSync) {
    return activeSync;
  }

  activeSync = (async () => {
    const startedAt = new Date();
    let syncRun = null;

    try {
      syncRun = await recordSyncStart(trigger);
      console.log(`[sync] Started by ${trigger} at ${startedAt.toISOString()}`);

      console.log('[sync] Running crawler...');
      await runScript('crawler.js');

      console.log('[sync] Running price fetcher...');
      await runScript('priceFetcher.js');

      await recordSyncFinish(syncRun.id, 'success');
      lastSync = {
        id: syncRun.id,
        status: 'success',
        trigger,
        startedAt,
        finishedAt: new Date(),
        error: null,
      };

      console.log(`[sync] Complete at ${lastSync.finishedAt.toISOString()}`);
      return lastSync;
    } catch (err) {
      const message = err?.message || String(err);
      console.error('[sync] Failed:', err);

      if (syncRun?.id) {
        await recordSyncFinish(syncRun.id, 'failed', message);
      }

      lastSync = {
        id: syncRun?.id || null,
        status: 'failed',
        trigger,
        startedAt,
        finishedAt: new Date(),
        error: message,
      };

      return lastSync;
    } finally {
      activeSync = null;
    }
  })();

  activeSync.startedAt = new Date();
  activeSync.trigger = trigger;

  return activeSync;
}

function verifySyncRequest(req, res, next) {
  if (!SYNC_SECRET) {
    next();
    return;
  }

  const authHeader = req.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const providedSecret = bearerToken || req.query.secret;

  if (providedSecret !== SYNC_SECRET) {
    res.status(401).json({ success: false, error: 'Unauthorized sync request' });
    return;
  }

  next();
}

function getSyncState() {
  return {
    running: Boolean(activeSync),
    last_sync: lastSync
      ? {
          id: lastSync.id,
          status: lastSync.status,
          trigger: lastSync.trigger,
          started_at: lastSync.startedAt.toISOString(),
          finished_at: lastSync.finishedAt.toISOString(),
          error: lastSync.error,
        }
      : null,
    next_sync_at: getNextSyncTime()?.toISOString() || null,
    schedule: SYNC_CRON,
  };
}

// Start a background sync. Use SYNC_SECRET in production and call this from
// Render Cron, UptimeRobot, GitHub Actions, or any external scheduler.
app.get('/api/sync', verifySyncRequest, (req, res) => {
  const alreadyRunning = Boolean(activeSync);
  const sync = runSync(req.query.trigger || 'api');

  res.status(alreadyRunning ? 202 : 200).json({
    success: true,
    message: alreadyRunning ? 'Sync already running' : 'Sync started',
    sync: {
      running: true,
      trigger: sync.trigger || req.query.trigger || 'api',
      started_at: sync.startedAt?.toISOString() || new Date().toISOString(),
    },
  });
});

app.post('/api/sync', verifySyncRequest, (req, res) => {
  const alreadyRunning = Boolean(activeSync);
  const sync = runSync(req.body?.trigger || 'api');

  res.status(alreadyRunning ? 202 : 200).json({
    success: true,
    message: alreadyRunning ? 'Sync already running' : 'Sync started',
    sync: {
      running: true,
      trigger: sync.trigger || req.body?.trigger || 'api',
      started_at: sync.startedAt?.toISOString() || new Date().toISOString(),
    },
  });
});

app.get('/api/sync/status', async (req, res) => {
  try {
    await ensureSyncRunsTable();

    if (!lastSync) {
      const { rows } = await pool.query(`
        SELECT id, status, trigger, started_at, finished_at, error
        FROM sync_runs
        ORDER BY started_at DESC
        LIMIT 1
      `);

      if (rows[0]?.finished_at) {
        lastSync = {
          id: rows[0].id,
          status: rows[0].status,
          trigger: rows[0].trigger,
          startedAt: new Date(rows[0].started_at),
          finishedAt: new Date(rows[0].finished_at),
          error: rows[0].error,
        };
      }
    }

    res.json({ success: true, data: getSyncState() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const [monthly, sectors, recipients, summary] = await Promise.all([
      pool.query(`
        SELECT DATE_TRUNC('month', date)::date AS month,
               SUM(amount) / 100.0 AS total_dollars,
               COUNT(*)::int AS signal_count
        FROM signals
        WHERE date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months'
        GROUP BY DATE_TRUNC('month', date)
        ORDER BY month
      `),
      pool.query(`
        SELECT sector,
               COUNT(*)::int AS signal_count,
               SUM(amount) / 100.0 AS total_dollars
        FROM signals
        GROUP BY sector
        ORDER BY total_dollars DESC
      `),
      pool.query(`
        WITH event_returns AS (
          SELECT signal_id, AVG(delta_1w) AS delta_1w, AVG(delta_1m) AS delta_1m
          FROM price_events
          GROUP BY signal_id
        )
        SELECT s.company,
               MAX(s.ticker) AS ticker,
               MAX(s.sector) AS sector,
               COUNT(*)::int AS signal_count,
               SUM(s.amount) / 100.0 AS total_dollars,
               AVG(r.delta_1w) AS avg_delta_1w,
               AVG(r.delta_1m) AS avg_delta_1m,
               COUNT(r.delta_1m)::int AS priced_1m_count
        FROM signals s
        LEFT JOIN event_returns r ON r.signal_id = s.id
        GROUP BY s.company
        ORDER BY total_dollars DESC
        LIMIT 12
      `),
      pool.query(`
        WITH event_returns AS (
          SELECT signal_id, AVG(delta_1m) AS delta_1m
          FROM price_events
          GROUP BY signal_id
        )
        SELECT COUNT(*)::int AS total_signals,
               COALESCE(SUM(s.amount) / 100.0, 0) AS total_dollars,
               COUNT(DISTINCT s.company)::int AS total_companies,
               COUNT(r.delta_1m)::int AS priced_1m_count,
               AVG(r.delta_1m) AS avg_delta_1m,
               COUNT(*) FILTER (WHERE r.delta_1m > 0)::int AS positive_1m_count
        FROM signals s
        LEFT JOIN event_returns r ON r.signal_id = s.id
      `),
    ]);

    res.json({
      success: true,
      data: {
        monthly: monthly.rows,
        sectors: sectors.rows,
        recipients: recipients.rows,
        summary: summary.rows[0],
      },
      sync: getSyncState(),
    });
  } catch (err) {
    console.error('[api/analytics] Failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Returns all signals with their price events joined.
app.get('/api/signals', async (req, res) => {
  try {
    const { sector, type, q = '' } = req.query;
    const exportAll = req.query.all === '1';
    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Math.min(Math.max(parsedLimit || 25, 1), 100);
    const parsedOffset = Number.parseInt(req.query.offset, 10);
    const offset = Math.max(parsedOffset || 0, 0);

    const where = [];
    const params = [];

    if (sector) {
      params.push(sector);
      where.push(`s.sector = $${params.length}`);
    }
    if (type) {
      params.push(type);
      where.push(`s.type = $${params.length}`);
    }
    if (q.trim()) {
      params.push(`%${q.trim()}%`);
      where.push(`(s.company ILIKE $${params.length} OR s.ticker ILIKE $${params.length} OR s.agency ILIKE $${params.length} OR s.description ILIKE $${params.length})`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM signals s ${whereClause}`, params);
    const pageParams = [...params];
    const pagingClause = exportAll ? '' : `LIMIT $${pageParams.push(limit)} OFFSET $${pageParams.push(offset)}`;

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
      ${pagingClause}
    `, pageParams);

    res.json({
      success: true,
      count: rows.length,
      total: countResult.rows[0].total,
      limit: exportAll ? null : limit,
      offset: exportAll ? null : offset,
      data: rows,
      sync: getSyncState(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Returns sector summary stats.
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

    res.json({ success: true, data: rows, sync: getSyncState() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Returns top-level dashboard numbers.
app.get('/api/stats', async (req, res) => {
  try {
    const [signals, priced, topMover] = await Promise.all([
      pool.query('SELECT COUNT(*) as total, SUM(amount)/100.0 as total_dollars FROM signals'),
      pool.query('SELECT COUNT(*) as total FROM price_events WHERE delta_1m IS NOT NULL'),
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
        total_signals: parseInt(signals.rows[0].total, 10),
        total_dollars: parseFloat(signals.rows[0].total_dollars || 0),
        priced_signals: parseInt(priced.rows[0].total, 10),
        top_mover: topMover.rows[0] || null,
      },
      sync: getSyncState(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Returns top 10 stocks by price movement after contract.
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

    res.json({ success: true, data: rows, sync: getSyncState() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    sync: getSyncState(),
  });
});

cron.schedule(SYNC_CRON, () => {
  runSync('cron');
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Sync scheduler active: ${SYNC_CRON}`);
  console.log(`Sync endpoint: GET/POST http://localhost:${PORT}/api/sync`);

  loadLastSyncFromDb().catch((err) => {
    console.error('[sync] Could not load sync history:', err.message);
  });

  if (process.env.SYNC_ON_START === 'true') {
    runSync('startup');
  }
});
