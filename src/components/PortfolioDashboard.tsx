import React, { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { Asset } from './AssetList';
import { formatPrice } from '@/lib/binance';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  Calendar,
  SlidersHorizontal,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Check,
  Layers,
  FileSpreadsheet,
  Download,
  Calculator,
  Info,
  Sparkles,
} from 'lucide-react';
import { PortfolioRebalanceSimulator } from './PortfolioRebalanceSimulator';
import { auth } from '../lib/firebase';
import {
  SimulatedTrade,
  loadSimulatedTrades,
  subscribeSimulatedTrades,
} from '@/lib/simulatedTrades';
import {
  CostBasisMethod,
  TaxStatusFilter,
  computePhTaxSummary,
  downloadPhTaxCsv,
} from '@/lib/phTaxCsv';
import {
  fetchCoinGeckoMarketChart,
  fetchCoinGeckoPhpRate,
  CoinGeckoHistoricalPoint,
} from '@/lib/coingecko';

export interface PortfolioHolding {
  symbol: string;
  quantity: number;
}

const STORAGE_KEY_HOLDINGS = 'binanceph_portfolio_holdings_v1';
const PHP_EXCHANGE_RATE = 58.45;

const DEFAULT_HOLDINGS: PortfolioHolding[] = [
  { symbol: 'BTC', quantity: 0.42 },
  { symbol: 'BNB', quantity: 14.5 },
  { symbol: 'ETH', quantity: 3.2 },
  { symbol: 'SOL', quantity: 45.0 },
  { symbol: 'WCORE', quantity: 125000 },
  { symbol: 'USDT', quantity: 4850.0 },
];

function loadStoredHoldings(): PortfolioHolding[] {
  if (typeof window === 'undefined') return DEFAULT_HOLDINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_HOLDINGS);
    if (!raw) return DEFAULT_HOLDINGS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_HOLDINGS;
  } catch {
    return DEFAULT_HOLDINGS;
  }
}

function saveStoredHoldings(holdings: PortfolioHolding[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_HOLDINGS, JSON.stringify(holdings));
  } catch {}
}

export interface PortfolioHistoryPoint {
  date: string;
  fullDate: string;
  dayIndex: number;
  valueUsdt: number;
  valuePhp: number;
  dailyChangePct: number;
  btcPrice: number;
  bnbPrice: number;
}

interface PortfolioDashboardProps {
  assets: Asset[];
  compact?: boolean;
  onSelectAsset?: (asset: Asset) => void;
  onOpenFullDashboard?: () => void;
}

export function PortfolioDashboard({
  assets,
  compact = false,
  onSelectAsset,
  onOpenFullDashboard,
}: PortfolioDashboardProps) {
  const [holdings, setHoldings] = useState<PortfolioHolding[]>(() => loadStoredHoldings());
  const [currency, setCurrency] = useState<'USDT' | 'PHP'>('USDT');
  const [rangeDays, setRangeDays] = useState<7 | 14 | 30>(30);
  const [hideBalances, setHideBalances] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isEditingHoldings, setIsEditingHoldings] = useState(false);
  const [draftHoldings, setDraftHoldings] = useState<Record<string, string>>({});
  const [historicalSeries, setHistoricalSeries] = useState<
    Record<string, { byDate: Record<string, number>; points: CoinGeckoHistoricalPoint[] }>
  >({});
  const [livePhpRate, setLivePhpRate] = useState<number>(PHP_EXCHANGE_RATE);
  const [chartMode, setChartMode] = useState<'portfolio' | 'asset'>('portfolio');
  const [chartAssetSymbol, setChartAssetSymbol] = useState<string>('BTC');
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);

  // Philippine Crypto Tax CSV Export state
  const [showTaxPanel, setShowTaxPanel] = useState(!compact);
  const [simulatedTrades, setSimulatedTrades] = useState<SimulatedTrade[]>(() =>
    loadSimulatedTrades()
  );
  const [taxPhpRate, setTaxPhpRate] = useState<string>(String(PHP_EXCHANGE_RATE));
  const [taxPhpRateManuallyEdited, setTaxPhpRateManuallyEdited] = useState(false);
  const [costBasisMethod, setCostBasisMethod] = useState<CostBasisMethod>('FIFO');
  const [taxYear, setTaxYear] = useState<string>('ALL');
  const [taxStatusFilter, setTaxStatusFilter] = useState<TaxStatusFilter>('filled_only');
  const [lastDownloadedFile, setLastDownloadedFile] = useState<string | null>(null);

  // AI Portfolio Rebalance Simulation state
  const [showRebalancePanel, setShowRebalancePanel] = useState<boolean>(false);
  const [previousHoldings, setPreviousHoldings] = useState<PortfolioHolding[] | null>(null);

  useEffect(() => {
    saveStoredHoldings(holdings);
  }, [holdings]);

  useEffect(() => {
    return subscribeSimulatedTrades(() => {
      setSimulatedTrades(loadSimulatedTrades());
    });
  }, []);

  // Fetch live PHP/USDT conversion rate from CoinGecko
  useEffect(() => {
    let isMounted = true;
    fetchCoinGeckoPhpRate(PHP_EXCHANGE_RATE).then((rate) => {
      if (!isMounted) return;
      setLivePhpRate(rate);
      if (!taxPhpRateManuallyEdited) {
        setTaxPhpRate(rate.toFixed(2));
      }
    });
    return () => {
      isMounted = false;
    };
  }, [taxPhpRateManuallyEdited]);

  // Fetch 30-day daily historical prices from CoinGecko /coins/{id}/market_chart
  useEffect(() => {
    let isMounted = true;
    const baseSymbols = ['BTC', 'BNB', 'ETH', 'SOL'];
    const targetSymbols = Array.from(
      new Set([
        ...baseSymbols,
        ...(chartAssetSymbol && chartAssetSymbol !== 'USDT' && chartAssetSymbol !== 'WCORE'
          ? [chartAssetSymbol]
          : []),
      ])
    );

    const missingSymbols = targetSymbols.filter((sym) => !historicalSeries[sym]);
    if (missingSymbols.length === 0) {
      setIsLoadingHistory(false);
      return;
    }

    setIsLoadingHistory(true);
    Promise.all(
      missingSymbols.map(async (sym) => {
        const pts = await fetchCoinGeckoMarketChart(sym, 30, 'usd');
        return { sym, pts };
      })
    ).then((results) => {
      if (!isMounted) return;
      setHistoricalSeries((prev) => {
        const next = { ...prev };
        let changed = false;
        results.forEach(({ sym, pts }) => {
          if (pts.length >= 2) {
            const byDate: Record<string, number> = {};
            pts.forEach((p) => {
              byDate[p.dateKey] = p.price;
            });
            next[sym] = { byDate, points: pts };
            changed = true;
          }
        });
        return changed ? next : prev;
      });
      setIsLoadingHistory(false);
    });

    return () => {
      isMounted = false;
    };
  }, [chartAssetSymbol, historicalSeries]);

  const getLiveAssetPrice = (symbol: string): number => {
    if (symbol === 'USDT') return 1.0;
    const match = assets.find((a) => a.symbol === symbol);
    return match ? match.price : 0;
  };

  // Current live portfolio breakdown
  const allocation = useMemo(() => {
    const items = holdings.map((h) => {
      const price = getLiveAssetPrice(h.symbol);
      const assetObj = assets.find((a) => a.symbol === h.symbol);
      const change24h = h.symbol === 'USDT' ? 0 : assetObj?.change || 0;
      const valueUsdt = h.quantity * price;
      return {
        symbol: h.symbol,
        name: h.symbol === 'USDT' ? 'Tether USD' : assetObj?.name || h.symbol,
        quantity: h.quantity,
        price,
        change24h,
        valueUsdt,
        assetObj,
      };
    });

    const totalUsdt = items.reduce((acc, item) => acc + item.valueUsdt, 0);

    return items
      .map((item) => ({
        ...item,
        sharePct: totalUsdt > 0 ? (item.valueUsdt / totalUsdt) * 100 : 0,
      }))
      .sort((a, b) => b.valueUsdt - a.valueUsdt);
  }, [holdings, assets]);

  const currentTotalUsdt = useMemo(
    () => allocation.reduce((sum, item) => sum + item.valueUsdt, 0),
    [allocation]
  );

  // Helper to resolve CoinGecko historical price for a given day index & dateKey
  const getHistoricalPriceForDay = (
    symbol: string,
    dateKey: string,
    dayIndex: number,
    totalDays: number,
    livePrice: number
  ): number => {
    if (dayIndex === totalDays - 1) return livePrice;
    const entry = historicalSeries[symbol];
    if (entry) {
      if (entry.byDate[dateKey]) return entry.byDate[dateKey];
      const pts = entry.points;
      if (pts.length > 0) {
        const idx = Math.min(
          pts.length - 1,
          Math.max(0, pts.length - totalDays + dayIndex)
        );
        return pts[idx]?.price || livePrice;
      }
    }
    // Deterministic trajectory anchored to live price if CoinGecko series unavailable (e.g. WCORE)
    const seed = symbol.charCodeAt(0) * 13 + (symbol.charCodeAt(1) || 7);
    const progress = dayIndex / (totalDays - 1);
    const trendFactor = 0.88 + 0.12 * progress;
    const wave1 = Math.sin(dayIndex * 0.42 + seed) * 0.026 * (1 - progress * 0.25);
    const wave2 = Math.cos(dayIndex * 0.85 + seed * 0.5) * 0.014 * (1 - progress * 0.25);
    const multiplier = Math.max(0.65, trendFactor + wave1 + wave2);
    return livePrice * multiplier;
  };

  // Build 30-day daily portfolio valuation series (CoinGecko market_chart powered)
  const history30d: PortfolioHistoryPoint[] = useMemo(() => {
    const totalDays = 30;
    const now = new Date();
    const points: PortfolioHistoryPoint[] = [];

    for (let i = 0; i < totalDays; i++) {
      const daysAgo = totalDays - 1 - i;
      const d = new Date(now);
      d.setDate(now.getDate() - daysAgo);
      const dateKey = d.toISOString().slice(0, 10);

      const shortDate = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      const fullDate = d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      let dayTotalUsdt = 0;

      holdings.forEach((h) => {
        if (h.quantity <= 0) return;
        if (h.symbol === 'USDT') {
          dayTotalUsdt += h.quantity;
          return;
        }

        const livePrice = getLiveAssetPrice(h.symbol);
        const dayPrice = getHistoricalPriceForDay(h.symbol, dateKey, i, totalDays, livePrice);
        dayTotalUsdt += h.quantity * dayPrice;
      });

      const prevValue = i > 0 ? points[i - 1].valueUsdt : dayTotalUsdt;
      const dailyChangePct =
        prevValue > 0 ? ((dayTotalUsdt - prevValue) / prevValue) * 100 : 0;

      const btcLive = getLiveAssetPrice('BTC');
      const bnbLive = getLiveAssetPrice('BNB');
      const btcPrice = getHistoricalPriceForDay('BTC', dateKey, i, totalDays, btcLive);
      const bnbPrice = getHistoricalPriceForDay('BNB', dateKey, i, totalDays, bnbLive);

      points.push({
        date: shortDate,
        fullDate,
        dayIndex: i,
        valueUsdt: Number(dayTotalUsdt.toFixed(2)),
        valuePhp: Number((dayTotalUsdt * livePhpRate).toFixed(2)),
        dailyChangePct: Number(dailyChangePct.toFixed(2)),
        btcPrice,
        bnbPrice,
      });
    }

    return points;
  }, [holdings, assets, historicalSeries, livePhpRate]);

  // Build 30-day Asset Price History series for selected coin (CoinGecko market_chart)
  const assetHistory30d = useMemo(() => {
    const totalDays = 30;
    const now = new Date();
    const livePrice = getLiveAssetPrice(chartAssetSymbol) || 1;
    const points: Array<{
      date: string;
      fullDate: string;
      priceUsdt: number;
      pricePhp: number;
      dailyChangePct: number;
    }> = [];

    for (let i = 0; i < totalDays; i++) {
      const daysAgo = totalDays - 1 - i;
      const d = new Date(now);
      d.setDate(now.getDate() - daysAgo);
      const dateKey = d.toISOString().slice(0, 10);

      const shortDate = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      const fullDate = d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      const priceUsdt = getHistoricalPriceForDay(chartAssetSymbol, dateKey, i, totalDays, livePrice);
      const prev = i > 0 ? points[i - 1].priceUsdt : priceUsdt;
      const dailyChangePct = prev > 0 ? ((priceUsdt - prev) / prev) * 100 : 0;

      points.push({
        date: shortDate,
        fullDate,
        priceUsdt,
        pricePhp: priceUsdt * livePhpRate,
        dailyChangePct: Number(dailyChangePct.toFixed(2)),
      });
    }

    return points;
  }, [chartAssetSymbol, assets, historicalSeries, livePhpRate]);

  const visibleHistory = useMemo(
    () => history30d.slice(history30d.length - rangeDays),
    [history30d, rangeDays]
  );

  const visibleAssetHistory = useMemo(
    () => assetHistory30d.slice(assetHistory30d.length - rangeDays),
    [assetHistory30d, rangeDays]
  );

  const stats = useMemo(() => {
    if (visibleHistory.length === 0) {
      return {
        startVal: 0,
        endVal: 0,
        netPnl: 0,
        netPnlPct: 0,
        highVal: 0,
        lowVal: 0,
        isPositive: true,
      };
    }

    const rate = currency === 'PHP' ? livePhpRate : 1;
    const startVal = visibleHistory[0].valueUsdt * rate;
    const endVal = currentTotalUsdt * rate;
    const netPnl = endVal - startVal;
    const netPnlPct = startVal > 0 ? (netPnl / startVal) * 100 : 0;

    let highVal = endVal;
    let lowVal = endVal;
    visibleHistory.forEach((pt) => {
      const v = pt.valueUsdt * rate;
      if (v > highVal) highVal = v;
      if (v < lowVal) lowVal = v;
    });

    return {
      startVal,
      endVal,
      netPnl,
      netPnlPct,
      highVal,
      lowVal,
      isPositive: netPnl >= 0,
    };
  }, [visibleHistory, currentTotalUsdt, currency, livePhpRate]);

  const assetStats = useMemo(() => {
    if (visibleAssetHistory.length === 0) {
      return { startVal: 0, endVal: 0, deltaPct: 0, isPositive: true };
    }
    const key = currency === 'PHP' ? 'pricePhp' : 'priceUsdt';
    const startVal = visibleAssetHistory[0][key];
    const endVal = visibleAssetHistory[visibleAssetHistory.length - 1][key];
    const deltaPct = startVal > 0 ? ((endVal - startVal) / startVal) * 100 : 0;
    return { startVal, endVal, deltaPct, isPositive: deltaPct >= 0 };
  }, [visibleAssetHistory, currency]);

  const currencySymbol = currency === 'PHP' ? '₱' : '$';
  const dataKey = currency === 'PHP' ? 'valuePhp' : 'valueUsdt';
  const strokeColor = stats.isPositive ? '#F3BA2F' : '#EF4444';

  const formatMoney = (val: number) => {
    if (hideBalances) return '••••••••';
    return `${currencySymbol}${val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const openHoldingsEditor = () => {
    const init: Record<string, string> = {};
    holdings.forEach((h) => {
      init[h.symbol] = String(h.quantity);
    });
    setDraftHoldings(init);
    setIsEditingHoldings(true);
  };

  const saveHoldingsEditor = () => {
    const next: PortfolioHolding[] = holdings.map((h) => {
      const parsed = parseFloat(draftHoldings[h.symbol] ?? String(h.quantity));
      return {
        symbol: h.symbol,
        quantity: !isNaN(parsed) && parsed >= 0 ? parsed : h.quantity,
      };
    });
    setHoldings(next);
    setIsEditingHoldings(false);
  };

  const resetHoldingsToDefault = () => {
    setHoldings(DEFAULT_HOLDINGS);
    setPreviousHoldings(null);
    setIsEditingHoldings(false);
  };

  const handleApplySimulatedRebalance = (nextHoldings: PortfolioHolding[]) => {
    setPreviousHoldings(holdings);
    setHoldings(nextHoldings);
  };

  const handleUndoSimulatedRebalance = () => {
    if (!previousHoldings) return;
    setHoldings(previousHoldings);
    setPreviousHoldings(null);
  };

  // Compute Philippine Crypto Tax Summary from simulated trading history
  const parsedTaxPhpRate = useMemo(() => {
    const val = parseFloat(taxPhpRate);
    return !isNaN(val) && val > 0 ? val : livePhpRate;
  }, [taxPhpRate, livePhpRate]);

  const phTaxOptions = useMemo(
    () => ({
      phpRate: parsedTaxPhpRate,
      costBasisMethod,
      taxYear,
      statusFilter: taxStatusFilter,
    }),
    [parsedTaxPhpRate, costBasisMethod, taxYear, taxStatusFilter]
  );

  const phTaxSummary = useMemo(
    () => computePhTaxSummary(simulatedTrades, phTaxOptions),
    [simulatedTrades, phTaxOptions]
  );

  const formatPhp = (val: number) => {
    if (hideBalances) return '••••••••';
    const abs = Math.abs(val).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${val < 0 ? '-' : ''}₱${abs}`;
  };

  const handleDownloadTaxCsv = () => {
    const currentUser = auth.currentUser;
    const accountLabel = currentUser
      ? `${currentUser.displayName || 'Trader'} (${currentUser.email || currentUser.uid})`
      : 'BINANCEPH Demo / Preview Account';
    const filename = downloadPhTaxCsv(phTaxSummary, phTaxOptions, accountLabel);
    setLastDownloadedFile(filename);
    setTimeout(() => setLastDownloadedFile(null), 4500);
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800 text-zinc-100 overflow-hidden shadow-xl">
      {/* Top Portfolio Header */}
      <div className="p-4 sm:p-6 border-b border-zinc-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-gradient-to-r from-zinc-950 via-zinc-900/50 to-zinc-950">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="w-8 h-8 rounded-lg bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center text-yellow-500">
              <Wallet className="w-4 h-4" />
            </div>
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">
              Estimated Portfolio Value ({rangeDays}D Performance)
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              CoinGecko API · ₱{livePhpRate.toFixed(2)}/USDT
            </span>
            <button
              type="button"
              onClick={() => setHideBalances(!hideBalances)}
              className="text-zinc-500 hover:text-zinc-300 p-1 rounded transition-colors"
              title={hideBalances ? 'Show Portfolio Balances' : 'Hide Portfolio Balances'}
            >
              {hideBalances ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-2xl sm:text-3xl font-black font-mono tracking-tight text-zinc-100 tabular-nums">
              {formatMoney(stats.endVal)}
            </h2>
            <span className="text-xs font-mono text-zinc-500">{currency}</span>

            <div
              className={`flex items-center gap-1 text-xs font-mono font-bold ${
                stats.isPositive ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {stats.isPositive ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              <span>
                {hideBalances
                  ? '••••'
                  : `${stats.isPositive ? '+' : '-'}${currencySymbol}${Math.abs(
                      stats.netPnl
                    ).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} (${stats.isPositive ? '+' : ''}${stats.netPnlPct.toFixed(2)}%)`}
              </span>
              <span className="text-zinc-500 font-sans font-normal ml-1">
                past {rangeDays}d
              </span>
            </div>
          </div>
        </div>

        {/* Right Controls: Range Selector, Currency Toggle, Customize Holdings, Collapse */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Timeframe Selector */}
          <div className="flex items-center bg-zinc-900 p-1 rounded-lg border border-zinc-800">
            {([7, 14, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setRangeDays(d)}
                className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-colors ${
                  rangeDays === d
                    ? 'bg-yellow-500 text-black'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {d}D
              </button>
            ))}
          </div>

          {/* Currency Switcher */}
          <div className="flex items-center bg-zinc-900 p-1 rounded-lg border border-zinc-800">
            {(['USDT', 'PHP'] as const).map((curr) => (
              <button
                key={curr}
                type="button"
                onClick={() => setCurrency(curr)}
                className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-colors ${
                  currency === curr
                    ? 'bg-zinc-800 text-yellow-500 border border-yellow-500/30'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {curr === 'USDT' ? '$ USDT' : '₱ PHP'}
              </button>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              isEditingHoldings ? setIsEditingHoldings(false) : openHoldingsEditor()
            }
            className="border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 h-8 px-3 text-xs font-bold"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 text-yellow-500" />
            <span>{isEditingHoldings ? 'Close Editor' : 'Edit Holdings'}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowRebalancePanel((prev) => !prev)}
            className={`h-8 px-3 text-xs font-bold transition-colors ${
              showRebalancePanel
                ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
                : 'border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300'
            }`}
            title="Simulate AI Portfolio Rebalance Strategy with Gemini"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
            <span>AI Rebalance</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowTaxPanel((prev) => !prev)}
            className={`h-8 px-3 text-xs font-bold transition-colors ${
              showTaxPanel
                ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-200'
            }`}
            title="Generate Philippine Crypto Tax Summary CSV from Simulated Trades"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
            <span>PH Tax CSV</span>
          </Button>

          {compact && onOpenFullDashboard && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenFullDashboard}
              className="border-yellow-500/30 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 h-8 px-3 text-xs font-bold"
            >
              <Layers className="w-3.5 h-3.5 mr-1.5" />
              <span>Full Analytics</span>
            </Button>
          )}

          {compact && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-zinc-400 hover:text-zinc-100 h-8 px-2"
              title={isCollapsed ? 'Expand Chart' : 'Collapse Chart'}
            >
              {isCollapsed ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Inline Holdings Customizer */}
      {isEditingHoldings && (
        <div className="p-4 sm:p-5 bg-zinc-900/60 border-b border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-yellow-500">
              Customize Portfolio Asset Quantities
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetHoldingsToDefault}
                className="h-7 px-2.5 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                Reset Default
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={saveHoldingsEditor}
                className="h-7 px-3 text-xs bg-yellow-500 hover:bg-yellow-600 text-black font-bold"
              >
                <Check className="w-3.5 h-3.5 mr-1" />
                Apply Holdings
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {holdings.map((h) => {
              const livePrice = getLiveAssetPrice(h.symbol);
              return (
                <div
                  key={h.symbol}
                  className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-black text-zinc-100">{h.symbol}</span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      ${formatPrice(livePrice)}
                    </span>
                  </div>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    value={draftHoldings[h.symbol] ?? String(h.quantity)}
                    onChange={(e) =>
                      setDraftHoldings((prev) => ({
                        ...prev,
                        [h.symbol]: e.target.value,
                      }))
                    }
                    className="h-8 bg-zinc-900 border-zinc-800 font-mono text-xs text-zinc-100"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Philippine Crypto Tax CSV Summary Generator */}
      {showTaxPanel && (
        <div className="p-4 sm:p-6 bg-zinc-900/45 border-b border-zinc-800 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Calculator className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-sm font-black uppercase tracking-wider text-zinc-100">
                  Philippine Crypto Tax Summary (BIR Prep)
                </h3>
                <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                  Simulated History · PHP (₱)
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Export your simulated trading history converted to Philippine Pesos (PHT / UTC+8) with {costBasisMethod} cost-basis &amp; realized gain/loss calculations.
              </p>
            </div>

            {/* Export Controls */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Cost Basis Method */}
              <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                {(['FIFO', 'AVERAGE'] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setCostBasisMethod(method)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-colors ${
                      costBasisMethod === method
                        ? 'bg-zinc-800 text-yellow-500 border border-yellow-500/30'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {method === 'FIFO' ? 'FIFO' : 'Avg Cost'}
                  </button>
                ))}
              </div>

              {/* Status Filter */}
              <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                <button
                  type="button"
                  onClick={() => setTaxStatusFilter('filled_only')}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors ${
                    taxStatusFilter === 'filled_only'
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Filled Only
                </button>
                <button
                  type="button"
                  onClick={() => setTaxStatusFilter('all')}
                  className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors ${
                    taxStatusFilter === 'all'
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  All Orders
                </button>
              </div>

              {/* Year Filter */}
              <select
                aria-label="Tax Year Filter"
                value={taxYear}
                onChange={(e) => setTaxYear(e.target.value)}
                className="h-8 px-2.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono font-bold text-zinc-200 focus:outline-none focus:border-yellow-500/50"
              >
                <option value="ALL">All Years</option>
                {phTaxSummary.availableYears.map((yr) => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>

              {/* Editable PHP/USDT FX Rate */}
              <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 h-8">
                <span className="text-[10px] font-bold uppercase text-zinc-500">
                  ₱/USDT
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  aria-label="PHP per USDT Exchange Rate"
                  value={taxPhpRate}
                  onChange={(e) => {
                    setTaxPhpRateManuallyEdited(true);
                    setTaxPhpRate(e.target.value);
                  }}
                  className="w-14 bg-transparent text-xs font-mono font-bold text-yellow-500 focus:outline-none text-right"
                />
              </div>

              {/* Primary Download CSV Button */}
              <Button
                type="button"
                size="sm"
                onClick={handleDownloadTaxCsv}
                disabled={phTaxSummary.rows.length === 0}
                className="h-8 px-3.5 bg-emerald-500 hover:bg-emerald-600 text-black font-black text-xs shadow-lg shadow-emerald-950/40"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                <span>Download Tax CSV</span>
              </Button>
            </div>
          </div>

          {lastDownloadedFile && (
            <div className="px-3.5 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-mono flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                Exported <strong className="text-emerald-300">{lastDownloadedFile}</strong> ({phTaxSummary.rows.length} rows)
              </span>
            </div>
          )}

          {/* 4 Tax Summary KPIs in PHP */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-zinc-950/90 border border-zinc-800 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                Acquisitions ({phTaxSummary.filledBuyCount} Buys)
              </span>
              <span className="text-sm sm:text-base font-mono font-bold text-zinc-100 tabular-nums">
                {formatPhp(phTaxSummary.totalAcquisitionsPhp)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/90 border border-zinc-800 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                Disposal Proceeds ({phTaxSummary.filledSellCount} Sells)
              </span>
              <span className="text-sm sm:text-base font-mono font-bold text-zinc-100 tabular-nums">
                {formatPhp(phTaxSummary.totalDisposalsProceedsPhp)}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/90 border border-zinc-800 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                Cost Basis &amp; Fees ({costBasisMethod})
              </span>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm sm:text-base font-mono font-bold text-zinc-200 tabular-nums">
                  {formatPhp(phTaxSummary.totalDisposalsCostBasisPhp)}
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  Fees: {formatPhp(phTaxSummary.totalFeesPhp)}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/90 border border-zinc-800 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                Est. Net Realized Gain / Loss
              </span>
              <span
                className={`text-sm sm:text-base font-mono font-black tabular-nums ${
                  phTaxSummary.netRealizedGainLossPhp >= 0
                    ? 'text-emerald-400'
                    : 'text-red-400'
                }`}
              >
                {phTaxSummary.netRealizedGainLossPhp >= 0 && !hideBalances ? '+' : ''}
                {formatPhp(phTaxSummary.netRealizedGainLossPhp)}
              </span>
            </div>
          </div>

          {/* Preview Table of Exportable Tax Rows */}
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/80 max-h-[240px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-zinc-950 sticky top-0 border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="py-2 px-3">ID / Time (PHT)</th>
                  <th className="py-2 px-3">Pair</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3 text-right">Qty</th>
                  <th className="py-2 px-3 text-right">Gross (PHP)</th>
                  <th className="py-2 px-3 text-right">Fee (PHP)</th>
                  <th className="py-2 px-3 text-right">Cost Basis (PHP)</th>
                  <th className="py-2 px-3 text-right">Realized G/L (PHP)</th>
                  <th className="py-2 px-3">Tax Event</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                {phTaxSummary.rows.map((row) => (
                  <tr key={row.tradeId} className="hover:bg-zinc-900/60 transition-colors">
                    <td className="py-2 px-3">
                      <div className="text-zinc-200 font-bold text-[11px]">{row.tradeId}</div>
                      <div className="text-zinc-500 text-[10px]">{row.dateTimePht}</div>
                    </td>
                    <td className="py-2 px-3 font-sans font-bold text-zinc-200">
                      {row.pair}
                      <span className="ml-1.5 text-[10px] font-mono text-zinc-500">
                        {row.orderType}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          row.side === 'Buy'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        {row.side}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-zinc-300 tabular-nums">
                      {row.quantity}
                    </td>
                    <td className="py-2 px-3 text-right text-zinc-200 tabular-nums">
                      {formatPhp(row.grossTotalPhp)}
                    </td>
                    <td className="py-2 px-3 text-right text-zinc-400 tabular-nums">
                      {formatPhp(row.feePhp)}
                    </td>
                    <td className="py-2 px-3 text-right text-zinc-300 tabular-nums">
                      {row.status === 'Filled' ? formatPhp(row.costBasisPhp) : '—'}
                    </td>
                    <td
                      className={`py-2 px-3 text-right font-bold tabular-nums ${
                        row.status !== 'Filled' || row.side === 'Buy'
                          ? 'text-zinc-500'
                          : row.realizedGainLossPhp >= 0
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      {row.status === 'Filled' && row.side === 'Sell'
                        ? `${row.realizedGainLossPhp >= 0 && !hideBalances ? '+' : ''}${formatPhp(
                            row.realizedGainLossPhp
                          )}`
                        : '—'}
                    </td>
                    <td className="py-2 px-3 font-sans text-[11px] text-zinc-400">
                      {row.taxClassification}
                    </td>
                  </tr>
                ))}

                {phTaxSummary.rows.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-zinc-500 font-sans">
                      No simulated trades match the selected tax year and order status filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-start gap-2 text-[11px] text-zinc-500 bg-zinc-950/60 border border-zinc-800/80 rounded-xl px-3.5 py-2.5">
            <Info className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-0.5" />
            <span>
              <strong>BIR Preparation Aid:</strong> Values are computed from your <strong>simulated</strong> BINANCEPH trading history using Asia/Manila (PHT) timestamps and ₱{parsedTaxPhpRate.toFixed(2)}/USDT. This CSV is for informational calculation only and does not constitute official BIR tax, accounting, or legal advice.
            </span>
          </div>
        </div>
      )}

      {/* AI Portfolio Rebalance Simulator (Gemini) */}
      {showRebalancePanel && (
        <PortfolioRebalanceSimulator
          allocation={allocation}
          assets={assets}
          totalValueUsdt={currentTotalUsdt}
          phpRate={livePhpRate}
          currency={currency}
          hideBalances={hideBalances}
          onApplyRebalance={handleApplySimulatedRebalance}
          hasPendingUndo={previousHoldings !== null}
          onUndoRebalance={handleUndoSimulatedRebalance}
        />
      )}

      {/* Collapsible Body */}
      {!isCollapsed && (
        <div className="p-4 sm:p-6 space-y-6">
          {/* 4 Summary KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                {rangeDays}D Starting Balance
              </span>
              <span className="text-sm sm:text-base font-mono font-bold text-zinc-200 tabular-nums">
                {formatMoney(stats.startVal)}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                {rangeDays}D Peak Valuation
              </span>
              <span className="text-sm sm:text-base font-mono font-bold text-emerald-400 tabular-nums">
                {formatMoney(stats.highVal)}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                {rangeDays}D Low Valuation
              </span>
              <span className="text-sm sm:text-base font-mono font-bold text-zinc-300 tabular-nums">
                {formatMoney(stats.lowVal)}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                Top Portfolio Holding
              </span>
              <div className="flex items-center justify-between">
                <span className="text-sm sm:text-base font-black text-yellow-500">
                  {allocation[0]?.symbol || 'BTC'}
                </span>
                <span className="text-xs font-mono text-zinc-400 tabular-nums">
                  {allocation[0] ? `${allocation[0].sharePct.toFixed(1)}% share` : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Recharts 30-Day Historical Performance / CoinGecko Price Chart Widget */}
          <div className="bg-zinc-900/20 border border-zinc-900 rounded-2xl p-3 sm:p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setChartMode('portfolio')}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors ${
                      chartMode === 'portfolio'
                        ? 'bg-yellow-500 text-black'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Portfolio Performance ({rangeDays}D)
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode('asset')}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold transition-colors ${
                      chartMode === 'asset'
                        ? 'bg-emerald-500 text-black'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Historical Coin Price ({rangeDays}D)
                  </button>
                </div>

                {chartMode === 'asset' && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE'].map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => setChartAssetSymbol(sym)}
                        className={`px-2 py-1 rounded text-[11px] font-mono font-bold border transition-colors ${
                          chartAssetSymbol === sym
                            ? 'bg-zinc-800 border-emerald-500/50 text-emerald-400'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400">
                {chartMode === 'asset' && (
                  <span className={assetStats.isPositive ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                    {chartAssetSymbol}: {currencySymbol}
                    {formatPrice(assetStats.endVal)} ({assetStats.isPositive ? '+' : ''}
                    {assetStats.deltaPct.toFixed(2)}% / {rangeDays}d)
                  </span>
                )}
                <span className="text-zinc-500">
                  {isLoadingHistory ? 'Syncing CoinGecko…' : 'Source: CoinGecko /market_chart'}
                </span>
              </div>
            </div>

            <div className="w-full h-[240px] sm:h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === 'portfolio' ? (
                  <AreaChart
                    data={visibleHistory}
                    margin={{ top: 10, right: 12, left: 4, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="portfolioValueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={strokeColor} stopOpacity={0.35} />
                        <stop offset="60%" stopColor={strokeColor} stopOpacity={0.1} />
                        <stop offset="95%" stopColor={strokeColor} stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#27272a"
                      opacity={0.6}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="#71717a"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      stroke="#71717a"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={78}
                      domain={['auto', 'auto']}
                      tickFormatter={(value: number) => {
                        if (hideBalances) return '•••';
                        if (value >= 1_000_000) {
                          return `${currencySymbol}${(value / 1_000_000).toFixed(2)}M`;
                        }
                        if (value >= 1_000) {
                          return `${currencySymbol}${(value / 1_000).toFixed(1)}k`;
                        }
                        return `${currencySymbol}${value.toFixed(0)}`;
                      }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const point = payload[0].payload as PortfolioHistoryPoint;
                        const val = currency === 'PHP' ? point.valuePhp : point.valueUsdt;
                        const isDayPos = point.dailyChangePct >= 0;

                        return (
                          <div className="bg-zinc-950/95 border border-zinc-800 rounded-xl p-3.5 shadow-2xl backdrop-blur-md space-y-1.5 min-w-[210px]">
                            <div className="flex items-center justify-between text-[11px] text-zinc-400">
                              <span className="flex items-center gap-1.5">
                                <Calendar className="w-3 h-3 text-yellow-500" />
                                {point.fullDate}
                              </span>
                            </div>
                            <div className="text-base font-black font-mono text-zinc-100 tabular-nums">
                              {hideBalances
                                ? '••••••••'
                                : `${currencySymbol}${val.toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })} ${currency}`}
                            </div>
                            <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-zinc-800/80">
                              <span className="text-zinc-500">24h Delta:</span>
                              <span
                                className={`font-bold ${
                                  isDayPos ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {isDayPos ? '+' : ''}
                                {point.dailyChangePct.toFixed(2)}%
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                              <span>BTC: ${formatPrice(point.btcPrice)}</span>
                              <span>BNB: ${formatPrice(point.bnbPrice)}</span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine
                      y={stats.startVal}
                      stroke="#52525b"
                      strokeDasharray="4 4"
                      ifOverflow="extendDomain"
                    />
                    <Area
                      type="monotone"
                      dataKey={dataKey}
                      stroke={strokeColor}
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#portfolioValueGradient)"
                      animationDuration={600}
                    />
                  </AreaChart>
                ) : (
                  <AreaChart
                    data={visibleAssetHistory}
                    margin={{ top: 10, right: 12, left: 4, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="assetHistoryGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={assetStats.isPositive ? '#10B981' : '#EF4444'} stopOpacity={0.35} />
                        <stop offset="60%" stopColor={assetStats.isPositive ? '#10B981' : '#EF4444'} stopOpacity={0.1} />
                        <stop offset="95%" stopColor={assetStats.isPositive ? '#10B981' : '#EF4444'} stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#27272a"
                      opacity={0.6}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="#71717a"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      stroke="#71717a"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={78}
                      domain={['auto', 'auto']}
                      tickFormatter={(value: number) => `${currencySymbol}${formatPrice(value)}`}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const point = payload[0].payload as {
                          fullDate: string;
                          priceUsdt: number;
                          pricePhp: number;
                          dailyChangePct: number;
                        };
                        const val = currency === 'PHP' ? point.pricePhp : point.priceUsdt;
                        const isDayPos = point.dailyChangePct >= 0;

                        return (
                          <div className="bg-zinc-950/95 border border-zinc-800 rounded-xl p-3.5 shadow-2xl backdrop-blur-md space-y-1.5 min-w-[205px]">
                            <div className="flex items-center justify-between text-[11px] text-zinc-400">
                              <span className="flex items-center gap-1.5">
                                <Calendar className="w-3 h-3 text-emerald-400" />
                                {point.fullDate}
                              </span>
                            </div>
                            <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                              {chartAssetSymbol} Historical Price
                            </div>
                            <div className="text-base font-black font-mono text-zinc-100 tabular-nums">
                              {currencySymbol}{formatPrice(val)} {currency}
                            </div>
                            <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-zinc-800/80">
                              <span className="text-zinc-500">24h Delta:</span>
                              <span className={`font-bold ${isDayPos ? 'text-emerald-400' : 'text-red-400'}`}>
                                {isDayPos ? '+' : ''}{point.dailyChangePct.toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine
                      y={assetStats.startVal}
                      stroke="#52525b"
                      strokeDasharray="4 4"
                      ifOverflow="extendDomain"
                    />
                    <Area
                      type="monotone"
                      dataKey={currency === 'PHP' ? 'pricePhp' : 'priceUsdt'}
                      stroke={assetStats.isPositive ? '#10B981' : '#EF4444'}
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#assetHistoryGradient)"
                      animationDuration={600}
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>

          {/* Asset Allocation Bar & Interactive Holdings Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-zinc-400">
                Portfolio Allocation Breakdown
              </span>
              <span className="font-mono text-zinc-500">
                Live CoinGecko Spot Valuation
              </span>
            </div>

            {/* Segmented Progress Bar */}
            <div className="w-full h-2.5 rounded-full bg-zinc-900 overflow-hidden flex gap-0.5 p-0.5 border border-zinc-800">
              {allocation.map((item, idx) => {
                const colors = [
                  'bg-yellow-500',
                  'bg-emerald-500',
                  'bg-sky-500',
                  'bg-purple-500',
                  'bg-amber-400',
                  'bg-zinc-500',
                ];
                return (
                  <div
                    key={item.symbol}
                    style={{ width: `${Math.max(item.sharePct, 2)}%` }}
                    className={`h-full first:rounded-l-full last:rounded-r-full ${
                      colors[idx % colors.length]
                    }`}
                    title={`${item.symbol}: ${item.sharePct.toFixed(1)}%`}
                  />
                );
              })}
            </div>

            {/* Holdings Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
              {allocation.map((item) => {
                const rate = currency === 'PHP' ? livePhpRate : 1;
                const displayVal = item.valueUsdt * rate;

                return (
                  <div
                    key={item.symbol}
                    onClick={() => {
                      if (item.assetObj && onSelectAsset) {
                        onSelectAsset(item.assetObj);
                      }
                    }}
                    className={`p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/80 hover:border-yellow-500/40 transition-all space-y-1.5 ${
                      item.assetObj && onSelectAsset ? 'cursor-pointer group' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-black text-zinc-100 group-hover:text-yellow-500 transition-colors">
                          {item.symbol}
                        </span>
                        <span className="text-[10px] font-mono text-zinc-500">
                          {item.sharePct.toFixed(1)}%
                        </span>
                      </div>
                      {item.assetObj && onSelectAsset && (
                        <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-yellow-500 transition-colors" />
                      )}
                    </div>

                    <div className="text-xs font-mono font-bold text-zinc-200 tabular-nums truncate">
                      {formatMoney(displayVal)}
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500">
                      <span>
                        {hideBalances
                          ? '•••'
                          : `${item.quantity.toLocaleString('en-US', {
                              maximumFractionDigits: 4,
                            })} ${item.symbol}`}
                      </span>
                      <span
                        className={
                          item.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                        }
                      >
                        {item.change24h >= 0 ? '+' : ''}
                        {item.change24h.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detailed 30-Day Daily Log Table when in Full Dashboard tab */}
          {!compact && (
            <div className="pt-4 border-t border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
                  30-Day Daily Valuation Ledger
                </h3>
                <span className="text-xs font-mono text-zinc-500">
                  Showing last {visibleHistory.length} trading days
                </span>
              </div>

              <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30 max-h-[320px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-zinc-950 sticky top-0 border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4 text-right">Portfolio Value ({currency})</th>
                      <th className="py-2.5 px-4 text-right">24h Change</th>
                      <th className="py-2.5 px-4 text-right">BTC Benchmark</th>
                      <th className="py-2.5 px-4 text-right">BNB Benchmark</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 font-mono">
                    {[...visibleHistory].reverse().map((row) => {
                      const val = currency === 'PHP' ? row.valuePhp : row.valueUsdt;
                      const pos = row.dailyChangePct >= 0;
                      return (
                        <tr
                          key={row.fullDate}
                          className="hover:bg-zinc-900/60 transition-colors"
                        >
                          <td className="py-2.5 px-4 font-sans font-medium text-zinc-300">
                            {row.fullDate}
                          </td>
                          <td className="py-2.5 px-4 text-right font-bold text-zinc-100 tabular-nums">
                            {formatMoney(val)}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-bold tabular-nums ${
                              pos ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            {pos ? '+' : ''}
                            {row.dailyChangePct.toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-4 text-right text-zinc-400 tabular-nums">
                            ${formatPrice(row.btcPrice)}
                          </td>
                          <td className="py-2.5 px-4 text-right text-zinc-400 tabular-nums">
                            ${formatPrice(row.bnbPrice)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
