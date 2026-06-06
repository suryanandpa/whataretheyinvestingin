import React, { useState, useEffect } from 'react';

export default function Dashboard() {
  const [data, setData] = useState({ signals: [], sectors: [], stats: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Hardcoding 127.0.0.1 to bypass Windows IPv6 localhost routing bugs
    Promise.all([
      fetch('https://whataretheyinvestingin-api.onrender.com/api/signals').then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status} for signals`);
        return r.json();
      }),
      fetch('https://whataretheyinvestingin-api.onrender.com/api/sectors').then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status} for sectors`);
        return r.json();
      }),
      fetch('https://whataretheyinvestingin-api.onrender.com/api/stats').then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status} for stats`);
        return r.json();
      })
    ])
      .then(([signalsRes, sectorsRes, statsRes]) => {
        setData({
          signals: signalsRes.data || [],
          sectors: sectorsRes.data || [],
          stats: statsRes.data || null,
        });
        setLoading(false);
      })
      .catch(err => {
        console.error("API Fetch Error:", err);
        setError(err.message === "Failed to fetch" ? "CORS Blocked or Server Down (Check Terminal)" : err.message);
        setLoading(false);
      });
  }, []);
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-white font-mono">
        <div className="text-2xl animate-pulse">📡 Syncing with Government Datasets...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-red-500 font-mono">
        <div className="text-xl">⚠️ Connection Failed: {error}</div>
      </div>
    );
  }

  const formatMoney = (amount) => {
    if (amount >= 1e9) return `$${(amount / 1e9).toFixed(2)}B`;
    if (amount >= 1e6) return `$${(amount / 1e6).toFixed(2)}M`;
    return `$${amount.toLocaleString()}`;
  };

  const formatPercent = (val) => {
    if (!val) return 'N/A';
    const num = parseFloat(val);
    const sign = num > 0 ? '+' : '';
    const color = num > 0 ? 'text-green-400' : num < 0 ? 'text-red-400' : 'text-gray-400';
    return <span className={color}>{sign}{num}%</span>;
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        <header className="border-b border-gray-800 pb-6">
          <h1 className="text-4xl font-black tracking-tight text-white">whataretheyinventingin.in</h1>
          <p className="text-gray-400 mt-2 text-lg">Following the smart money. Trading the signal.</p>
        </header>

        {data.stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
              <div className="text-gray-500 text-sm font-semibold uppercase tracking-wider mb-2">Total Gov Capital</div>
              <div className="text-3xl font-bold text-green-400">{formatMoney(data.stats.total_dollars)}</div>
            </div>
            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
              <div className="text-gray-500 text-sm font-semibold uppercase tracking-wider mb-2">Tracked Signals</div>
              <div className="text-3xl font-bold text-blue-400">{data.stats.total_signals}</div>
            </div>
            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
              <div className="text-gray-500 text-sm font-semibold uppercase tracking-wider mb-2">Priced Entities</div>
              <div className="text-3xl font-bold text-purple-400">{data.stats.priced_signals}</div>
            </div>
            <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg">
              <div className="text-gray-500 text-sm font-semibold uppercase tracking-wider mb-2">Top Mover (1M)</div>
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-bold text-white">{data.stats.top_mover?.ticker || 'N/A'}</span>
                <span className="text-xl">{formatPercent(data.stats.top_mover?.delta_1m)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-gray-800 bg-gray-900 flex justify-between items-center">
            <h2 className="text-xl font-bold text-white">Live Intelligence Feed</h2>
            <div className="flex space-x-2">
              <span className="flex items-center text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded-full border border-green-400/20">
                <span className="w-2 h-2 rounded-full bg-green-400 mr-2 animate-pulse"></span>
                LIVE DB SYNC
              </span>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-950/50 text-gray-400 text-xs uppercase tracking-wider">
                  <th className="p-4 font-medium">Date</th>
                  <th className="p-4 font-medium">Company</th>
                  <th className="p-4 font-medium">Ticker</th>
                  <th className="p-4 font-medium">Contract Value</th>
                  <th className="p-4 font-medium">Sector</th>
                  <th className="p-4 font-medium">1W Move</th>
                  <th className="p-4 font-medium">1M Move</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.signals.map((signal) => (
                  <tr key={signal.id} className="hover:bg-gray-800/50 transition-colors">
                    <td className="p-4 text-sm text-gray-400">{new Date(signal.date).toLocaleDateString()}</td>
                    <td className="p-4 text-sm font-medium text-white">{signal.company}</td>
                    <td className="p-4">
                      {signal.ticker ? (
                        <span className="bg-blue-900/50 text-blue-300 text-xs font-bold px-2 py-1 rounded border border-blue-700/50">
                          {signal.ticker}
                        </span>
                      ) : (
                        <span className="text-gray-600 text-xs italic">Private</span>
                      )}
                    </td>
                    <td className="p-4 text-sm font-mono text-gray-300">{formatMoney(signal.amount_dollars)}</td>
                    <td className="p-4 text-sm text-gray-400">{signal.sector || 'Uncategorized'}</td>
                    <td className="p-4 text-sm font-mono">{formatPercent(signal.delta_1w)}</td>
                    <td className="p-4 text-sm font-mono">{formatPercent(signal.delta_1m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}