import { useEffect, useMemo, useState } from 'react';
import heroImage from './assets/hero.png';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://whataretheyinvestingin-api.onrender.com';
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

function StatusPill({ running }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
      running
        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
        : 'border-slate-200 bg-white text-slate-600'
    }`}>
      <span className={`h-2 w-2 rounded-full ${running ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {running ? 'Sync running' : 'Live data'}
    </span>
  );
}

function MetricCard({ label, value, tone = 'slate', detail }) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    slate: 'border-slate-200 bg-white text-slate-900',
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${tones[tone].split(' ')[1]}`} />
      </div>
      <div className={`mt-3 text-3xl font-semibold ${tones[tone].split(' ')[2]}`}>{value}</div>
      {detail && <p className="mt-2 text-sm text-slate-500">{detail}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState({ signals: [], sectors: [], stats: null, sync: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastPulledAt, setLastPulledAt] = useState(null);

  useEffect(() => {
    const fetchJson = async (path, label) => {
      const response = await fetch(`${API_BASE_URL}${path}`);
      if (!response.ok) throw new Error(`Server returned ${response.status} for ${label}`);
      return response.json();
    };

    const loadDashboard = () => {
      Promise.all([
        fetchJson('/api/signals', 'signals'),
        fetchJson('/api/sectors', 'sectors'),
        fetchJson('/api/stats', 'stats'),
      ])
        .then(([signalsRes, sectorsRes, statsRes]) => {
          setData({
            signals: signalsRes.data || [],
            sectors: sectorsRes.data || [],
            stats: statsRes.data || null,
            sync: statsRes.sync || signalsRes.sync || null,
          });
          setLastPulledAt(new Date());
          setError(null);
          setLoading(false);
        })
        .catch((err) => {
          console.error('API Fetch Error:', err);
          setError(err.message === 'Failed to fetch' ? 'API is unreachable or blocked by CORS.' : err.message);
          setLoading(false);
        });
    };

    loadDashboard();
    const refreshTimer = window.setInterval(loadDashboard, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(refreshTimer);
  }, []);

  const formatMoney = (amount = 0) => {
    const value = Number(amount) || 0;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    return `$${value.toLocaleString()}`;
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined || value === '') return <span className="text-slate-400">N/A</span>;

    const number = Number(value);
    const color = number > 0 ? 'text-emerald-600' : number < 0 ? 'text-rose-600' : 'text-slate-500';
    const sign = number > 0 ? '+' : '';
    return <span className={`font-semibold ${color}`}>{sign}{number.toFixed(2)}%</span>;
  };

  const formatTimestamp = (value) => {
    if (!value) return 'Pending';
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const topSectors = useMemo(() => data.sectors.slice(0, 5), [data.sectors]);
  const biggestSectorValue = Math.max(...topSectors.map((sector) => Number(sector.total_dollars) || 0), 1);
  const lastSyncAt = data.sync?.last_sync?.finished_at || lastPulledAt;

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f6f3ee] text-slate-950">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="h-2 w-24 rounded-full bg-indigo-600" />
            <h1 className="mt-6 text-2xl font-semibold">Loading market intelligence</h1>
            <p className="mt-2 text-sm text-slate-500">Pulling the latest dashboard data from the API.</p>
          </div>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-[#f6f3ee] text-slate-950">
        <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">
          <div className="w-full max-w-lg rounded-lg border border-rose-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-medium text-rose-600">Connection failed</p>
            <h1 className="mt-3 text-2xl font-semibold">The dashboard could not reach the API.</h1>
            <p className="mt-3 text-sm text-slate-600">{error}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f3ee] text-slate-950">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-6 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-slate-950">
              <img src={heroImage} alt="" className="h-11 w-11 object-contain" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Government contracts and public-market reaction</p>
              <h1 className="text-3xl font-semibold text-slate-950 sm:text-4xl">What Are They Investing In</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <StatusPill running={data.sync?.running} />
            <span className="rounded-full border border-slate-200 bg-[#f6f3ee] px-3 py-1 text-xs font-medium text-slate-600">
              Last pull: {formatTimestamp(lastSyncAt)}
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Total gov capital"
            value={formatMoney(data.stats?.total_dollars)}
            detail="Tracked across live contract signals"
            tone="emerald"
          />
          <MetricCard
            label="Tracked signals"
            value={(data.stats?.total_signals || 0).toLocaleString()}
            detail="Contracts in the database"
            tone="indigo"
          />
          <MetricCard
            label="Priced entities"
            value={(data.stats?.priced_signals || 0).toLocaleString()}
            detail="Signals matched to stock data"
            tone="amber"
          />
          <MetricCard
            label="Top 1M mover"
            value={data.stats?.top_mover?.ticker || 'N/A'}
            detail={formatPercent(data.stats?.top_mover?.delta_1m)}
            tone="rose"
          />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Live intelligence feed</p>
                <h2 className="text-xl font-semibold text-slate-950">Largest current signals</h2>
              </div>
              <p className="text-sm text-slate-500">{data.signals.length} rows shown</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Company</th>
                    <th className="px-5 py-3">Ticker</th>
                    <th className="px-5 py-3">Value</th>
                    <th className="px-5 py-3">Sector</th>
                    <th className="px-5 py-3">1W</th>
                    <th className="px-5 py-3">1M</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.signals.map((signal) => (
                    <tr key={signal.id} className="transition-colors hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-4 text-sm text-slate-500">
                        {new Date(signal.date).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-4">
                        <p className="max-w-[280px] truncate text-sm font-semibold text-slate-950">{signal.company}</p>
                        <p className="mt-1 max-w-[320px] truncate text-xs text-slate-500">{signal.agency}</p>
                      </td>
                      <td className="px-5 py-4">
                        {signal.ticker ? (
                          <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                            {signal.ticker}
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-slate-400">Private</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-sm font-semibold text-slate-900">
                        {formatMoney(signal.amount_dollars)}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-600">{signal.sector || 'Uncategorized'}</td>
                      <td className="px-5 py-4 text-sm">{formatPercent(signal.delta_1w)}</td>
                      <td className="px-5 py-4 text-sm">{formatPercent(signal.delta_1m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-lg border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
              <p className="text-sm font-medium text-slate-300">Signal focus</p>
              <h2 className="mt-2 text-2xl font-semibold">Where the money is clustering</h2>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Sector totals highlight where recent federal spending is concentrating before the feed drills into individual contracts.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-slate-950">Top sectors</h2>
                <span className="text-xs font-medium text-slate-500">By value</span>
              </div>

              <div className="mt-5 space-y-4">
                {topSectors.map((sector) => {
                  const total = Number(sector.total_dollars) || 0;
                  const width = `${Math.max((total / biggestSectorValue) * 100, 8)}%`;

                  return (
                    <div key={sector.sector || 'Unknown'}>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-medium text-slate-700">{sector.sector || 'Uncategorized'}</span>
                        <span className="font-semibold text-slate-950">{formatMoney(total)}</span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-slate-100">
                        <div className="h-2 rounded-full bg-indigo-600" style={{ width }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </section>
      </div>

      <footer className="mx-auto max-w-7xl px-5 pb-6 text-center text-xs text-slate-400 sm:px-8">
        . Project by SuryaNand PA, made for fun
      </footer>
    </main>
  );
}
