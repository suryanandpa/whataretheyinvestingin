import { useCallback, useEffect, useMemo, useState } from 'react';
import heroImage from './assets/hero.png';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://whataretheyinvestingin-api.onrender.com';
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 25;
const SECTOR_COLORS = ['#16845b', '#e2963b', '#4d83a5', '#c75b4d', '#79844a', '#7165a0', '#3c9a9a'];

const money = (amount = 0) => {
  const value = Number(amount) || 0;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const percent = (value) => {
  if (value === null || value === undefined || value === '') return 'N/A';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
};

const dateLabel = (value, options = { month: 'short', day: 'numeric', year: 'numeric' }) => {
  if (!value) return 'Date unavailable';
  return new Date(value).toLocaleDateString(undefined, options);
};

function Status({ running, lastSync }) {
  const failed = lastSync?.status === 'failed';
  const label = running ? 'Sync running' : failed ? 'Last sync failed' : 'Data available';

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
      running
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : failed
          ? 'border-rose-200 bg-rose-50 text-rose-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-800'
    }`}>
      <span className={`h-2 w-2 rounded-full ${running ? 'bg-amber-500' : failed ? 'bg-rose-500' : 'bg-emerald-600'}`} />
      {label}
    </span>
  );
}

function Metric({ label, value, detail, tone = 'green' }) {
  const border = {
    green: 'border-l-emerald-600',
    orange: 'border-l-orange-500',
    blue: 'border-l-sky-700',
    red: 'border-l-rose-600',
  }[tone];

  return (
    <section className={`min-w-0 border-l-[3px] ${border} bg-white px-5 py-4`}>
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </section>
  );
}

function Panel({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`min-w-0 border border-slate-200 bg-white ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function SpendingChart({ rows }) {
  const values = useMemo(() => {
    const byMonth = new Map(rows.map((row) => [String(row.month).slice(0, 7), Number(row.total_dollars) || 0]));
    const now = new Date();
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      return {
        label: date.toLocaleDateString(undefined, { month: 'short' }),
        value: byMonth.get(key) || 0,
        key,
      };
    });
  }, [rows]);
  const maxValue = Math.max(...values.map((item) => item.value), 1);
  const total = values.reduce((sum, item) => sum + item.value, 0);
  const chart = { left: 54, top: 14, width: 620, height: 154 };
  const barWidth = 27;
  const gap = (chart.width - values.length * barWidth) / (values.length - 1);

  return (
    <div className="px-4 pb-4 pt-3 sm:px-5">
      <div className="mb-2 flex items-end justify-between gap-3">
        <p className="text-2xl font-semibold text-slate-950">{money(total)}</p>
        <p className="text-xs text-slate-500">Award value across 12 months</p>
      </div>
      <svg className="h-auto w-full" viewBox="0 0 710 210" role="img" aria-label="Monthly federal contract award value bar chart">
        {[0, 1, 2, 3].map((line) => {
          const y = chart.top + (chart.height / 3) * line;
          return (
            <g key={line}>
              <line x1={chart.left} x2={chart.left + chart.width} y1={y} y2={y} stroke="#e5e7eb" strokeDasharray="3 5" />
              <text x="0" y={y + 4} fill="#64748b" fontSize="10">{money(maxValue * (1 - line / 3))}</text>
            </g>
          );
        })}
        {values.map((item, index) => {
          const height = (item.value / maxValue) * chart.height;
          const x = chart.left + index * (barWidth + gap);
          return (
            <g key={item.key}>
              <rect x={x} y={chart.top + chart.height - height} width={barWidth} height={Math.max(height, 2)} fill={index === values.length - 1 ? '#16845b' : '#9fcdb9'} rx="2">
                <title>{item.label}: {money(item.value)}</title>
              </rect>
              <text x={x + barWidth / 2} y="190" textAnchor="middle" fill="#64748b" fontSize="10">{item.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function SectorBreakdown({ rows }) {
  const maxValue = Math.max(...rows.map((row) => Number(row.total_dollars) || 0), 1);
  const total = rows.reduce((sum, row) => sum + (Number(row.total_dollars) || 0), 0);

  if (!rows.length) return <p className="px-5 py-8 text-sm text-slate-500">No sector data yet.</p>;

  return (
    <div className="space-y-4 px-5 py-5">
      {rows.slice(0, 7).map((row, index) => {
        const value = Number(row.total_dollars) || 0;
        const share = total ? (value / total) * 100 : 0;
        return (
          <div key={row.sector || 'unknown'}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium text-slate-700">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: SECTOR_COLORS[index % SECTOR_COLORS.length] }} />
                <span className="truncate">{row.sector || 'Uncategorized'}</span>
              </span>
              <span className="shrink-0 text-right font-semibold text-slate-900">{money(value)}</span>
            </div>
            <div className="h-2 overflow-hidden bg-slate-100">
              <div className="h-full" style={{ width: `${Math.max((value / maxValue) * 100, 1)}%`, backgroundColor: SECTOR_COLORS[index % SECTOR_COLORS.length] }} />
            </div>
            <p className="mt-1 text-right text-[11px] text-slate-500">{share.toFixed(1)}% of tracked value</p>
          </div>
        );
      })}
    </div>
  );
}

function RecipientFlow({ rows }) {
  const maxValue = Math.max(...rows.map((row) => Number(row.total_dollars) || 0), 1);

  if (!rows.length) return <p className="px-5 py-8 text-sm text-slate-500">No award recipients yet.</p>;

  return (
    <div className="divide-y divide-slate-100">
      {rows.slice(0, 8).map((row, index) => (
        <div key={row.company || index} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-5 py-3.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{row.company || 'Unknown recipient'}</p>
            <p className="mt-0.5 text-xs text-slate-500">{row.ticker || row.sector || 'No public ticker'} · {row.signal_count} awards</p>
          </div>
          <p className="text-right text-sm font-semibold text-slate-900">{money(row.total_dollars)}</p>
          <div className="col-span-2 h-1.5 bg-slate-100">
            <div className="h-full bg-emerald-600" style={{ width: `${Math.max((Number(row.total_dollars) / maxValue) * 100, 1)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PerformanceBars({ rows }) {
  const measured = rows
    .filter((row) => Number(row.priced_1m_count) > 0 && row.avg_delta_1m !== null)
    .sort((a, b) => Number(b.avg_delta_1m) - Number(a.avg_delta_1m))
    .slice(0, 8);
  const range = Math.max(...measured.map((row) => Math.abs(Number(row.avg_delta_1m))), 1);

  if (!measured.length) return <p className="px-5 py-8 text-sm text-slate-500">One-month returns will appear after price data is available.</p>;

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex justify-between pl-[145px] pr-12 text-[10px] text-slate-400">
        <span>−{range.toFixed(0)}%</span><span>0%</span><span>+{range.toFixed(0)}%</span>
      </div>
      <div className="space-y-3">
        {measured.map((row) => {
          const value = Number(row.avg_delta_1m);
          const width = `${Math.min((Math.abs(value) / range) * 50, 50)}%`;
          return (
            <div key={row.company} className="grid grid-cols-[minmax(110px,136px)_minmax(0,1fr)_44px] items-center gap-2 text-xs">
              <span className="truncate font-medium text-slate-700" title={row.company}>{row.ticker || row.company}</span>
              <div className="relative h-5 bg-slate-50">
                <div className="absolute bottom-0 left-1/2 top-0 w-px bg-slate-300" />
                <div
                  className={`absolute top-1 h-3 ${value >= 0 ? 'bg-emerald-600' : 'bg-rose-500'}`}
                  style={value >= 0 ? { left: '50%', width } : { right: '50%', width }}
                />
              </div>
              <span className={`text-right font-semibold ${value >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{percent(value)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] leading-5 text-slate-500">Average observed share-price change one month after award dates. This is descriptive timing, not evidence that an award caused the change.</p>
    </div>
  );
}

function awardUrl(value) {
  if (!value) return null;
  if (/^https:\/\/www\.usaspending\.gov\//i.test(value)) return value;
  return `https://www.usaspending.gov/search/?keywords=${encodeURIComponent(value)}`;
}

function csvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

export default function Dashboard() {
  const [analytics, setAnalytics] = useState({ monthly: [], sectors: [], recipients: [], summary: null });
  const [signals, setSignals] = useState([]);
  const [totalSignals, setTotalSignals] = useState(0);
  const [sync, setSync] = useState(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('');
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);

  const getJson = useCallback(async (url, signal) => {
    const response = await fetch(`${API_BASE_URL}${url}`, { signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `API returned ${response.status}`);
    return body;
  }, []);

  const refreshAnalytics = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await getJson('/api/analytics');
      setAnalytics(result.data || { monthly: [], sectors: [], recipients: [], summary: null });
      setSync(result.sync || null);
      setUpdatedAt(new Date());
      setReloadKey((key) => key + 1);
      setError('');
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'The API could not be reached. Check the Render service and API URL.' : err.message);
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [getJson]);

  useEffect(() => {
    const initialLoad = window.setTimeout(refreshAnalytics, 0);
    const timer = window.setInterval(refreshAnalytics, REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [refreshAnalytics]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    if (search) params.set('q', search);
    if (sector) params.set('sector', sector);

    getJson(`/api/signals?${params}`, controller.signal)
      .then((result) => {
        setSignals(result.data || []);
        setTotalSignals(result.total || 0);
        setSync(result.sync || null);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message === 'Failed to fetch' ? 'The API could not be reached. Check the Render service and API URL.' : err.message);
      });
    return () => controller.abort();
  }, [getJson, page, reloadKey, search, sector]);

  const pages = Math.max(Math.ceil(totalSignals / PAGE_SIZE), 1);
  const summary = analytics.summary || {};
  const positiveRate = Number(summary.priced_1m_count)
    ? `${((Number(summary.positive_1m_count) / Number(summary.priced_1m_count)) * 100).toFixed(0)}%`
    : 'N/A';
  const lastUpdateLabel = sync?.last_sync?.finished_at
    ? dateLabel(sync.last_sync.finished_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : updatedAt
      ? dateLabel(updatedAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'Not available';

  const changeSector = (value) => {
    setSector(value);
    setPage(0);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ all: '1' });
      if (search) params.set('q', search);
      if (sector) params.set('sector', sector);
      const result = await getJson(`/api/signals?${params}`);
      const columns = [
        ['Award date', 'date'], ['Recipient', 'company'], ['Agency', 'agency'], ['Ticker', 'ticker'],
        ['Award value USD', 'amount_dollars'], ['Sector', 'sector'], ['Description', 'description'],
        ['USAspending source', 'source_url'], ['1 week return percent', 'delta_1w'], ['1 month return percent', 'delta_1m'],
      ];
      const lines = [columns.map(([label]) => csvValue(label)).join(',')];
      result.data.forEach((row) => lines.push(columns.map(([, key]) => csvValue(row[key])).join(',')));
      const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'federal-award-flows.csv';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(`CSV export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  if (loading && !analytics.summary) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-sm text-slate-600">Loading award data…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 py-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-slate-200 bg-slate-950">
              <img src={heroImage} alt="" className="h-10 w-10 object-contain" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase text-slate-500">Federal awards · public market response</p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-950">Where the money flows</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Status running={sync?.running} lastSync={sync?.last_sync} />
            <span className="px-2 text-xs text-slate-500">Updated {lastUpdateLabel}</span>
            <button onClick={refreshAnalytics} disabled={refreshing} className="border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {refreshing ? 'Refreshing…' : 'Refresh data'}
            </button>
            <button onClick={exportCsv} disabled={exporting} className="bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
              {exporting ? 'Preparing CSV…' : 'Export CSV'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1440px] space-y-6 px-5 py-6 sm:px-8">
        {error && <div role="alert" className="border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

        <section className="grid grid-cols-1 gap-px border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Tracked award value" value={money(summary.total_dollars)} detail="Value of captured contract awards" tone="green" />
          <Metric label="Recipients tracked" value={Number(summary.total_companies || 0).toLocaleString()} detail={`${Number(summary.total_signals || 0).toLocaleString()} individual awards`} tone="orange" />
          <Metric label="Average 1M price change" value={percent(summary.avg_delta_1m)} detail={`${Number(summary.priced_1m_count || 0).toLocaleString()} awards with one-month data`} tone="blue" />
          <Metric label="Positive 1M outcomes" value={positiveRate} detail="Share of priced awards with a positive move" tone="red" />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
          <Panel title="Award value over time" subtitle="Monthly totals from captured federal contract awards">
            <SpendingChart rows={analytics.monthly} />
          </Panel>
          <Panel title="Sector allocation" subtitle="Share of total tracked award value">
            <SectorBreakdown rows={analytics.sectors} />
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <Panel title="Largest recipients" subtitle="Companies receiving the most tracked award value">
            <RecipientFlow rows={analytics.recipients} />
          </Panel>
          <Panel title="Public market response" subtitle="Average observed 1-month share-price change by recipient">
            <PerformanceBars rows={analytics.recipients} />
          </Panel>
        </section>

        <Panel
          title="Contract register"
          subtitle={`${totalSignals.toLocaleString()} matching awards · sorted by award value`}
          action={(
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <input
                aria-label="Search awards"
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(0); }}
                placeholder="Search company, ticker, agency…"
                className="min-w-0 border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-700 sm:w-64"
              />
              <select aria-label="Filter by sector" value={sector} onChange={(event) => changeSector(event.target.value)} className="border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-700">
                <option value="">All sectors</option>
                {analytics.sectors.map((row) => <option key={row.sector || 'unknown'} value={row.sector}>{row.sector || 'Uncategorized'}</option>)}
              </select>
            </div>
          )}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] border-collapse text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-500">
                  <th className="px-5 py-3">Award date</th>
                  <th className="px-5 py-3">Recipient / agency</th>
                  <th className="px-5 py-3">Award value</th>
                  <th className="px-5 py-3">Sector</th>
                  <th className="px-5 py-3">1 week</th>
                  <th className="px-5 py-3">1 month</th>
                  <th className="px-5 py-3">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {signals.map((row) => {
                  const source = awardUrl(row.source_url);
                  return (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-3.5 text-xs text-slate-600">{dateLabel(row.date)}</td>
                      <td className="max-w-[300px] px-5 py-3.5">
                        <p className="truncate text-sm font-semibold text-slate-900">{row.company || 'Unknown recipient'} {row.ticker && <span className="font-medium text-slate-500">· {row.ticker}</span>}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{row.agency || 'Unknown agency'}</p>
                        {row.description && <p className="mt-1 truncate text-xs text-slate-400" title={row.description}>{row.description}</p>}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-sm font-semibold text-slate-900">{money(row.amount_dollars)}</td>
                      <td className="px-5 py-3.5 text-xs text-slate-600">{row.sector || 'Uncategorized'}</td>
                      <td className={`whitespace-nowrap px-5 py-3.5 text-xs font-semibold ${Number(row.delta_1w) > 0 ? 'text-emerald-700' : Number(row.delta_1w) < 0 ? 'text-rose-700' : 'text-slate-400'}`}>{percent(row.delta_1w)}</td>
                      <td className={`whitespace-nowrap px-5 py-3.5 text-xs font-semibold ${Number(row.delta_1m) > 0 ? 'text-emerald-700' : Number(row.delta_1m) < 0 ? 'text-rose-700' : 'text-slate-400'}`}>{percent(row.delta_1m)}</td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        {source ? <a href={source} target="_blank" rel="noreferrer" className="text-xs font-semibold text-sky-800 underline decoration-sky-300 underline-offset-2 hover:text-sky-950">USAspending</a> : <span className="text-xs text-slate-400">Unavailable</span>}
                      </td>
                    </tr>
                  );
                })}
                {!signals.length && <tr><td colSpan="7" className="px-5 py-12 text-center text-sm text-slate-500">No awards match those filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">Showing {signals.length ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, totalSignals)} of {totalSignals.toLocaleString()}</p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((current) => Math.max(current - 1, 0))} disabled={page === 0} className="border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">Previous</button>
              <span className="min-w-16 text-center text-xs text-slate-500">Page {page + 1} of {pages}</span>
              <button onClick={() => setPage((current) => Math.min(current + 1, pages - 1))} disabled={page >= pages - 1} className="border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40">Next</button>
            </div>
          </div>
        </Panel>

        <footer className="flex flex-col gap-1 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500 sm:flex-row sm:justify-between">
          <p>Award amounts describe reported contract awards; they are not necessarily cash disbursed.</p>
          <p>Price changes are measured around award dates and do not establish causation. Source: USAspending.gov and Yahoo Finance.</p>
        </footer>
      </div>
    </main>
  );
}
