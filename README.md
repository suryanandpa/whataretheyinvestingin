# whatretheyinvestingin

## Data refresh

The API refreshes data every 6 hours with `node-cron` while `server.js` is running.

Refresh flow:

1. `crawler.js` pulls recent USASpending contract data into `signals`.
2. `priceFetcher.js` fills or backfills ticker and price data in `price_events`.
3. The website reads fresh data from the API and open browser tabs re-fetch every 6 hours.

Useful commands:

```bash
npm run db:setup
npm run sync
npm start
```

Production settings:

- `DATABASE_URL`: Postgres connection string.
- `SYNC_CRON`: optional cron expression. Defaults to `0 */6 * * *`.
- `SYNC_SECRET`: optional secret for `/api/sync`. When set, call `/api/sync?secret=...` or use `Authorization: Bearer ...`.
- `SYNC_ON_START=true`: optional startup sync.
- `VITE_API_BASE_URL`: frontend API base URL. Defaults to `https://whataretheyinvestingin-api.onrender.com`.

For serverless or sleeping hosts, configure an external cron job to call:

```text
GET https://whataretheyinvestingin-api.onrender.com/api/sync?secret=YOUR_SYNC_SECRET&trigger=external-cron
```

Run it every 6 hours. The in-process scheduler remains useful on always-on hosts, but an external cron is more reliable if the API can sleep.
