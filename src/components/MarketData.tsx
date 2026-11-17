import { useState, useEffect, useMemo } from 'react';
import { Asset } from './AssetList';
import { Search, ArrowUpDown, TrendingUp, TrendingDown, Flame } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { motion, AnimatePresence } from 'motion/react';
import { formatPrice } from '@/lib/binance';
import { fetchCoinGeckoTrending, CoinGeckoTrendingCoin } from '@/lib/coingecko';

interface MarketDataProps {
  assets: Asset[];
  onTrade?: (asset: Asset) => void;
}

function formatMarketCap(cap?: number): string {
  if (!cap || isNaN(cap) || cap <= 0) return '—';
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`;
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(2)}B`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(2)}M`;
  return `$${cap.toLocaleString()}`;
}

function Sparkline7d({ prices, positive }: { prices?: number[]; positive: boolean }) {
  if (!prices || prices.length < 2) {
    return <span className="text-[11px] font-mono text-zinc-600">—</span>;
  }

  // Downsample to ~28 points for crisp rendering
  const step = Math.max(1, Math.floor(prices.length / 28));
  const sampled = prices.filter((_, i) => i % step === 0 || i === prices.length - 1);

  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;
  const width = 96;
  const height = 28;

  const points = sampled
    .map((p, idx) => {
      const x = (idx / (sampled.length - 1)) * width;
      const y = height - ((p - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="inline-block overflow-visible">
      <polyline
        fill="none"
        stroke={positive ? '#10B981' : '#EF4444'}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function MarketData({ assets, onTrade }: MarketDataProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof Asset>('marketCapRank');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [trendingCoins, setTrendingCoins] = useState<CoinGeckoTrendingCoin[]>([]);

  useEffect(() => {
    let isMounted = true;
    fetchCoinGeckoTrending().then((coins) => {
      if (isMounted) setTrendingCoins(coins);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const filteredAssets = useMemo(() => {
    return [...assets]
      .filter((a) => {
        const query = search.toLowerCase();
        return a.symbol.toLowerCase().includes(query) || a.name.toLowerCase().includes(query);
      })
      .sort((a, b) => {
        const factor = sortOrder === 'asc' ? 1 : -1;

        if (sortKey === 'symbol' || sortKey === 'name') {
          return (a[sortKey] as string).localeCompare(b[sortKey] as string) * factor;
        } else if (sortKey === 'volume') {
          const parseVol = (v: string) => {
            const num = parseFloat(v);
            if (v.endsWith('B')) return num * 1e9;
            if (v.endsWith('M')) return num * 1e6;
            if (v.endsWith('K')) return num * 1e3;
            return num;
          };
          return (parseVol(a.volume) - parseVol(b.volume)) * factor;
        } else if (sortKey === 'marketCapRank') {
          const rankA = a.marketCapRank ?? 9999;
          const rankB = b.marketCapRank ?? 9999;
          return (rankA - rankB) * factor;
        } else {
          const numA = Number(a[sortKey] ?? 0);
          const numB = Number(b[sortKey] ?? 0);
          return (numA - numB) * factor;
        }
      });
  }, [assets, search, sortKey, sortOrder]);

  const toggleSort = (key: keyof Asset) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortOrder(
        key === 'symbol' || key === 'name' || key === 'marketCapRank' ? 'asc' : 'desc'
      );
    }
  };

  const SortIcon = ({ columnKey }: { columnKey: keyof Asset }) => {
    if (sortKey !== columnKey) return <ArrowUpDown className="h-3 w-3 text-zinc-600 ml-1" />;
    return (
      <ArrowUpDown
        className={`h-3 w-3 ml-1 text-yellow-500 transition-transform ${
          sortOrder === 'desc' ? 'rotate-180' : ''
        }`}
      />
    );
  };

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col h-full space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-3xl font-black text-zinc-100 flex items-center gap-3">
              Market Data
            </h2>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live CoinGecko
            </div>
          </div>
          <p className="text-zinc-500 text-sm mt-1">
            Real-time cryptocurrency rankings, market caps, and 7-day sparklines powered by CoinGecko.
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-500" />
          <Input
            placeholder="Search Coin Name or Symbol..."
            className="pl-10 bg-zinc-900 border-zinc-800 text-zinc-100 h-12 focus-visible:ring-yellow-500 w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* CoinGecko Trending Coins Strip */}
      {trendingCoins.length > 0 && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-300">
              <Flame className="w-4 h-4 text-yellow-500" />
              <span>Trending on CoinGecko (24h)</span>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 uppercase">
              /search/trending
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
            {trendingCoins.map((coin) => {
              const matchedAsset = assets.find((a) => a.symbol === coin.symbol);
              const isPos = (coin.change24hPct ?? 0) >= 0;
              return (
                <button
                  key={coin.id || coin.symbol}
                  type="button"
                  onClick={() => {
                    if (matchedAsset && onTrade) {
                      onTrade(matchedAsset);
                    } else if (onTrade && coin.priceUsd) {
                      onTrade({
                        symbol: coin.symbol,
                        name: coin.name,
                        price: coin.priceUsd,
                        change: coin.change24hPct ?? 0,
                        volume: '0.00M',
                        coingeckoId: coin.id,
                        image: coin.thumb,
                        marketCapRank: coin.market_cap_rank ?? undefined,
                      });
                    }
                  }}
                  className="p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-yellow-500/40 transition-all text-left space-y-1.5 group"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {coin.thumb ? (
                        <img
                          src={coin.thumb}
                          alt={coin.symbol}
                          className="w-5 h-5 rounded-full shrink-0"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-zinc-800 text-[10px] font-bold flex items-center justify-center text-yellow-500 shrink-0">
                          {coin.symbol[0]}
                        </div>
                      )}
                      <span className="font-bold text-xs text-zinc-100 truncate group-hover:text-yellow-500">
                        {coin.symbol}
                      </span>
                    </div>
                    {coin.market_cap_rank && (
                      <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                        #{coin.market_cap_rank}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-zinc-300 truncate">
                      {coin.priceUsd ? `$${formatPrice(coin.priceUsd)}` : coin.name}
                    </span>
                    {typeof coin.change24hPct === 'number' && (
                      <span className={isPos ? 'text-emerald-400' : 'text-red-400'}>
                        {isPos ? '+' : ''}
                        {coin.change24hPct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex-1">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/50">
                <th
                  className="p-4 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                  onClick={() => toggleSort('marketCapRank')}
                >
                  <div className="flex items-center text-xs font-bold uppercase tracking-widest text-zinc-400">
                    # <SortIcon columnKey="marketCapRank" />
                  </div>
                </th>
                <th
                  className="p-4 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                  onClick={() => toggleSort('symbol')}
                >
                  <div className="flex items-center text-xs font-bold uppercase tracking-widest text-zinc-400">
                    Asset <SortIcon columnKey="symbol" />
                  </div>
                </th>
                <th
                  className="p-4 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                  onClick={() => toggleSort('price')}
                >
                  <div className="flex items-center justify-end text-xs font-bold uppercase tracking-widest text-zinc-400">
                    Price <SortIcon columnKey="price" />
                  </div>
                </th>
                <th
                  className="p-4 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                  onClick={() => toggleSort('change')}
                >
                  <div className="flex items-center justify-end text-xs font-bold uppercase tracking-widest text-zinc-400">
                    24h % <SortIcon columnKey="change" />
                  </div>
                </th>
                <th
                  className="p-4 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                  onClick={() => toggleSort('marketCap')}
                >
                  <div className="flex items-center justify-end text-xs font-bold uppercase tracking-widest text-zinc-400">
                    Market Cap <SortIcon columnKey="marketCap" />
                  </div>
                </th>
                <th
                  className="p-4 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                  onClick={() => toggleSort('volume')}
                >
                  <div className="flex items-center justify-end text-xs font-bold uppercase tracking-widest text-zinc-400">
                    24h Vol <SortIcon columnKey="volume" />
                  </div>
                </th>
                <th className="p-4 text-right">
                  <div className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                    7D Trend
                  </div>
                </th>
                <th className="p-4 text-right">
                  <div className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                    Action
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              <AnimatePresence>
                {filteredAssets.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-zinc-500">
                      No assets found matching "{search}"
                    </td>
                  </tr>
                ) : (
                  filteredAssets.map((asset, idx) => {
                    const trend7dPositive =
                      typeof asset.change7d === 'number'
                        ? asset.change7d >= 0
                        : asset.sparkline7d && asset.sparkline7d.length >= 2
                        ? asset.sparkline7d[asset.sparkline7d.length - 1] >= asset.sparkline7d[0]
                        : asset.change >= 0;

                    return (
                      <motion.tr
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        key={asset.symbol}
                        className="hover:bg-zinc-900/30 transition-colors group"
                      >
                        <td className="p-4 font-mono text-xs text-zinc-500">
                          {asset.marketCapRank ?? idx + 1}
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-zinc-900 flex items-center justify-center font-bold text-sm text-yellow-500 shadow-inner border border-zinc-800 group-hover:border-yellow-500/30 transition-colors overflow-hidden shrink-0">
                              {asset.image ? (
                                <img
                                  src={asset.image}
                                  alt={asset.symbol}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                asset.symbol[0]
                              )}
                            </div>
                            <div>
                              <div className="font-bold text-zinc-100 text-sm">{asset.symbol}</div>
                              <div className="text-xs text-zinc-500">{asset.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <div className="font-mono text-zinc-100 font-bold text-sm">
                            ${formatPrice(asset.price)}
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <div
                            className={`inline-flex items-center justify-end gap-1 px-2 py-1 rounded-md text-xs font-mono font-bold ${
                              asset.change >= 0
                                ? 'text-green-500 bg-green-500/10'
                                : 'text-red-500 bg-red-500/10'
                            }`}
                          >
                            {asset.change >= 0 ? (
                              <TrendingUp className="h-3.5 w-3.5" />
                            ) : (
                              <TrendingDown className="h-3.5 w-3.5" />
                            )}
                            {asset.change >= 0 ? '+' : ''}
                            {asset.change.toFixed(2)}%
                          </div>
                        </td>
                        <td className="p-4 text-right font-mono text-xs text-zinc-300">
                          {formatMarketCap(asset.marketCap)}
                        </td>
                        <td className="p-4 text-right">
                          <div className="font-mono text-xs text-zinc-400">{asset.volume}</div>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Sparkline7d
                              prices={asset.sparkline7d}
                              positive={trend7dPositive}
                            />
                            {typeof asset.change7d === 'number' && (
                              <span
                                className={`text-[11px] font-mono font-bold min-w-[46px] text-right ${
                                  asset.change7d >= 0 ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {asset.change7d >= 0 ? '+' : ''}
                                {asset.change7d.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => onTrade?.(asset)}
                            className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors border border-zinc-700 hover:border-zinc-500"
                          >
                            Trade
                          </button>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
