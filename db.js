require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4
});

async function setupDatabase() {
  const client = await pool.connect();
  try {
    console.log('Connected to database...');

    // Table 1: signals — every contract, grant, trade we find
    await client.query(`
      CREATE TABLE IF NOT EXISTS signals (
        id          SERIAL PRIMARY KEY,
        date        DATE NOT NULL,
        type        VARCHAR(50),        -- CONTRACT, GRANT, CONGRESS TRADE, etc.
        agency      VARCHAR(255),       -- Dept. of Defense, etc.
        company     VARCHAR(255),       -- Company name from gov data
        ticker      VARCHAR(20),        -- Stock ticker (PLTR, INTC, etc.)
        amount      BIGINT,             -- Dollar value in cents
        sector      VARCHAR(100),       -- AI, Defense, Nuclear, etc.
        description TEXT,
        source_url  TEXT,               -- Original source link
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✓ signals table ready');

    // Table 2: price_events — stock price before/after each signal
    await client.query(`
      CREATE TABLE IF NOT EXISTS price_events (
        id          SERIAL PRIMARY KEY,
        signal_id   INTEGER REFERENCES signals(id),
        ticker      VARCHAR(20),
        price_before DECIMAL(10,2),    -- Price 1 day before signal
        price_1w    DECIMAL(10,2),     -- Price 1 week after
        price_1m    DECIMAL(10,2),     -- Price 1 month after
        delta_1w    DECIMAL(10,2),     -- % change after 1 week
        delta_1m    DECIMAL(10,2),     -- % change after 1 month
        fetched_at  TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✓ price_events table ready');

    // Table 3: tickers — our company name → ticker mapping cache
    await client.query(`
      CREATE TABLE IF NOT EXISTS tickers (
        id           SERIAL PRIMARY KEY,
        company_name VARCHAR(255) UNIQUE,
        ticker       VARCHAR(20),
        confirmed    BOOLEAN DEFAULT false,
        created_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✓ tickers table ready');

    console.log('\n✅ Database setup complete!');
  } catch (err) {
    console.error('Database setup error:', err.message);
  } finally {
    client.release();
  }
}

setupDatabase();

module.exports = pool;