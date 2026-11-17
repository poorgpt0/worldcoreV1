import { Asset, INITIAL_FALLBACK_ASSETS, formatVolume } from './binance';

export interface CoinGeckoMarketItem {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number | null;
  total_volume: number;
  high_24h: number | null;
  low_24h: number | null;
  price_change_percentage_24h: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  ath: number | null;
  sparkline_in_7d?: {
    price: number[];
  };
}

export interface CoinGeckoHistoricalPoint {
  timestamp: number;
  dateKey: string; // YYYY-MM-DD
  price: number;
}

export interface CoinGeckoTrendingCoin {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number | null;
  thumb: string;
  priceUsd?: number;
  change24hPct?: number;
}

// Verified canonical CoinGecko IDs mapped from symbol
export const SYMBOL_TO_COINGECKO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  SUI: 'sui',
  PEPE: 'pepe',
  SHIB: 'shiba-inu',
  NEAR: 'near',
  DOT: 'polkadot',
  LTC: 'litecoin',
  TRX: 'tron',
  TON: 'the-open-network',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  RENDER: 'render-token',
  INJ: 'injective-protocol',
  POL: 'polygon-ecosystem-token',
  MATIC: 'polygon-ecosystem-token',
  UNI: 'uniswap',
  USDT: 'tether',
  USDC: 'usd-coin',
  BCH: 'bitcoin-cash',
  ATOM: 'cosmos',
  XLM: 'stellar',
  FIL: 'filecoin',
  HBAR: 'hedera-hashgraph',
  AAVE: 'aave',
  KAS: 'kaspa',
};

const resolvedIdCache = new Map<string, string>(
  Object.entries(SYMBOL_TO_COINGECKO_ID)
);

/**
 * Resolves a symbol to its CoinGecko ID via known canonical map or /api/coingecko/search
 */
export async function resolveCoinGeckoId(symbol: string): Promise<string | null> {
  const upper = symbol.trim().toUpperCase();
  const cached = resolvedIdCache.get(upper);
  if (cached) return cached;

  try {
    const res = await fetch(`/api/coingecko/search?query=${encodeURIComponent(upper)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const coins = Array.isArray(data?.coins) ? data.coins : [];
    const exactMatch = coins.find(
      (c: any) => typeof c?.symbol === 'string' && c.symbol.toUpperCase() === upper
    );
    const chosen = exactMatch || coins[0];
    if (chosen?.id) {
      resolvedIdCache.set(upper, chosen.id);
      return chosen.id;
    }
    return null;
  } catch {
    return null;
  }
}

const clientResponseCache = new Map<string, { data: any; expiresAt: number }>();
const inflightRequests = new Map<string, Promise<any>>();

async function cachedFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = clientResponseCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const inflight = inflightRequests.get(key);
  if (inflight) {
    return inflight as Promise<T>;
  }

  const promise = fetcher()
    .then((result) => {
      clientResponseCache.set(key, { data: result, expiresAt: Date.now() + ttlMs });
      inflightRequests.delete(key);
      return result;
    })
    .catch((err) => {
      inflightRequests.delete(key);
      if (cached) return cached.data as T;
      throw err;
    });

  inflightRequests.set(key, promise);
  return promise;
}

/**
 * Fetches top cryptocurrency market data from CoinGecko via server proxy
 */
export async function fetchCoinGeckoMarkets(perPage: number = 100): Promise<Asset[]> {
  return cachedFetch(`markets:${perPage}`, 35_000, async () => {
    try {
      const res = await fetch(
        `/api/coingecko/markets?vs_currency=usd&per_page=${perPage}&page=1&sparkline=true`
      );
      if (!res.ok) {
        throw new Error(`CoinGecko markets HTTP ${res.status}`);
      }
      const rows: CoinGeckoMarketItem[] = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        return INITIAL_FALLBACK_ASSETS;
      }

      const mapped: Asset[] = rows
        .filter((item) => item.symbol && item.current_price > 0)
        .map((item) => {
          const sym = item.symbol.toUpperCase();
          resolvedIdCache.set(sym, item.id);
          return {
            symbol: sym,
            name: item.name,
            price: item.current_price,
            change: item.price_change_percentage_24h ?? 0,
            volume: formatVolume(item.total_volume || 0),
            high24h: item.high_24h ?? item.current_price * 1.02,
            low24h: item.low_24h ?? item.current_price * 0.98,
            coingeckoId: item.id,
            image: item.image,
            marketCap: item.market_cap,
            marketCapRank: item.market_cap_rank ?? undefined,
            sparkline7d: item.sparkline_in_7d?.price,
            ath: item.ath ?? undefined,
            change7d: item.price_change_percentage_7d_in_currency ?? undefined,
          };
        });

      return mapped;
    } catch (err) {
      console.warn('CoinGecko markets fetch failed, keeping fallback assets:', err);
      return INITIAL_FALLBACK_ASSETS;
    }
  });
}

export interface CoinGeckoSimplePriceEntry {
  usd?: number;
  php?: number;
  usd_24h_change?: number;
  php_24h_change?: number;
  last_updated_at?: number;
}

export type CoinGeckoSimplePriceMap = Record<string, CoinGeckoSimplePriceEntry>;

/**
 * Fetches live USD and PHP prices for multiple CoinGecko coin IDs via /api/coingecko/simple-price
 */
export async function fetchCoinGeckoSimplePrices(
  coinIds: string[],
  forceFresh: boolean = false
): Promise<CoinGeckoSimplePriceMap> {
  const uniqueIds = Array.from(
    new Set(coinIds.map((id) => id.trim().toLowerCase()).filter(Boolean))
  ).sort();

  if (uniqueIds.length === 0) return {};

  const idsParam = uniqueIds.join(',');
  const ttl = forceFresh ? 0 : 30_000;

  return cachedFetch(`simple-price:${idsParam}`, ttl, async () => {
    try {
      const res = await fetch(
        `/api/coingecko/simple-price?ids=${encodeURIComponent(idsParam)}&vs_currencies=usd,php`
      );
      if (!res.ok) return {};
      const data = await res.json();
      if (!data || typeof data !== 'object') return {};
      return data as CoinGeckoSimplePriceMap;
    } catch {
      return {};
    }
  });
}

/**
 * Fetches live USDT -> PHP conversion rate from CoinGecko /simple/price
 */
export async function fetchCoinGeckoPhpRate(fallbackRate: number = 58.45): Promise<number> {
  return cachedFetch('php-rate', 60_000, async () => {
    try {
      const res = await fetch('/api/coingecko/simple-price?ids=tether&vs_currencies=usd,php');
      if (!res.ok) return fallbackRate;
      const data = await res.json();
      const php = data?.tether?.php;
      if (typeof php === 'number' && !isNaN(php) && php > 1) {
        return Number(php.toFixed(2));
      }
      return fallbackRate;
    } catch {
      return fallbackRate;
    }
  });
}

/**
 * Fetches 30-day daily historical price series from CoinGecko /coins/{id}/market_chart
 */
export async function fetchCoinGeckoMarketChart(
  symbol: string,
  days: number = 30,
  vsCurrency: 'usd' | 'php' = 'usd'
): Promise<CoinGeckoHistoricalPoint[]> {
  const upper = symbol.trim().toUpperCase();
  return cachedFetch(`chart:${upper}:${days}:${vsCurrency}`, 240_000, async () => {
    const coinId = await resolveCoinGeckoId(upper);
    if (!coinId) return [];

    try {
      const res = await fetch(
        `/api/coingecko/market-chart/${encodeURIComponent(coinId)}?vs_currency=${vsCurrency}&days=${days}&interval=daily`
      );
      if (!res.ok) return [];
      const data = await res.json();
      const prices: [number, number][] = Array.isArray(data?.prices) ? data.prices : [];
      if (prices.length === 0) return [];

      // Deduplicate to one price point per calendar date (YYYY-MM-DD)
      const byDate = new Map<string, CoinGeckoHistoricalPoint>();
      for (const [ts, price] of prices) {
        if (typeof ts !== 'number' || typeof price !== 'number' || isNaN(price)) continue;
        const dateKey = new Date(ts).toISOString().slice(0, 10);
        byDate.set(dateKey, { timestamp: ts, dateKey, price });
      }

      return Array.from(byDate.values()).sort((a, b) => a.timestamp - b.timestamp);
    } catch {
      return [];
    }
  });
}

/**
 * Fetches top trending coins from CoinGecko /search/trending
 */
export async function fetchCoinGeckoTrending(): Promise<CoinGeckoTrendingCoin[]> {
  return cachedFetch('trending', 180_000, async () => {
    try {
      const res = await fetch('/api/coingecko/trending');
      if (!res.ok) return [];
      const data = await res.json();
      const coins = Array.isArray(data?.coins) ? data.coins : [];
      return coins.slice(0, 7).map((entry: any) => {
        const item = entry?.item || {};
        return {
          id: item.id || '',
          name: item.name || '',
          symbol: (item.symbol || '').toUpperCase(),
          market_cap_rank: item.market_cap_rank ?? null,
          thumb: item.thumb || item.small || '',
          priceUsd: typeof item.data?.price === 'number' ? item.data.price : undefined,
          change24hPct:
            typeof item.data?.price_change_percentage_24h?.usd === 'number'
              ? item.data.price_change_percentage_24h.usd
              : undefined,
        };
      });
    } catch {
      return [];
    }
  });
}
