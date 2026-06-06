require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Sector guesser based on keywords in company/description ─────────────────
function guessSector(name = '', description = '') {
  const text = (name + ' ' + description).toLowerCase();
  if (text.match(/palantir|data|analytics|ai|artificial|software|cyber|cloud/)) return 'AI / Data';
  if (text.match(/nuclear|nuscale|reactor|energy|solar|wind|battery/)) return 'Energy';
  if (text.match(/intel|semiconductor|chip|nvidia|qualcomm|microelectronics/)) return 'Semiconductors';
  if (text.match(/space|rocket|satellite|launch|orbit|spacex|lockheed|boeing/)) return 'Space / Aerospace';
  if (text.match(/pharma|biotech|vaccine|drug|health|medical|moderna|pfizer/)) return 'Biotech / Health';
  if (text.match(/defense|army|navy|military|weapon|missile|raytheon|general dynamics/)) return 'Defense';
  if (text.match(/construction|infrastructure|bridge|road|building/)) return 'Infrastructure';
  if (text.match(/telecom|5g|network|fiber|broadband|verizon|att/)) return 'Telecom';
  return 'Other';
}

// ─── Fetch contracts from USASpending.gov ────────────────────────────────────
async function fetchContracts(page = 1) {
  console.log(`\n📡 Fetching contracts from USASpending.gov (page ${page})...`);

  const today = new Date();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(today.getMonth() - 6);

  const formatDate = (d) => d.toISOString().split('T')[0];

  const response = await axios.post(
    'https://api.usaspending.gov/api/v2/search/spending_by_award/',
    {
      filters: {
        time_period: [
          {
            start_date: formatDate(sixMonthsAgo),
            end_date: formatDate(today),
          },
        ],
        award_type_codes: ['A', 'B', 'C', 'D'], // Contract types
        award_amounts: [{ lower_bound: 10000000 }], // Min $10M contracts only
      },
      fields: [
        'Award ID',
        'Recipient Name',
        'Award Amount',
        'Awarding Agency',
        'Award Date',
        'Description',
        'recipient_id',
      ],
      sort: 'Award Amount',
      order: 'desc',
      limit: 25,
      page: page,
    },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );

  return response.data.results || [];
}

// ─── Save a single contract to the database ──────────────────────────────────
async function saveSignal(contract) {
  const client = await pool.connect();
  try {
    const company = contract['Recipient Name'] || 'Unknown';
    const amount = Math.round((contract['Award Amount'] || 0) * 100); // store in cents
    const agency = contract['Awarding Agency'] || 'Unknown Agency';
    const description = contract['Description'] || '';
    const date = contract['Award Date'] || new Date().toISOString().split('T')[0];
    const sector = guessSector(company, description);
    const sourceId = contract['Award ID'] || '';

    // Check if we already stored this one
    const existing = await client.query(
      'SELECT id FROM signals WHERE source_url = $1',
      [sourceId]
    );
    if (existing.rows.length > 0) {
      return null; // skip duplicate
    }

    const result = await client.query(
      `INSERT INTO signals (date, type, agency, company, amount, sector, description, source_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [date, 'CONTRACT', agency, company, amount, sector, description, sourceId]
    );

    return result.rows[0].id;
  } finally {
    client.release();
  }
}

// ─── Main crawler function ────────────────────────────────────────────────────
async function runCrawler() {
  console.log('🚀 Starting USASpending crawler...');
  console.log('━'.repeat(50));

  let totalSaved = 0;
  let totalSkipped = 0;

  try {
    // Fetch 2 pages = up to 50 contracts
    for (let page = 1; page <= 2; page++) {
      const contracts = await fetchContracts(page);

      if (contracts.length === 0) {
        console.log('No more contracts found.');
        break;
      }

      console.log(`\n📋 Processing ${contracts.length} contracts...`);

      for (const contract of contracts) {
        const id = await saveSignal(contract);
        if (id) {
          const company = contract['Recipient Name'] || 'Unknown';
          const amount = ((contract['Award Amount'] || 0) / 1_000_000).toFixed(1);
          const sector = guessSector(company, contract['Description'] || '');
          console.log(`  ✓ [${sector}] ${company} — $${amount}M`);
          totalSaved++;
        } else {
          totalSkipped++;
        }
      }

      // Be polite to the API - wait 1 second between pages
      if (page < 2) await new Promise((r) => setTimeout(r, 1000));
    }

    console.log('\n' + '━'.repeat(50));
    console.log(`✅ Done! Saved: ${totalSaved} | Skipped (duplicates): ${totalSkipped}`);

    // Show what's in the database now
    const client = await pool.connect();
    const count = await client.query('SELECT COUNT(*) FROM signals');
    const topSectors = await client.query(
      `SELECT sector, COUNT(*) as count, SUM(amount) as total
       FROM signals GROUP BY sector ORDER BY total DESC LIMIT 5`
    );
    client.release();

    console.log(`\n📊 Database now has ${count.rows[0].count} total signals`);
    console.log('\n🏆 Top sectors by contract value:');
    topSectors.rows.forEach((row) => {
      const billions = (row.total / 100 / 1_000_000_000).toFixed(2);
      console.log(`  ${row.sector}: ${row.count} contracts — $${billions}B`);
    });

  } catch (err) {
    console.error('\n❌ Crawler error:', err.message);
    if (err.response) {
      console.error('API response:', err.response.data);
    }
  } finally {
    await pool.end();
  }
}

runCrawler();