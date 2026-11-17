import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Asset } from './AssetList';
import { formatPrice } from '@/lib/binance';
import {
  fetchCoinGeckoSimplePrices,
  resolveCoinGeckoId,
  CoinGeckoSimplePriceMap,
  SYMBOL_TO_COINGECKO_ID,
} from '@/lib/coingecko';
import {
  ArrowLeftRight,
  RefreshCw,
  Search,
  ChevronDown,
  Coins,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Check,
} from 'lucide-react';

interface CurrencyOption {
  symbol: string;
  name: string;
  isFiat?: boolean;
  fiatTag?: string;
  coingeckoId?: string;
  image?: string;
  fallbackUsdPrice?: number;
  change24h?: number;
}

interface CurrencyConverterProps {
  assets: Asset[];
  selectedAsset: Asset;
  onSelectAsset?: (asset: Asset) => void;
}

const DEFAULT_PHP_PER_USD = 58.45;
const QUICK_PICK_SYMBOLS = ['PHP', 'BTC', 'ETH', 'SOL', 'BNB', 'USDT', 'XRP'];

function formatConvertedAmount(value: number, isFiat: boolean): string {
  if (!isFinite(value) || isNaN(value) || value <= 0) return '0';
  if (isFiat) {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (value >= 1000) {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  }
  if (value >= 1) {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    });
  }
  if (value >= 0.0001) {
    return value.toFixed(6);
  }
  return value.toFixed(8);
}

function formatInputString(value: number, isFiat: boolean): string {
  if (!isFinite(value) || isNaN(value) || value <= 0) return '';
  if (isFiat) return value.toFixed(2);
  if (value >= 100) return value.toFixed(4).replace(/\.?0+$/, '');
  if (value >= 1) return value.toFixed(6).replace(/\.?0+$/, '');
  return value.toFixed(8).replace(/\.?0+$/, '');
}

export function CurrencyConverter({
  assets,
  selectedAsset,
  onSelectAsset,
}: CurrencyConverterProps) {
  const [fromSymbol, setFromSymbol] = useState<string>(() => selectedAsset?.symbol || 'BTC');
  const [toSymbol, setToSymbol] = useState<string>('PHP');
  const [rawAmount, setRawAmount] = useState<string>('1');
  const [activeEditedSide, setActiveEditedSide] = useState<'from' | 'to'>('from');

  const [simplePrices, setSimplePrices] = useState<CoinGeckoSimplePriceMap>({});
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState<string>('Live');

  const [openPicker, setOpenPicker] = useState<'from' | 'to' | null>(null);
  const [pickerSearch, setPickerSearch] = useState<string>('');
  const pickerRef = useRef<HTMLDivElement>(null);

  // Build unified list of Fiat (PHP, USD) + USDT + all CoinGecko Market Assets
  const currencyOptions: CurrencyOption[] = useMemo(() => {
    const baseOptions: CurrencyOption[] = [
      {
        symbol: 'PHP',
        name: 'Philippine Peso',
        isFiat: true,
        fiatTag: '₱',
      },
      {
        symbol: 'USD',
        name: 'US Dollar',
        isFiat: true,
        fiatTag: '$',
      },
      {
        symbol: 'USDT',
        name: 'Tether USD',
        coingeckoId: 'tether',
        fallbackUsdPrice: 1,
        change24h: 0,
      },
    ];

    const seen = new Set(baseOptions.map((o) => o.symbol));
    const cryptoOptions: CurrencyOption[] = [];

    assets.forEach((a) => {
      const sym = a.symbol.toUpperCase();
      if (seen.has(sym)) return;
      seen.add(sym);
      cryptoOptions.push({
        symbol: sym,
        name: a.name,
        coingeckoId: a.coingeckoId || SYMBOL_TO_COINGECKO_ID[sym],
        image: a.image,
        fallbackUsdPrice: a.price,
        change24h: a.change,
      });
    });

    return [...baseOptions, ...cryptoOptions];
  }, [assets]);

  const fromOption = useMemo(
    () => currencyOptions.find((o) => o.symbol === fromSymbol) || currencyOptions[0],
    [currencyOptions, fromSymbol]
  );

  const toOption = useMemo(
    () => currencyOptions.find((o) => o.symbol === toSymbol) || currencyOptions[0],
    [currencyOptions, toSymbol]
  );

  // Close dropdown on outside click
  useEffect(() => {
    if (!openPicker) return;
    const handleOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setOpenPicker(null);
        setPickerSearch('');
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [openPicker]);

  // Fetch live USD & PHP prices from CoinGecko /simple/price for active pair + tether
  const refreshCoinGeckoRates = useCallback(
    async (forceFresh: boolean = false) => {
      setIsRefreshing(true);
      try {
        const idsToFetch = new Set<string>(['tether', 'bitcoin', 'ethereum', 'solana', 'binancecoin']);

        const resolveOptId = async (opt: CurrencyOption) => {
          if (opt.isFiat) return;
          if (opt.coingeckoId) {
            idsToFetch.add(opt.coingeckoId);
            return;
          }
          const resolved = await resolveCoinGeckoId(opt.symbol);
          if (resolved) idsToFetch.add(resolved);
        };

        await Promise.all([resolveOptId(fromOption), resolveOptId(toOption)]);

        const data = await fetchCoinGeckoSimplePrices(Array.from(idsToFetch), forceFresh);
        if (Object.keys(data).length > 0) {
          setSimplePrices((prev) => ({ ...prev, ...data }));
          setLastUpdatedLabel(
            new Date().toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
          );
        }
      } finally {
        setIsRefreshing(false);
      }
    },
    [fromOption, toOption]
  );

  useEffect(() => {
    refreshCoinGeckoRates(false);
    const interval = setInterval(() => refreshCoinGeckoRates(false), 45_000);
    return () => clearInterval(interval);
  }, [refreshCoinGeckoRates]);

  // Derive live PHP per USD from CoinGecko tether.php / tether.usd
  const livePhpPerUsd = useMemo(() => {
    const tether = simplePrices['tether'];
    if (tether?.php && tether?.usd && tether.usd > 0) {
      return tether.php / tether.usd;
    }
    if (tether?.php && tether.php > 1) {
      return tether.php;
    }
    return DEFAULT_PHP_PER_USD;
  }, [simplePrices]);

  // Resolve live price of any currency option in PHP and USD
  const getRatesForOption = useCallback(
    (opt: CurrencyOption): { usd: number; php: number; change24h?: number } => {
      if (opt.symbol === 'PHP') {
        return { usd: 1 / livePhpPerUsd, php: 1, change24h: 0 };
      }
      if (opt.symbol === 'USD') {
        return { usd: 1, php: livePhpPerUsd, change24h: 0 };
      }

      const cgId = opt.coingeckoId || SYMBOL_TO_COINGECKO_ID[opt.symbol];
      const entry = cgId ? simplePrices[cgId] : undefined;

      const usd =
        typeof entry?.usd === 'number' && entry.usd > 0
          ? entry.usd
          : opt.fallbackUsdPrice || 0;

      const php =
        typeof entry?.php === 'number' && entry.php > 0
          ? entry.php
          : usd * livePhpPerUsd;

      const change24h =
        typeof entry?.usd_24h_change === 'number'
          ? entry.usd_24h_change
          : opt.change24h;

      return { usd, php, change24h };
    },
    [simplePrices, livePhpPerUsd]
  );

  const fromRates = useMemo(() => getRatesForOption(fromOption), [getRatesForOption, fromOption]);
  const toRates = useMemo(() => getRatesForOption(toOption), [getRatesForOption, toOption]);

  // Conversion multiplier: 1 fromSymbol = unitRate toSymbol
  const unitRate = useMemo(() => {
    if (fromOption.symbol === toOption.symbol) return 1;
    if (toOption.symbol === 'PHP') return fromRates.php;
    if (fromOption.symbol === 'PHP') {
      return toRates.php > 0 ? 1 / toRates.php : 0;
    }
    if (toRates.php > 0 && fromRates.php > 0) {
      return fromRates.php / toRates.php;
    }
    return toRates.usd > 0 ? fromRates.usd / toRates.usd : 0;
  }, [fromOption.symbol, toOption.symbol, fromRates, toRates]);

  const inverseRate = unitRate > 0 ? 1 / unitRate : 0;

  const parsedInput = useMemo(() => {
    const cleaned = rawAmount.replace(/,/g, '');
    const n = parseFloat(cleaned);
    return !isNaN(n) && n >= 0 ? n : 0;
  }, [rawAmount]);

  const fromNumeric = activeEditedSide === 'from' ? parsedInput : parsedInput * inverseRate;
  const toNumeric = activeEditedSide === 'to' ? parsedInput : parsedInput * unitRate;

  const fromInputDisplay =
    activeEditedSide === 'from'
      ? rawAmount
      : formatInputString(fromNumeric, Boolean(fromOption.isFiat));

  const toInputDisplay =
    activeEditedSide === 'to'
      ? rawAmount
      : formatInputString(toNumeric, Boolean(toOption.isFiat));

  const handleSwap = () => {
    const prevFrom = fromSymbol;
    const prevTo = toSymbol;
    setFromSymbol(prevTo);
    setToSymbol(prevFrom);
    setActiveEditedSide('from');
    if (toNumeric > 0) {
      setRawAmount(formatInputString(toNumeric, Boolean(toOption.isFiat)));
    }
  };

  const handleSyncActiveAsset = () => {
    if (!selectedAsset) return;
    const sym = selectedAsset.symbol.toUpperCase();
    if (toSymbol === sym) {
      setToSymbol(fromSymbol === sym ? 'PHP' : fromSymbol);
    }
    setFromSymbol(sym);
    setActiveEditedSide('from');
    setRawAmount('1');
  };

  // Preset buttons tailored to the active From currency
  const presetAmounts = useMemo(() => {
    if (fromOption.symbol === 'PHP') {
      return [1000, 5000, 10000, 50000, 100000];
    }
    if (fromOption.symbol === 'USD' || fromOption.symbol === 'USDT') {
      return [50, 100, 500, 1000, 5000];
    }
    if (fromRates.usd >= 10000) {
      return [0.05, 0.1, 0.5, 1, 2];
    }
    if (fromRates.usd >= 100) {
      return [0.5, 1, 5, 10, 25];
    }
    return [10, 50, 100, 500, 1000];
  }, [fromOption.symbol, fromRates.usd]);

  // Quick PHP cheat-sheet amounts for whichever side is crypto
  const referenceCryptoOption = useMemo(() => {
    if (!fromOption.isFiat) return fromOption;
    if (!toOption.isFiat) return toOption;
    return currencyOptions.find((o) => o.symbol === 'BTC') || fromOption;
  }, [fromOption, toOption, currencyOptions]);

  const refCryptoRates = useMemo(
    () => getRatesForOption(referenceCryptoOption),
    [getRatesForOption, referenceCryptoOption]
  );

  const filteredPickerOptions = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return currencyOptions;
    return currencyOptions.filter(
      (opt) =>
        opt.symbol.toLowerCase().includes(q) || opt.name.toLowerCase().includes(q)
    );
  }, [currencyOptions, pickerSearch]);

  const renderOptionBadge = (opt: CurrencyOption) => {
    if (opt.isFiat) {
      return (
        <div className="w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-black text-xs flex items-center justify-center shrink-0">
          {opt.fiatTag}
        </div>
      );
    }
    if (opt.image) {
      return (
        <img
          src={opt.image}
          alt={opt.symbol}
          className="w-6 h-6 rounded-full object-cover shrink-0 border border-zinc-800"
          loading="lazy"
        />
      );
    }
    return (
      <div className="w-6 h-6 rounded-full bg-zinc-800 text-yellow-500 font-bold text-[10px] flex items-center justify-center shrink-0">
        {opt.symbol[0]}
      </div>
    );
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800 text-zinc-100 p-4 sm:p-5 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-zinc-800/80">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="w-8 h-8 rounded-lg bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center text-yellow-500 shrink-0">
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-black uppercase tracking-wider text-zinc-100">
                Currency Converter
              </h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-bold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                CoinGecko Live
              </span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Instant crypto ↔ PHP &amp; cross-asset conversions · ₱{livePhpPerUsd.toFixed(2)}/USD
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {selectedAsset && fromSymbol !== selectedAsset.symbol && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSyncActiveAsset}
              className="h-7 px-2.5 text-[11px] font-bold border-yellow-500/30 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500"
            >
              <Sparkles className="w-3 h-3 mr-1" />
              Load {selectedAsset.symbol}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refreshCoinGeckoRates(true)}
            disabled={isRefreshing}
            className="h-7 px-2.5 text-[11px] font-mono border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
            title="Refresh live CoinGecko prices"
          >
            <RefreshCw className={`w-3 h-3 mr-1 text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{lastUpdatedLabel}</span>
          </Button>
        </div>
      </div>

      {/* Converter Inputs Grid */}
      <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch gap-3" ref={pickerRef}>
        {/* FROM Box */}
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 focus-within:border-yellow-500/50 transition-colors space-y-2.5 relative">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            <span>From</span>
            <span className="font-mono text-zinc-400">
              {fromOption.isFiat
                ? fromOption.name
                : `₱${formatPrice(fromRates.php)} · $${formatPrice(fromRates.usd)}`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPickerSearch('');
                setOpenPicker((prev) => (prev === 'from' ? null : 'from'));
              }}
              className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-yellow-500/40 transition-colors shrink-0"
            >
              {renderOptionBadge(fromOption)}
              <span className="font-black text-sm text-zinc-100">{fromOption.symbol}</span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            </button>

            <Input
              type="number"
              step="any"
              min="0"
              aria-label="Convert from amount"
              value={fromInputDisplay}
              onChange={(e) => {
                setActiveEditedSide('from');
                setRawAmount(e.target.value);
              }}
              placeholder="0.00"
              className="h-10 bg-transparent border-none text-right font-mono text-lg sm:text-xl font-black text-zinc-100 focus-visible:ring-0 px-1"
            />
          </div>

          {/* Searchable Picker Popover (From) */}
          {openPicker === 'from' && (
            <div className="absolute left-0 top-full mt-2 w-72 max-w-[90vw] bg-zinc-950 border border-zinc-700 rounded-xl shadow-2xl z-50 p-2 space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  autoFocus
                  placeholder="Search PHP, BTC, ETH, SOL..."
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  className="h-8 pl-8 bg-zinc-900 border-zinc-800 text-xs text-zinc-100"
                />
              </div>
              <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1">
                {filteredPickerOptions.map((opt) => (
                  <button
                    key={opt.symbol}
                    type="button"
                    onClick={() => {
                      if (opt.symbol === toSymbol) {
                        setToSymbol(fromSymbol);
                      }
                      setFromSymbol(opt.symbol);
                      setOpenPicker(null);
                      setPickerSearch('');
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                      opt.symbol === fromSymbol
                        ? 'bg-yellow-500/15 text-yellow-400'
                        : 'hover:bg-zinc-900 text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {renderOptionBadge(opt)}
                      <div className="truncate">
                        <div className="font-bold">{opt.symbol}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{opt.name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px] text-zinc-400">
                      {!opt.isFiat && opt.fallbackUsdPrice ? (
                        <span>${formatPrice(opt.fallbackUsdPrice)}</span>
                      ) : null}
                      {opt.symbol === fromSymbol && <Check className="w-3.5 h-3.5 text-yellow-500" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* SWAP Button */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            onClick={handleSwap}
            className="w-10 h-10 rounded-full bg-zinc-900 hover:bg-yellow-500 border border-zinc-700 hover:border-yellow-500 text-zinc-300 hover:text-black transition-all flex items-center justify-center shadow-lg active:scale-95"
            title="Swap Currencies"
            aria-label="Swap currencies"
          >
            <ArrowLeftRight className="w-4 h-4" />
          </button>
        </div>

        {/* TO Box */}
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 focus-within:border-emerald-500/50 transition-colors space-y-2.5 relative">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            <span>Converted To</span>
            <span className="font-mono text-zinc-400">
              {toOption.isFiat
                ? toOption.name
                : `₱${formatPrice(toRates.php)} · $${formatPrice(toRates.usd)}`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPickerSearch('');
                setOpenPicker((prev) => (prev === 'to' ? null : 'to'));
              }}
              className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-zinc-950 border border-zinc-800 hover:border-emerald-500/40 transition-colors shrink-0"
            >
              {renderOptionBadge(toOption)}
              <span className="font-black text-sm text-zinc-100">{toOption.symbol}</span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            </button>

            <Input
              type="number"
              step="any"
              min="0"
              aria-label="Convert to amount"
              value={toInputDisplay}
              onChange={(e) => {
                setActiveEditedSide('to');
                setRawAmount(e.target.value);
              }}
              placeholder="0.00"
              className="h-10 bg-transparent border-none text-right font-mono text-lg sm:text-xl font-black text-emerald-400 focus-visible:ring-0 px-1"
            />
          </div>

          {/* Searchable Picker Popover (To) */}
          {openPicker === 'to' && (
            <div className="absolute right-0 top-full mt-2 w-72 max-w-[90vw] bg-zinc-950 border border-zinc-700 rounded-xl shadow-2xl z-50 p-2 space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  autoFocus
                  placeholder="Search PHP, BTC, ETH, SOL..."
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  className="h-8 pl-8 bg-zinc-900 border-zinc-800 text-xs text-zinc-100"
                />
              </div>
              <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1">
                {filteredPickerOptions.map((opt) => (
                  <button
                    key={opt.symbol}
                    type="button"
                    onClick={() => {
                      if (opt.symbol === fromSymbol) {
                        setFromSymbol(toSymbol);
                      }
                      setToSymbol(opt.symbol);
                      setOpenPicker(null);
                      setPickerSearch('');
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                      opt.symbol === toSymbol
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'hover:bg-zinc-900 text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {renderOptionBadge(opt)}
                      <div className="truncate">
                        <div className="font-bold">{opt.symbol}</div>
                        <div className="text-[10px] text-zinc-500 truncate">{opt.name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 font-mono text-[11px] text-zinc-400">
                      {!opt.isFiat && opt.fallbackUsdPrice ? (
                        <span>${formatPrice(opt.fallbackUsdPrice)}</span>
                      ) : null}
                      {opt.symbol === toSymbol && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Presets & Popular Currency Chips */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mr-1">
            Quick Amount:
          </span>
          {presetAmounts.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setActiveEditedSide('from');
                setRawAmount(String(preset));
              }}
              className="px-2 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-yellow-500/40 text-[11px] font-mono font-bold text-zinc-300 transition-colors"
            >
              {fromOption.symbol === 'PHP'
                ? `₱${preset.toLocaleString()}`
                : fromOption.symbol === 'USD'
                ? `$${preset.toLocaleString()}`
                : `${preset} ${fromOption.symbol}`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {QUICK_PICK_SYMBOLS.map((sym) => (
            <button
              key={sym}
              type="button"
              onClick={() => {
                if (sym === 'PHP') {
                  if (fromSymbol === 'PHP') return;
                  setToSymbol('PHP');
                } else {
                  if (toSymbol === sym) setToSymbol('PHP');
                  setFromSymbol(sym);
                }
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors ${
                fromSymbol === sym || toSymbol === sym
                  ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-400'
                  : 'bg-zinc-900/60 border-zinc-800 text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {sym}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Bar + Live PHP Reference */}
      <div className="pt-3 border-t border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-zinc-400">
            1 <strong className="text-zinc-100">{fromOption.symbol}</strong> ={' '}
            <strong className="text-emerald-400">
              {toOption.fiatTag || ''}
              {formatConvertedAmount(unitRate, Boolean(toOption.isFiat))} {toOption.symbol}
            </strong>
          </span>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-500 text-[11px]">
            1 {toOption.symbol} = {fromOption.fiatTag || ''}
            {formatConvertedAmount(inverseRate, Boolean(fromOption.isFiat))} {fromOption.symbol}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {!referenceCryptoOption.isFiat && typeof refCryptoRates.change24h === 'number' && (
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                refCryptoRates.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {refCryptoRates.change24h >= 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {referenceCryptoOption.symbol} 24h: {refCryptoRates.change24h >= 0 ? '+' : ''}
              {refCryptoRates.change24h.toFixed(2)}%
            </span>
          )}

          {onSelectAsset &&
            !referenceCryptoOption.isFiat &&
            referenceCryptoOption.symbol !== selectedAsset?.symbol && (() => {
              const matched = assets.find((a) => a.symbol === referenceCryptoOption.symbol);
              if (!matched) return null;
              return (
                <button
                  type="button"
                  onClick={() => onSelectAsset(matched)}
                  className="text-[11px] font-sans font-bold text-yellow-500 hover:underline"
                >
                  Open {matched.symbol} Chart →
                </button>
              );
            })()}
        </div>
      </div>
    </Card>
  );
}
