import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Asset } from './AssetList';
import { 
  Wallet, 
  Lock, 
  Clock, 
  BookOpen, 
  Activity, 
  ArrowUpRight, 
  ArrowDownRight, 
  Layers, 
  RefreshCw, 
  ChevronDown,
  Volume2,
  VolumeX,
  CheckCircle2
} from 'lucide-react';
import { auth } from '../lib/firebase';
import { AuthModal } from './AuthModal';
import { cn } from '@/lib/utils';
import { useAccount, useBalance } from 'wagmi';
import { 
  formatPrice, 
  fetchLiveBinanceTrades, 
  fetchLiveBinanceDepth, 
  OrderBookLevel, 
  LiveTrade,
  DepthResult 
} from '@/lib/binance';

interface Trade {
  id: number;
  price: string;
  qty: string;
  time: number;
  isBuyerMaker: boolean;
}

export type OrderBookLayout = 'both' | 'bids' | 'asks';

const STORAGE_KEY_TRADE_SOUND = 'binanceph_trade_sound_enabled';

/**
 * Plays a subtle, pleasant financial exchange confirmation sound effect using Web Audio API
 */
export function playTradeExecutionSound(type: 'buy' | 'sell' = 'buy'): void {
  if (typeof window === 'undefined') return;
  try {
    const isSoundEnabled = window.localStorage.getItem(STORAGE_KEY_TRADE_SOUND) !== 'false';
    if (!isSoundEnabled) return;

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Master Gain for subtle, non-intrusive volume
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    masterGain.connect(ctx.destination);

    // Primary bell tone
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    const primaryFreq = type === 'buy' ? 880 : 783.99; // A5 for Buy, G5 for Sell
    osc1.frequency.setValueAtTime(primaryFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(type === 'buy' ? 1318.51 : 1174.66, now + 0.08); // E6 / D6 sparkle

    // Secondary harmonic overtone for glass-like finish
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(primaryFreq * 1.5, now);
    osc2.frequency.exponentialRampToValueAtTime(type === 'buy' ? 1760 : 1567.98, now + 0.08);

    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.04, now);
    osc2Gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc2.connect(osc2Gain);
    osc2Gain.connect(masterGain);

    osc1.connect(masterGain);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.36);
    osc2.stop(now + 0.36);

    // Auto cleanup
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 450);
  } catch (err) {
    // Audio contexts may be blocked by autoplay policies
    console.debug('Trade sound effect skipped:', err);
  }
}

export function TradingPanel({ asset, isVerified }: { asset: Asset, isVerified: boolean }) {
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [activeTab, setActiveTab] = useState<'buy' | 'sell' | 'deposit'>('buy');
  const [leverage, setLeverage] = useState(1);
  const [depositAmount, setDepositAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('pse');
  const [executionToast, setExecutionToast] = useState<{ message: string; type: 'buy' | 'sell' } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(STORAGE_KEY_TRADE_SOUND) !== 'false';
  });

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY_TRADE_SOUND, String(next));
    }
    if (next) {
      playTradeExecutionSound('buy');
    }
  };
  
  interface PendingOrder {
    id: string;
    type: 'buy' | 'sell';
    symbol: string;
    amount: string;
    price: string;
    leverage: number;
    time: number;
  }
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);

  const handlePlaceOrder = (type: 'buy' | 'sell') => {
    const orderAmount = amount || '0.05';
    const executedPrice = orderType === 'market' ? asset.price : (parseFloat(limitPrice) || asset.price);

    if (orderType === 'market') {
      // Play confirmation sound effect
      playTradeExecutionSound(type);

      // Show execution toast notice
      setExecutionToast({
        message: `${type === 'buy' ? 'Market Long' : 'Market Short'} Executed: ${orderAmount} ${asset.symbol} @ $${formatPrice(executedPrice)} (${leverage}x)`,
        type,
      });
      setTimeout(() => setExecutionToast(null), 3500);

      setAmount('');
    } else {
      if (!amount || !limitPrice) return;
      const newOrder: PendingOrder = {
        id: Math.random().toString(36).substring(7),
        type,
        symbol: asset.symbol,
        amount,
        price: limitPrice,
        leverage,
        time: Date.now()
      };
      setPendingOrders(prev => [newOrder, ...prev]);

      // Play confirmation sound effect
      playTradeExecutionSound(type);

      // Show execution toast notice
      setExecutionToast({
        message: `Limit Order Placed: ${type === 'buy' ? 'Buy' : 'Sell'} ${amount} ${asset.symbol} @ $${formatPrice(parseFloat(limitPrice))} (${leverage}x)`,
        type,
      });
      setTimeout(() => setExecutionToast(null), 3500);

      setAmount('');
      setLimitPrice('');
    }
  };

  const [trades, setTrades] = useState<Trade[]>([]);
  const [depth, setDepth] = useState<DepthResult>({
    bids: [],
    asks: [],
    spread: 0,
    spreadPercent: 0,
    bidTotal: 0,
    askTotal: 0,
  });
  const [marketView, setMarketView] = useState<'orderbook' | 'trades'>('orderbook');
  const [orderBookLayout, setOrderBookLayout] = useState<OrderBookLayout>('both');
  const [depthRowCount, setDepthRowCount] = useState<number>(7);
  const [isDepthLoading, setIsDepthLoading] = useState(false);
  const [lastDepthUpdated, setLastDepthUpdated] = useState<Date | null>(null);

  // Poll /api/binance/depth proxy endpoint for current depth data
  const loadDepthFromProxy = useCallback(async (limit: number = 20) => {
    try {
      const result = await fetchLiveBinanceDepth(asset.symbol, limit);
      if (result && (result.bids.length > 0 || result.asks.length > 0)) {
        setDepth(result);
        setLastDepthUpdated(new Date());
      }
    } catch (err) {
      console.warn('Error fetching order book depth from proxy:', err);
    }
  }, [asset.symbol]);

  // Initial load and periodic polling from /api/binance/depth proxy
  useEffect(() => {
    let isMounted = true;
    setIsDepthLoading(true);

    loadDepthFromProxy(20).finally(() => {
      if (isMounted) setIsDepthLoading(false);
    });

    // Poll proxy every 2.5 seconds to ensure continuous fresh order book feed
    const intervalId = setInterval(() => {
      loadDepthFromProxy(20);
    }, 2500);

    fetchLiveBinanceTrades(asset.symbol, 20).then((liveTrades) => {
      if (isMounted && liveTrades.length > 0) {
        setTrades(liveTrades);
      }
    });

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [asset.symbol, loadDepthFromProxy]);

  // Connect to Binance aggregate trades & depth stream for sub-second live order book updates
  useEffect(() => {
    let tradeWs: WebSocket | null = null;
    let depthWs: WebSocket | null = null;
    let isMounted = true;

    const connectTradeWS = () => {
      try {
        tradeWs = new WebSocket(`wss://stream.binance.com:9443/ws/${asset.symbol.toLowerCase()}usdt@aggTrade`);

        tradeWs.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.e === 'aggTrade') {
              const newTrade = {
                id: data.a,
                price: data.p,
                qty: data.q,
                time: data.T,
                isBuyerMaker: data.m
              };
              setTrades(prev => [newTrade, ...prev].slice(0, 30));
            }
          } catch {
            // ignore
          }
        };

        tradeWs.onclose = () => {
          if (isMounted) {
            setTimeout(connectTradeWS, 3000);
          }
        };
      } catch {
        // ignore
      }
    };

    const connectDepthWS = () => {
      try {
        depthWs = new WebSocket(`wss://stream.binance.com:9443/ws/${asset.symbol.toLowerCase()}usdt@depth20@1000ms`);

        depthWs.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (Array.isArray(data.bids) && Array.isArray(data.asks)) {
              let runningBidTotal = 0;
              const bids = data.bids.map((b: [string, string]) => {
                const price = parseFloat(b[0]);
                const qty = parseFloat(b[1]);
                runningBidTotal += qty;
                return { price, qty, total: runningBidTotal };
              });

              let runningAskTotal = 0;
              const asks = data.asks.map((a: [string, string]) => {
                const price = parseFloat(a[0]);
                const qty = parseFloat(a[1]);
                runningAskTotal += qty;
                return { price, qty, total: runningAskTotal };
              });

              const bestBid = bids.length > 0 ? bids[0].price : 0;
              const bestAsk = asks.length > 0 ? asks[0].price : 0;
              const spread = bestAsk > 0 && bestBid > 0 ? Math.max(0, bestAsk - bestBid) : 0;
              const spreadPercent = bestAsk > 0 ? (spread / bestAsk) * 100 : 0;

              setDepth({
                bids,
                asks,
                spread,
                spreadPercent,
                bidTotal: runningBidTotal,
                askTotal: runningAskTotal,
                lastUpdateId: data.lastUpdateId,
              });
              setLastDepthUpdated(new Date());
            }
          } catch {
            // ignore
          }
        };

        depthWs.onclose = () => {
          if (isMounted) {
            setTimeout(connectDepthWS, 3000);
          }
        };
      } catch {
        // ignore
      }
    };

    connectTradeWS();
    connectDepthWS();

    return () => {
      isMounted = false;
      if (tradeWs) tradeWs.close();
      if (depthWs) depthWs.close();
    };
  }, [asset.symbol]);

  // One-click price fill from order book
  const handleSelectOrderBookPrice = (priceVal: number, defaultSide?: 'buy' | 'sell') => {
    setOrderType('limit');
    setLimitPrice(priceVal.toString());
    if (defaultSide) {
      setActiveTab(defaultSide);
    }
  };

  // Calculate maximum total for depth visual bar scale
  const maxAskTotal = useMemo(() => {
    if (depth.asks.length === 0) return 1;
    const sliceCount = orderBookLayout === 'asks' ? depthRowCount * 2 : depthRowCount;
    const visibleAsks = depth.asks.slice(0, sliceCount);
    return visibleAsks.length > 0 ? visibleAsks[visibleAsks.length - 1].total : 1;
  }, [depth.asks, depthRowCount, orderBookLayout]);

  const maxBidTotal = useMemo(() => {
    if (depth.bids.length === 0) return 1;
    const sliceCount = orderBookLayout === 'bids' ? depthRowCount * 2 : depthRowCount;
    const visibleBids = depth.bids.slice(0, sliceCount);
    return visibleBids.length > 0 ? visibleBids[visibleBids.length - 1].total : 1;
  }, [depth.bids, depthRowCount, orderBookLayout]);

  // Bid vs Ask Volume Ratio
  const totalVolumeInView = depth.bidTotal + depth.askTotal;
  const bidRatioPercent = totalVolumeInView > 0 ? Math.round((depth.bidTotal / totalVolumeInView) * 100) : 50;
  const askRatioPercent = 100 - bidRatioPercent;

  const user = auth.currentUser;
  const showLock = !user || !isVerified;

  const { address } = useAccount();
  const { data: balanceData } = useBalance({ address });

  // Format real wallet balance if connected, otherwise default back to paper balance
  const displayBalance = balanceData 
    ? `${(Number(balanceData.value) / 10**balanceData.decimals).toFixed(4)} ${balanceData.symbol}`
    : '12,450.00 USDT';

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 sm:p-6 h-full relative overflow-hidden flex flex-col">
      {showLock && (
        <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center mb-4 border border-zinc-800">
            <Lock className="h-6 w-6 text-yellow-500" />
          </div>
          <h3 className="text-lg font-bold text-zinc-100 mb-2">
            {!user ? 'Login Required' : 'Security Verification'}
          </h3>
          <p className="text-sm text-zinc-400 mb-6">
            {!user 
              ? `Please sign in to start trading ${asset.name} and manage your portfolio.`
              : 'Please complete the security verification to unlock trading features.'}
          </p>
          {!user && <AuthModal />}
        </div>
      )}
      
      <div className="flex-1 space-y-6 overflow-y-auto pr-1 custom-scrollbar">
        {/* Execution Toast Banner */}
        {executionToast && (
          <div className={cn(
            "p-3 rounded-xl border flex items-center justify-between gap-2.5 text-xs font-mono animate-in fade-in slide-in-from-top-2 duration-200 shadow-lg",
            executionToast.type === 'buy'
              ? "bg-green-500/15 border-green-500/30 text-green-400"
              : "bg-red-500/15 border-red-500/30 text-red-400"
          )}>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span className="font-semibold text-[11px] leading-tight">{executionToast.message}</span>
            </div>
            {soundEnabled && <Volume2 className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
          </div>
        )}

        {/* Trading Tabs & Order Form */}
        <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)} className="w-full">
          <div className="flex items-center gap-2 mb-5">
            <TabsList className="grid flex-1 grid-cols-3 bg-zinc-900 mb-0">
              <TabsTrigger value="buy" className="data-[state=active]:bg-green-600 data-[state=active]:text-white font-bold text-xs">Buy</TabsTrigger>
              <TabsTrigger value="sell" className="data-[state=active]:bg-red-600 data-[state=active]:text-white font-bold text-xs">Sell</TabsTrigger>
              <TabsTrigger value="deposit" className="data-[state=active]:bg-yellow-500 data-[state=active]:text-black font-extrabold text-xs">Deposit</TabsTrigger>
            </TabsList>
            <button
              type="button"
              onClick={toggleSound}
              className={cn(
                "p-2 rounded-lg border transition-colors shrink-0",
                soundEnabled 
                  ? "bg-zinc-900 border-zinc-800 text-yellow-500 hover:border-yellow-500/40" 
                  : "bg-zinc-900/50 border-zinc-800 text-zinc-600 hover:text-zinc-400"
              )}
              title={soundEnabled ? "Trade sound effects enabled (Click to mute)" : "Trade sound effects muted (Click to enable)"}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          </div>
          
          <div className="flex gap-2 mb-5">
            <button 
              onClick={() => setOrderType('market')}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all",
                orderType === 'market' ? "bg-zinc-800 border-zinc-700 text-yellow-500 shadow-sm" : "bg-transparent border-transparent text-zinc-500 hover:text-zinc-300"
              )}
            >
              Market
            </button>
            <button 
              onClick={() => {
                setOrderType('limit');
                if (!limitPrice) setLimitPrice(asset.price.toString());
              }}
              className={cn(
                "flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all",
                orderType === 'limit' ? "bg-zinc-800 border-zinc-700 text-yellow-500 shadow-sm" : "bg-transparent border-transparent text-zinc-500 hover:text-zinc-300"
              )}
            >
              Limit
            </button>
          </div>

          <TabsContent value="buy" className="flex flex-col gap-4 m-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <span>Price</span>
                  <span>USDT</span>
                </div>
                <Input 
                  type="text" 
                  value={orderType === 'market' ? formatPrice(asset.price) : limitPrice} 
                  onChange={(e) => orderType === 'limit' && setLimitPrice(e.target.value)}
                  readOnly={orderType === 'market'}
                  placeholder="0.00"
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono focus-visible:ring-yellow-500 h-10"
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <span>Amount</span>
                  <span>{asset.symbol}</span>
                </div>
                <Input 
                  type="number" 
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono focus-visible:ring-green-500 h-10"
                />
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                <span>Leverage</span>
                <span className="text-yellow-500 font-mono font-bold">{leverage}x</span>
              </div>
              <input 
                type="range" 
                min="1" 
                max="125" 
                step="1"
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-yellow-500"
              />
              <div className="flex justify-between text-[8px] text-zinc-600 font-bold uppercase">
                <span>1x</span>
                <span>25x</span>
                <span>50x</span>
                <span>75x</span>
                <span>100x</span>
                <span>125x</span>
              </div>
            </div>

            <div className="pt-2">
              <div className="flex justify-between text-sm mb-3">
                <span className="text-zinc-500 font-medium">Total Cost</span>
                <span className="text-zinc-100 font-mono font-bold">
                  ${((Number(amount) * (orderType === 'market' ? asset.price : (Number(limitPrice) || 0))) / leverage).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </span>
              </div>
              <Button 
                onClick={() => handlePlaceOrder('buy')}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-5 h-12 shadow-lg shadow-green-900/20"
              >
                {orderType === 'limit' ? `Buy / Long ${asset.symbol} Limit` : `Market Long ${asset.symbol}`}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="sell" className="flex flex-col gap-4 m-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <span>Price</span>
                  <span>USDT</span>
                </div>
                <Input 
                  type="text" 
                  value={orderType === 'market' ? formatPrice(asset.price) : limitPrice} 
                  onChange={(e) => orderType === 'limit' && setLimitPrice(e.target.value)}
                  readOnly={orderType === 'market'}
                  placeholder="0.00"
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono focus-visible:ring-yellow-500 h-10"
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <span>Amount</span>
                  <span>{asset.symbol}</span>
                </div>
                <Input 
                  type="number" 
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono focus-visible:ring-red-500 h-10"
                />
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                <span>Leverage</span>
                <span className="text-yellow-500 font-mono font-bold">{leverage}x</span>
              </div>
              <input 
                type="range" 
                min="1" 
                max="125" 
                step="1"
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-yellow-500"
              />
              <div className="flex justify-between text-[8px] text-zinc-600 font-bold uppercase">
                <span>1x</span>
                <span>25x</span>
                <span>50x</span>
                <span>75x</span>
                <span>100x</span>
                <span>125x</span>
              </div>
            </div>

            <div className="pt-2">
              <div className="flex justify-between text-sm mb-3">
                <span className="text-zinc-500 font-medium">Total Cost</span>
                <span className="text-zinc-100 font-mono font-bold">
                  ${((Number(amount) * (orderType === 'market' ? asset.price : (Number(limitPrice) || 0))) / leverage).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                </span>
              </div>
              <Button 
                onClick={() => handlePlaceOrder('sell')}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-5 h-12 shadow-lg shadow-red-900/20"
              >
                {orderType === 'limit' ? `Sell / Short ${asset.symbol} Limit` : `Market Short ${asset.symbol}`}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="deposit" className="flex flex-col gap-4 m-0">
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <span>Payment Method</span>
                </div>
                <select 
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg h-10 px-3 text-sm text-zinc-100 font-medium focus:outline-none focus:border-yellow-500 hover:border-zinc-700 transition-colors"
                >
                  <option value="pse">PSE Transfer (Philippines)</option>
                  <option value="gcash">GCash e-Wallet</option>
                  <option value="maya">Maya e-Wallet</option>
                  <option value="bank">Local Bank Transfer (BDO, BPI)</option>
                  <option value="gotym">GOtym</option>
                  <option value="debit">Debit/Credit Card</option>
                </select>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  <span>Amount to Deposit</span>
                  <span>PHP</span>
                </div>
                <Input 
                  type="number" 
                  placeholder="0.00"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono focus-visible:ring-yellow-500 h-10"
                />
              </div>

              {paymentMethod === 'gotym' && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 space-y-2 mt-4">
                  <p className="text-xs font-medium text-yellow-500 mb-2">Please transfer funds to the following GOtym account:</p>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500 font-medium">Bank Name</span>
                    <span className="text-zinc-100 font-bold">GOtym</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500 font-medium">Account Name</span>
                    <span className="text-zinc-100 font-mono font-bold select-all">Luke manlutac</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-500 font-medium">Account #</span>
                    <span className="text-zinc-100 font-mono font-bold select-all">010670911430</span>
                  </div>
                </div>
              )}

              <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-4 space-y-3 mt-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-medium">Processing Time</span>
                  <span className="text-green-500 font-bold tracking-tight">Instant (Under 5 mins)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-medium">Transaction Fee</span>
                  <span className="text-yellow-500 font-mono font-bold">{paymentMethod === 'bank' ? '25.00' : '15.00'} PHP</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-medium">Est. USDT Received</span>
                  <span className="text-zinc-300 font-mono">
                    ~{depositAmount ? (Number(depositAmount) / 55.4).toFixed(2) : '0.00'} USDT
                  </span>
                </div>
                <div className="pt-3 mt-1 border-t border-zinc-800 flex items-center justify-between text-sm">
                  <span className="text-zinc-400 font-bold uppercase text-[10px] tracking-widest">Total to Pay</span>
                  <span className="text-zinc-100 font-mono font-bold text-base">
                    {(Number(depositAmount) + (paymentMethod === 'bank' ? 25 : 15)).toFixed(2)} PHP
                  </span>
                </div>
              </div>
              
              <div className="pt-2">
                <Button className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold py-5 h-12 shadow-lg shadow-yellow-900/20 transition-all hover:scale-[1.02]">
                  Proceed to Payment
                </Button>
                <p className="text-[10px] text-zinc-500 text-center mt-3 font-medium">
                  Secured by local payment gateway partners. Need help? Contact support.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Live Order Book (Depth Data) & Trades Feed */}
        <div className="mt-8 pt-6 border-t border-zinc-900 space-y-3">
          {/* Header Bar */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1 bg-zinc-900/80 p-0.5 rounded-lg border border-zinc-800">
              <button
                type="button"
                onClick={() => setMarketView('orderbook')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                  marketView === 'orderbook' 
                    ? "bg-zinc-800 text-yellow-500 shadow-sm border border-zinc-700/50" 
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                <BookOpen className="h-3 w-3" /> Order Book
              </button>
              <button
                type="button"
                onClick={() => setMarketView('trades')}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all",
                  marketView === 'trades' 
                    ? "bg-zinc-800 text-yellow-500 shadow-sm border border-zinc-700/50" 
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                <Clock className="h-3 w-3" /> Trades
              </button>
            </div>

            {/* Depth controls when Order Book is active */}
            {marketView === 'orderbook' && (
              <div className="flex items-center gap-2">
                {/* Layout Selector */}
                <div className="flex items-center bg-zinc-900 p-0.5 rounded-md border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setOrderBookLayout('both')}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase transition-colors",
                      orderBookLayout === 'both' ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                    )}
                    title="Both Asks and Bids"
                  >
                    Both
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderBookLayout('bids')}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase transition-colors",
                      orderBookLayout === 'bids' ? "bg-green-500/20 text-green-400" : "text-zinc-500 hover:text-zinc-300"
                    )}
                    title="Bids only (Buy Wall)"
                  >
                    Bids
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderBookLayout('asks')}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase transition-colors",
                      orderBookLayout === 'asks' ? "bg-red-500/20 text-red-400" : "text-zinc-500 hover:text-zinc-300"
                    )}
                    title="Asks only (Sell Wall)"
                  >
                    Asks
                  </button>
                </div>

                {/* Refresh proxy depth button */}
                <button
                  type="button"
                  onClick={() => loadDepthFromProxy(20)}
                  className="p-1 text-zinc-500 hover:text-yellow-500 transition-colors"
                  title="Refresh Depth from /api/binance/depth"
                >
                  <RefreshCw className={cn("h-3 w-3", isDepthLoading && "animate-spin text-yellow-500")} />
                </button>
              </div>
            )}

            <span className="text-[9px] font-mono text-zinc-500 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live Proxy Feed
            </span>
          </div>

          {/* Market View: Order Book Depth */}
          {marketView === 'orderbook' ? (
            <div className="space-y-2">
              {/* Column Labels */}
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-500 px-1">
                <span>Price (USDT)</span>
                <span className="text-right">Size ({asset.symbol})</span>
                <span className="text-right">Total</span>
              </div>

              {/* Order Book Content */}
              <div className="space-y-1 font-mono text-xs">
                {/* Asks (Sell Orders - Red) */}
                {(orderBookLayout === 'both' || orderBookLayout === 'asks') && (
                  <div className="space-y-0.5">
                    {(orderBookLayout === 'asks' ? depth.asks.slice(0, depthRowCount * 2) : depth.asks.slice(0, depthRowCount))
                      .reverse()
                      .map((ask, idx) => {
                        const depthPercent = Math.min(100, Math.max(8, (ask.total / maxAskTotal) * 100));
                        return (
                          <div
                            key={`ask-${idx}-${ask.price}`}
                            onClick={() => handleSelectOrderBookPrice(ask.price, 'buy')}
                            className="group relative flex items-center justify-between text-[11px] py-0.5 px-2 rounded cursor-pointer hover:bg-red-500/10 transition-colors select-none overflow-hidden"
                            title={`Click to fill price: $${formatPrice(ask.price)}`}
                          >
                            {/* Cumulative Depth Gradient Bar */}
                            <div
                              className="absolute right-0 top-0 bottom-0 bg-red-500/15 pointer-events-none transition-all duration-300"
                              style={{ width: `${depthPercent}%` }}
                            />
                            <span className="text-red-400 font-bold z-10 group-hover:underline">
                              ${formatPrice(ask.price)}
                            </span>
                            <span className="text-zinc-300 z-10 text-right">
                              {ask.qty >= 100 ? ask.qty.toFixed(2) : ask.qty.toFixed(4)}
                            </span>
                            <span className="text-zinc-500 z-10 text-right text-[10px]">
                              {ask.total >= 100 ? ask.total.toFixed(2) : ask.total.toFixed(3)}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* Mid Market Spread & Last Price Bar */}
                <div className="py-1.5 px-2 my-1 bg-zinc-900/90 rounded-lg border border-zinc-800/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-yellow-500 font-mono text-sm">
                      ${formatPrice(asset.price)}
                    </span>
                    <span className={`text-[10px] font-bold ${asset.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {asset.change >= 0 ? '▲' : '▼'} {Math.abs(asset.change).toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                    <span className="text-zinc-500">Spread:</span>
                    <span className="font-mono text-zinc-300">${formatPrice(depth.spread)}</span>
                    <span className="text-zinc-500 font-mono">({depth.spreadPercent.toFixed(3)}%)</span>
                  </div>
                </div>

                {/* Bids (Buy Orders - Green) */}
                {(orderBookLayout === 'both' || orderBookLayout === 'bids') && (
                  <div className="space-y-0.5">
                    {(orderBookLayout === 'bids' ? depth.bids.slice(0, depthRowCount * 2) : depth.bids.slice(0, depthRowCount))
                      .map((bid, idx) => {
                        const depthPercent = Math.min(100, Math.max(8, (bid.total / maxBidTotal) * 100));
                        return (
                          <div
                            key={`bid-${idx}-${bid.price}`}
                            onClick={() => handleSelectOrderBookPrice(bid.price, 'sell')}
                            className="group relative flex items-center justify-between text-[11px] py-0.5 px-2 rounded cursor-pointer hover:bg-green-500/10 transition-colors select-none overflow-hidden"
                            title={`Click to fill price: $${formatPrice(bid.price)}`}
                          >
                            {/* Cumulative Depth Gradient Bar */}
                            <div
                              className="absolute right-0 top-0 bottom-0 bg-green-500/15 pointer-events-none transition-all duration-300"
                              style={{ width: `${depthPercent}%` }}
                            />
                            <span className="text-green-400 font-bold z-10 group-hover:underline">
                              ${formatPrice(bid.price)}
                            </span>
                            <span className="text-zinc-300 z-10 text-right">
                              {bid.qty >= 100 ? bid.qty.toFixed(2) : bid.qty.toFixed(4)}
                            </span>
                            <span className="text-zinc-500 z-10 text-right text-[10px]">
                              {bid.total >= 100 ? bid.total.toFixed(2) : bid.total.toFixed(3)}
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Order Book Buy/Sell Pressure Gauge */}
              <div className="pt-2 border-t border-zinc-900 space-y-1">
                <div className="flex justify-between text-[9px] font-mono text-zinc-400">
                  <span className="text-green-400 font-bold">Bids: {bidRatioPercent}% ({depth.bidTotal.toFixed(2)})</span>
                  <span className="text-red-400 font-bold">Asks: {askRatioPercent}% ({depth.askTotal.toFixed(2)})</span>
                </div>
                <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden flex">
                  <div 
                    className="bg-green-500 h-full transition-all duration-500" 
                    style={{ width: `${bidRatioPercent}%` }} 
                  />
                  <div 
                    className="bg-red-500 h-full transition-all duration-500" 
                    style={{ width: `${askRatioPercent}%` }} 
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Trades View */
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500 px-1 mb-2">
                <span>Price (USDT)</span>
                <span>Amount ({asset.symbol})</span>
                <span>Time</span>
              </div>
              {trades.length === 0 ? (
                <div className="text-center text-xs text-zinc-600 py-4">Waiting for live trades...</div>
              ) : (
                trades.slice(0, 10).map((trade, idx) => (
                  <div key={`${trade.id}-${idx}`} className="flex justify-between text-xs font-mono py-0.5 px-1 animate-in fade-in slide-in-from-top-1 duration-200">
                    <span className={trade.isBuyerMaker ? 'text-red-400 font-bold' : 'text-green-400 font-bold'}>
                      ${formatPrice(parseFloat(trade.price))}
                    </span>
                    <span className="text-zinc-300">
                      {parseFloat(trade.qty).toString()}
                    </span>
                    <span className="text-zinc-600 text-[11px]">
                      {new Date(trade.time).toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second:'2-digit' })}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Pending Orders Section */}
        <div className="mt-8 pt-6 border-t border-zinc-900">
          <div className="flex items-center gap-2 text-zinc-400 mb-4">
            <Clock className="h-4 w-4 text-yellow-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Pending Orders</span>
          </div>
          {pendingOrders.length === 0 ? (
            <div className="text-center text-xs text-zinc-600 py-4">No pending orders</div>
          ) : (
            <div className="space-y-2 text-xs">
              {pendingOrders.map(order => (
                <div key={order.id} className="flex justify-between items-center bg-zinc-900/50 rounded-lg p-3 border border-zinc-800">
                  <div>
                    <span className={order.type === 'buy' ? 'text-green-500 font-bold' : 'text-red-500 font-bold'}>
                      {order.type === 'buy' ? 'Buy' : 'Sell'} Limit {order.leverage}x
                    </span>
                    <div className="text-[10px] text-zinc-500 mt-1">{new Date(order.time).toLocaleTimeString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-zinc-100 font-mono font-bold">${parseFloat(order.price).toLocaleString()}</div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-1">{order.amount} {order.symbol}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Wallet Balance Info */}
        <div className="mt-8 pt-6 border-t border-zinc-900">
          <div className="flex items-center gap-2 text-zinc-400 mb-4">
            <Wallet className="h-4 w-4 text-yellow-500" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Wallet Balance</span>
          </div>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-xs text-zinc-500 font-medium">Available</span>
              <span className="text-sm text-zinc-100 font-mono font-bold">{displayBalance}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-zinc-500 font-medium whitespace-nowrap overflow-hidden text-ellipsis mr-4">Address</span>
              <span className="text-sm text-zinc-100 font-mono font-bold">{address ? `${address.slice(0,6)}...${address.slice(-4)}` : 'Not Connected'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 pt-3 border-t border-zinc-900 flex items-center justify-between shrink-0">
        <span className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold">Official Platform</span>
        <span className="text-[10px] text-yellow-500/40 font-mono">www.binanceph.ai</span>
      </div>
    </div>
  );
}
