export interface SimulatedTrade {
  id: string;
  time: string;
  timestampIso: string;
  asset: string;
  type: 'Market' | 'Limit' | 'Stop-Limit';
  side: 'Buy' | 'Sell';
  price: number;
  amount: number;
  filled: number; // 0 - 100
  total: number; // USDT gross
  status: 'Open' | 'Filled' | 'Canceled';
  leverage?: number;
  feeUsdt?: number;
}

const STORAGE_KEY_SIMULATED_TRADES = 'binanceph_simulated_trades_v1';
const TRADES_UPDATED_EVENT = 'binanceph_simulated_trades_updated';
const DEFAULT_SPOT_FEE_RATE = 0.001; // 0.1%

export const INITIAL_SIMULATED_TRADES: SimulatedTrade[] = [
  {
    id: 'ORD-9048',
    time: '2026-10-06 05:42:18',
    timestampIso: '2026-10-06T05:42:18+08:00',
    asset: 'BTC',
    type: 'Limit',
    side: 'Buy',
    price: 85400.0,
    amount: 0.15,
    filled: 40,
    total: 12810.0,
    status: 'Open',
    leverage: 1,
    feeUsdt: 12.81,
  },
  {
    id: 'ORD-9047',
    time: '2026-10-06 05:19:04',
    timestampIso: '2026-10-06T05:19:04+08:00',
    asset: 'ETH',
    type: 'Limit',
    side: 'Sell',
    price: 2785.0,
    amount: 2.5,
    filled: 0,
    total: 6962.5,
    status: 'Open',
    leverage: 1,
    feeUsdt: 6.96,
  },
  {
    id: 'ORD-9046',
    time: '2026-10-06 04:55:31',
    timestampIso: '2026-10-06T04:55:31+08:00',
    asset: 'SOL',
    type: 'Stop-Limit',
    side: 'Buy',
    price: 148.5,
    amount: 25,
    filled: 0,
    total: 3712.5,
    status: 'Open',
    leverage: 1,
    feeUsdt: 3.71,
  },
  {
    id: 'ORD-9043',
    time: '2026-10-06 01:12:40',
    timestampIso: '2026-10-06T01:12:40+08:00',
    asset: 'BTC',
    type: 'Market',
    side: 'Sell',
    price: 86920.0,
    amount: 0.04,
    filled: 100,
    total: 3476.8,
    status: 'Filled',
    leverage: 1,
    feeUsdt: 3.48,
  },
  {
    id: 'ORD-9041',
    time: '2026-10-05 22:24:12',
    timestampIso: '2026-10-05T22:24:12+08:00',
    asset: 'BTC',
    type: 'Market',
    side: 'Buy',
    price: 86390.5,
    amount: 0.08,
    filled: 100,
    total: 6911.24,
    status: 'Filled',
    leverage: 1,
    feeUsdt: 6.91,
  },
  {
    id: 'ORD-9038',
    time: '2026-10-05 18:30:00',
    timestampIso: '2026-10-05T18:30:00+08:00',
    asset: 'SOL',
    type: 'Market',
    side: 'Buy',
    price: 152.1,
    amount: 15,
    filled: 100,
    total: 2281.5,
    status: 'Filled',
    leverage: 1,
    feeUsdt: 2.28,
  },
  {
    id: 'ORD-9035',
    time: '2026-10-05 15:11:44',
    timestampIso: '2026-10-05T15:11:44+08:00',
    asset: 'BNB',
    type: 'Limit',
    side: 'Sell',
    price: 612.8,
    amount: 6.5,
    filled: 100,
    total: 3983.2,
    status: 'Filled',
    leverage: 1,
    feeUsdt: 3.98,
  },
  {
    id: 'ORD-9031',
    time: '2026-10-05 11:05:29',
    timestampIso: '2026-10-05T11:05:29+08:00',
    asset: 'XRP',
    type: 'Market',
    side: 'Buy',
    price: 0.584,
    amount: 2500,
    filled: 100,
    total: 1460.0,
    status: 'Filled',
    leverage: 1,
    feeUsdt: 1.46,
  },
  {
    id: 'ORD-9027',
    time: '2026-10-04 19:20:12',
    timestampIso: '2026-10-04T19:20:12+08:00',
    asset: 'BNB',
    type: 'Limit',
    side: 'Sell',
    price: 625.0,
    amount: 5,
    filled: 0,
    total: 3125.0,
    status: 'Canceled',
    leverage: 1,
    feeUsdt: 0,
  },
  {
    id: 'ORD-9024',
    time: '2026-10-03 16:40:05',
    timestampIso: '2026-10-03T16:40:05+08:00',
    asset: 'BNB',
    type: 'Market',
    side: 'Buy',
    price: 558.4,
    amount: 10,
    filled: 100,
    total: 5584.0,
    status: 'Filled',
    leverage: 1,
    feeUsdt: 5.58,
  },
  {
    id: 'ORD-9022',
    time: '2026-10-04 14:08:53',
    timestampIso: '2026-10-04T14:08:53+08:00',
    asset: 'ETH',
    type: 'Limit',
    side: 'Buy',
    price: 2510.0,
    amount: 1.8,
    filled: 0,
    total: 4518.0,
    status: 'Canceled',
    leverage: 1,
    feeUsdt: 0,
  },
  {
    id: 'ORD-9019',
    time: '2026-10-04 09:42:10',
    timestampIso: '2026-10-04T09:42:10+08:00',
    asset: 'DOGE',
    type: 'Stop-Limit',
    side: 'Sell',
    price: 0.165,
    amount: 12000,
    filled: 0,
    total: 1980.0,
    status: 'Canceled',
    leverage: 1,
    feeUsdt: 0,
  },
  {
    id: 'ORD-9014',
    time: '2026-09-28 10:15:00',
    timestampIso: '2026-09-28T10:15:00+08:00',
    asset: 'BTC',
    type: 'Market',
    side: 'Buy',
    price: 78950.0,
    amount: 0.1,
    filled: 100,
    total: 7895.0,
    status: 'Filled',
    leverage: 1,
    feeUsdt: 7.9,
  },
];

function formatManilaTime(date: Date): { display: string; iso: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });

  const display = `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
  const iso = `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+08:00`;
  return { display, iso };
}

function emitTradesUpdated(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TRADES_UPDATED_EVENT));
  }
}

export function loadSimulatedTrades(): SimulatedTrade[] {
  if (typeof window === 'undefined') return INITIAL_SIMULATED_TRADES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_SIMULATED_TRADES);
    if (!raw) return INITIAL_SIMULATED_TRADES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return INITIAL_SIMULATED_TRADES;
  } catch {
    return INITIAL_SIMULATED_TRADES;
  }
}

export function saveSimulatedTrades(trades: SimulatedTrade[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_SIMULATED_TRADES, JSON.stringify(trades));
    emitTradesUpdated();
  } catch {}
}

export function addSimulatedTrade(input: {
  asset: string;
  type: 'Market' | 'Limit' | 'Stop-Limit';
  side: 'Buy' | 'Sell';
  price: number;
  amount: number;
  status: 'Open' | 'Filled' | 'Canceled';
  leverage?: number;
}): SimulatedTrade {
  const now = new Date();
  const { display, iso } = formatManilaTime(now);
  const total = Number((input.price * input.amount).toFixed(2));
  const feeUsdt =
    input.status === 'Filled'
      ? Number((total * DEFAULT_SPOT_FEE_RATE).toFixed(4))
      : 0;

  const newTrade: SimulatedTrade = {
    id: `ORD-${Math.floor(10000 + Math.random() * 89999)}`,
    time: display,
    timestampIso: iso,
    asset: input.asset,
    type: input.type,
    side: input.side,
    price: input.price,
    amount: input.amount,
    filled: input.status === 'Filled' ? 100 : 0,
    total,
    status: input.status,
    leverage: input.leverage ?? 1,
    feeUsdt,
  };

  const current = loadSimulatedTrades();
  const next = [newTrade, ...current];
  saveSimulatedTrades(next);
  return newTrade;
}

export function updateSimulatedTradeStatus(
  orderId: string,
  status: SimulatedTrade['status']
): SimulatedTrade[] {
  const current = loadSimulatedTrades();
  const next = current.map((o) =>
    o.id === orderId
      ? {
          ...o,
          status,
          filled: status === 'Filled' ? 100 : o.filled,
          feeUsdt:
            status === 'Filled'
              ? Number((o.total * DEFAULT_SPOT_FEE_RATE).toFixed(4))
              : status === 'Canceled'
              ? 0
              : o.feeUsdt,
        }
      : o
  );
  saveSimulatedTrades(next);
  return next;
}

export function cancelAllOpenSimulatedTrades(): SimulatedTrade[] {
  const current = loadSimulatedTrades();
  const next = current.map((o) =>
    o.status === 'Open' ? { ...o, status: 'Canceled' as const, feeUsdt: 0 } : o
  );
  saveSimulatedTrades(next);
  return next;
}

export function resetSimulatedTrades(): SimulatedTrade[] {
  saveSimulatedTrades(INITIAL_SIMULATED_TRADES);
  return INITIAL_SIMULATED_TRADES;
}

export function subscribeSimulatedTrades(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleCustom = () => callback();
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY_SIMULATED_TRADES) {
      callback();
    }
  };
  window.addEventListener(TRADES_UPDATED_EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(TRADES_UPDATED_EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
}
