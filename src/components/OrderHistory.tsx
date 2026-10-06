import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { History, Clock, CheckCircle2, XCircle, Filter, Search, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { auth } from '../lib/firebase';
import { formatPrice } from '@/lib/binance';

export type OrderFilterTab = 'open' | 'filled' | 'canceled' | 'all';

export interface Order {
  id: string;
  time: string;
  asset: string;
  type: 'Market' | 'Limit' | 'Stop-Limit';
  side: 'Buy' | 'Sell';
  price: number;
  amount: number;
  filled: number; // percentage 0 - 100
  total: number;
  status: 'Open' | 'Filled' | 'Canceled';
}

const INITIAL_ORDERS: Order[] = [
  {
    id: 'ORD-9048',
    time: '2026-10-06 05:42:18',
    asset: 'BTC',
    type: 'Limit',
    side: 'Buy',
    price: 85400.00,
    amount: 0.15,
    filled: 40,
    total: 12810.00,
    status: 'Open',
  },
  {
    id: 'ORD-9047',
    time: '2026-10-06 05:19:04',
    asset: 'ETH',
    type: 'Limit',
    side: 'Sell',
    price: 2785.00,
    amount: 2.5,
    filled: 0,
    total: 6962.50,
    status: 'Open',
  },
  {
    id: 'ORD-9046',
    time: '2026-10-06 04:55:31',
    asset: 'SOL',
    type: 'Stop-Limit',
    side: 'Buy',
    price: 148.50,
    amount: 25,
    filled: 0,
    total: 3712.50,
    status: 'Open',
  },
  {
    id: 'ORD-9041',
    time: '2026-10-05 22:24:12',
    asset: 'BTC',
    type: 'Market',
    side: 'Buy',
    price: 86390.50,
    amount: 0.08,
    filled: 100,
    total: 6911.24,
    status: 'Filled',
  },
  {
    id: 'ORD-9038',
    time: '2026-10-05 18:30:00',
    asset: 'SOL',
    type: 'Market',
    side: 'Buy',
    price: 152.10,
    amount: 15,
    filled: 100,
    total: 2281.50,
    status: 'Filled',
  },
  {
    id: 'ORD-9035',
    time: '2026-10-05 15:11:44',
    asset: 'BNB',
    type: 'Limit',
    side: 'Sell',
    price: 612.80,
    amount: 6.5,
    filled: 100,
    total: 3983.20,
    status: 'Filled',
  },
  {
    id: 'ORD-9031',
    time: '2026-10-05 11:05:29',
    asset: 'XRP',
    type: 'Market',
    side: 'Buy',
    price: 0.584,
    amount: 2500,
    filled: 100,
    total: 1460.00,
    status: 'Filled',
  },
  {
    id: 'ORD-9027',
    time: '2026-10-04 19:20:12',
    asset: 'BNB',
    type: 'Limit',
    side: 'Sell',
    price: 625.00,
    amount: 5,
    filled: 0,
    total: 3125.00,
    status: 'Canceled',
  },
  {
    id: 'ORD-9022',
    time: '2026-10-04 14:08:53',
    asset: 'ETH',
    type: 'Limit',
    side: 'Buy',
    price: 2510.00,
    amount: 1.8,
    filled: 0,
    total: 4518.00,
    status: 'Canceled',
  },
  {
    id: 'ORD-9019',
    time: '2026-10-04 09:42:10',
    asset: 'DOGE',
    type: 'Stop-Limit',
    side: 'Sell',
    price: 0.165,
    amount: 12000,
    filled: 0,
    total: 1980.00,
    status: 'Canceled',
  },
];

export function OrderHistory({ isVerified }: { isVerified: boolean }) {
  const user = auth.currentUser;
  const [orders, setOrders] = useState<Order[]>(INITIAL_ORDERS);
  const [statusFilter, setStatusFilter] = useState<OrderFilterTab>('open');
  const [sideFilter, setSideFilter] = useState<'All' | 'Buy' | 'Sell'>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const counts = useMemo(() => {
    return {
      open: orders.filter((o) => o.status === 'Open').length,
      filled: orders.filter((o) => o.status === 'Filled').length,
      canceled: orders.filter((o) => o.status === 'Canceled').length,
      all: orders.length,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      if (statusFilter === 'open' && order.status !== 'Open') return false;
      if (statusFilter === 'filled' && order.status !== 'Filled') return false;
      if (statusFilter === 'canceled' && order.status !== 'Canceled') return false;
      if (sideFilter !== 'All' && order.side !== sideFilter) return false;
      if (searchQuery.trim() !== '') {
        const q = searchQuery.trim().toLowerCase();
        const matchAsset = order.asset.toLowerCase().includes(q);
        const matchId = order.id.toLowerCase().includes(q);
        const matchType = order.type.toLowerCase().includes(q);
        if (!matchAsset && !matchId && !matchType) return false;
      }
      return true;
    });
  }, [orders, statusFilter, sideFilter, searchQuery]);

  const handleCancelOrder = (orderId: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'Canceled' } : o))
    );
  };

  const handleCancelAllOpen = () => {
    setOrders((prev) =>
      prev.map((o) => (o.status === 'Open' ? { ...o, status: 'Canceled' } : o))
    );
  };

  const handleResetOrders = () => {
    setOrders(INITIAL_ORDERS);
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800 p-0 overflow-hidden relative min-h-[420px] flex flex-col">
      {/* Header & Filter Bar */}
      <div className="px-6 pt-5 pb-4 border-b border-zinc-900 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <History className="h-4 w-4 text-yellow-500" />
            <h3 className="text-sm font-black uppercase tracking-wider text-zinc-100">
              Order Management & History
            </h3>
            {(!user || !isVerified) && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                Preview Feed
              </span>
            )}
          </div>

          {/* Secondary Controls: Side Filter, Search, Reset */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Side Toggle */}
            <div className="flex items-center bg-zinc-900/90 p-0.5 rounded-lg border border-zinc-800">
              {(['All', 'Buy', 'Sell'] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  onClick={() => setSideFilter(side)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all',
                    sideFilter === side
                      ? side === 'Buy'
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : side === 'Sell'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  {side}
                </button>
              ))}
            </div>

            {/* Asset / Order ID Search */}
            <div className="relative">
              <Search className="h-3 w-3 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter pair..."
                className="bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-2.5 py-1 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-yellow-500/50 w-28 sm:w-32"
              />
            </div>

            {statusFilter === 'open' && counts.open > 0 && (
              <button
                type="button"
                onClick={handleCancelAllOpen}
                className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                Cancel All
              </button>
            )}

            {counts.open < INITIAL_ORDERS.filter((o) => o.status === 'Open').length && (
              <button
                type="button"
                onClick={handleResetOrders}
                title="Restore sample orders"
                className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800 transition-colors"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Primary Status Filter Toggle Buttons: Open Orders | Filled Orders | Canceled Orders */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div
            role="tablist"
            aria-label="Order Status Filter"
            className="flex flex-wrap items-center gap-2"
          >
            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === 'open'}
              onClick={() => setStatusFilter('open')}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border',
                statusFilter === 'open'
                  ? 'bg-yellow-500/15 text-yellow-500 border-yellow-500/40 shadow-[0_0_15px_rgba(234,179,8,0.1)]'
                  : 'bg-zinc-900/60 text-zinc-400 border-zinc-800/80 hover:text-zinc-200 hover:bg-zinc-900'
              )}
            >
              <Clock className="h-3.5 w-3.5 text-yellow-500" />
              <span>Open Orders</span>
              <span
                className={cn(
                  'font-mono text-[10px] px-1.5 py-0.5 rounded-md',
                  statusFilter === 'open'
                    ? 'bg-yellow-500 text-black font-black'
                    : 'bg-zinc-800 text-zinc-400'
                )}
              >
                {counts.open}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === 'filled'}
              onClick={() => setStatusFilter('filled')}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border',
                statusFilter === 'filled'
                  ? 'bg-green-500/15 text-green-400 border-green-500/40 shadow-[0_0_15px_rgba(34,197,94,0.1)]'
                  : 'bg-zinc-900/60 text-zinc-400 border-zinc-800/80 hover:text-zinc-200 hover:bg-zinc-900'
              )}
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              <span>Filled Orders</span>
              <span
                className={cn(
                  'font-mono text-[10px] px-1.5 py-0.5 rounded-md',
                  statusFilter === 'filled'
                    ? 'bg-green-500 text-black font-black'
                    : 'bg-zinc-800 text-zinc-400'
                )}
              >
                {counts.filled}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === 'canceled'}
              onClick={() => setStatusFilter('canceled')}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border',
                statusFilter === 'canceled'
                  ? 'bg-red-500/15 text-red-400 border-red-500/40 shadow-[0_0_15px_rgba(239,68,68,0.1)]'
                  : 'bg-zinc-900/60 text-zinc-400 border-zinc-800/80 hover:text-zinc-200 hover:bg-zinc-900'
              )}
            >
              <XCircle className="h-3.5 w-3.5 text-red-500" />
              <span>Canceled Orders</span>
              <span
                className={cn(
                  'font-mono text-[10px] px-1.5 py-0.5 rounded-md',
                  statusFilter === 'canceled'
                    ? 'bg-red-500 text-black font-black'
                    : 'bg-zinc-800 text-zinc-400'
                )}
              >
                {counts.canceled}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border',
                statusFilter === 'all'
                  ? 'bg-zinc-800 text-zinc-100 border-zinc-700'
                  : 'bg-zinc-900/40 text-zinc-500 border-zinc-800/60 hover:text-zinc-300 hover:bg-zinc-900'
              )}
            >
              <Filter className="h-3.5 w-3.5" />
              <span>All ({counts.all})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 border-b border-zinc-900 bg-zinc-950/60">
              <th className="px-6 py-3.5 font-bold">Time / ID</th>
              <th className="px-6 py-3.5 font-bold">Pair</th>
              <th className="px-6 py-3.5 font-bold">Type</th>
              <th className="px-6 py-3.5 font-bold">Side</th>
              <th className="px-6 py-3.5 font-bold">Price</th>
              <th className="px-6 py-3.5 font-bold">Amount</th>
              <th className="px-6 py-3.5 font-bold">Filled</th>
              <th className="px-6 py-3.5 font-bold">Total (USDT)</th>
              <th className="px-6 py-3.5 font-bold text-right">Status / Action</th>
            </tr>
          </thead>
          <tbody className="text-sm divide-y divide-zinc-900/50">
            {filteredOrders.map((order) => (
              <tr
                key={order.id}
                className="group hover:bg-zinc-900/35 transition-colors"
              >
                <td className="px-6 py-3.5">
                  <div className="text-zinc-300 font-mono text-[11px]">
                    {order.time}
                  </div>
                  <div className="text-zinc-600 font-mono text-[10px]">
                    {order.id}
                  </div>
                </td>
                <td className="px-6 py-3.5">
                  <span className="font-bold text-zinc-100">{order.asset}</span>
                  <span className="text-zinc-500 text-xs font-mono">/USDT</span>
                </td>
                <td className="px-6 py-3.5">
                  <span className="text-xs font-medium text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                    {order.type}
                  </span>
                </td>
                <td className="px-6 py-3.5">
                  <span
                    className={cn(
                      'text-xs font-bold uppercase px-2 py-0.5 rounded',
                      order.side === 'Buy'
                        ? 'text-green-400 bg-green-500/10 border border-green-500/20'
                        : 'text-red-400 bg-red-500/10 border border-red-500/20'
                    )}
                  >
                    {order.side}
                  </span>
                </td>
                <td className="px-6 py-3.5 font-mono text-zinc-200 font-bold text-xs">
                  ${formatPrice(order.price)}
                </td>
                <td className="px-6 py-3.5 font-mono text-zinc-300 text-xs">
                  {order.amount} <span className="text-zinc-500">{order.asset}</span>
                </td>
                <td className="px-6 py-3.5">
                  <div className="flex items-center gap-2">
                    <div className="w-12 h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          order.status === 'Filled'
                            ? 'bg-green-500'
                            : order.status === 'Open'
                            ? 'bg-yellow-500'
                            : 'bg-zinc-600'
                        )}
                        style={{ width: `${order.filled}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-zinc-400">
                      {order.filled}%
                    </span>
                  </div>
                </td>
                <td className="px-6 py-3.5 font-mono text-zinc-200 text-xs font-bold">
                  ${order.total.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
                <td className="px-6 py-3.5 text-right">
                  {order.status === 'Open' ? (
                    <div className="inline-flex items-center gap-2.5 justify-end">
                      <span className="inline-flex items-center gap-1 text-yellow-500 text-[10px] font-bold uppercase tracking-wider">
                        <Clock className="h-3 w-3" />
                        Open
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCancelOrder(order.id)}
                        className="px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:text-red-300 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : order.status === 'Filled' ? (
                    <div className="inline-flex items-center gap-1.5 text-green-400 justify-end">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        Filled
                      </span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 text-red-400/80 justify-end">
                      <XCircle className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">
                        Canceled
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            ))}

            {filteredOrders.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-16 text-center">
                  <History className="h-9 w-9 text-zinc-800 mx-auto mb-3" />
                  <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-1">
                    {statusFilter === 'open'
                      ? 'No Open Orders'
                      : statusFilter === 'filled'
                      ? 'No Filled Orders'
                      : statusFilter === 'canceled'
                      ? 'No Canceled Orders'
                      : 'No Matching Orders'}
                  </p>
                  <p className="text-zinc-600 text-xs">
                    {searchQuery || sideFilter !== 'All'
                      ? 'Try clearing your active pair or side filters.'
                      : 'Orders matching this status filter will appear here.'}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

