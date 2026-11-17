import React, { useState, useMemo } from 'react';
import { Asset } from './AssetList';
import { Button } from './ui/button';
import {
  Sparkles,
  Loader2,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Plus,
  X,
  RotateCcw,
  Scale,
  Coins,
  Info,
  Play,
} from 'lucide-react';

export interface RebalanceAllocationItem {
  symbol: string;
  name: string;
  quantity: number;
  price: number;
  change24h: number;
  valueUsdt: number;
  sharePct: number;
}

export interface RebalanceTargetWeight {
  symbol: string;
  targetPct: number;
}

export interface GeminiRebalanceStep {
  stepNumber: number;
  action: 'SELL' | 'BUY' | 'HOLD' | string;
  symbol: string;
  quantityDelta: number;
  notionalUsdt: number;
  currentPct: number;
  targetPct: number;
  targetQuantity: number;
  rationale: string;
}

export interface GeminiRebalancePlan {
  strategySummary: string;
  executionOrderNote: string;
  estimatedTotalTurnoverUsdt: number;
  estimatedFeeUsdt: number;
  steps: GeminiRebalanceStep[];
}

interface PortfolioRebalanceSimulatorProps {
  allocation: RebalanceAllocationItem[];
  assets: Asset[];
  totalValueUsdt: number;
  phpRate: number;
  currency: 'USDT' | 'PHP';
  hideBalances: boolean;
  onApplyRebalance: (nextHoldings: Array<{ symbol: string; quantity: number }>) => void;
  hasPendingUndo: boolean;
  onUndoRebalance: () => void;
}

interface StrategyPreset {
  id: string;
  label: string;
  description: string;
  targets: RebalanceTargetWeight[];
}

const STRATEGY_PRESETS: StrategyPreset[] = [
  {
    id: 'btc-eth-60-40',
    label: '60% BTC / 40% ETH',
    description: 'Blue-chip dual-core allocation',
    targets: [
      { symbol: 'BTC', targetPct: 60 },
      { symbol: 'ETH', targetPct: 40 },
    ],
  },
  {
    id: 'majors-50-30-20',
    label: '50% BTC / 30% ETH / 20% SOL',
    description: 'Layer-1 growth basket',
    targets: [
      { symbol: 'BTC', targetPct: 50 },
      { symbol: 'ETH', targetPct: 30 },
      { symbol: 'SOL', targetPct: 20 },
    ],
  },
  {
    id: 'balanced-40-30-20-10',
    label: '40% BTC / 30% ETH / 20% BNB / 10% USDT',
    description: 'Exchange-hedged core with dry powder',
    targets: [
      { symbol: 'BTC', targetPct: 40 },
      { symbol: 'ETH', targetPct: 30 },
      { symbol: 'BNB', targetPct: 20 },
      { symbol: 'USDT', targetPct: 10 },
    ],
  },
  {
    id: 'conservative-35-25-20-20',
    label: '35% BTC / 25% ETH / 20% BNB / 20% USDT',
    description: 'Defensive stablecoin buffer',
    targets: [
      { symbol: 'BTC', targetPct: 35 },
      { symbol: 'ETH', targetPct: 25 },
      { symbol: 'BNB', targetPct: 20 },
      { symbol: 'USDT', targetPct: 20 },
    ],
  },
];

export function PortfolioRebalanceSimulator({
  allocation,
  assets,
  totalValueUsdt,
  phpRate,
  currency,
  hideBalances,
  onApplyRebalance,
  hasPendingUndo,
  onUndoRebalance,
}: PortfolioRebalanceSimulatorProps) {
  const [targets, setTargets] = useState<RebalanceTargetWeight[]>(
    STRATEGY_PRESETS[0].targets
  );
  const [activePresetId, setActivePresetId] = useState<string>(STRATEGY_PRESETS[0].id);
  const [symbolToAdd, setSymbolToAdd] = useState<string>('SOL');
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<GeminiRebalancePlan | null>(null);
  const [usedModel, setUsedModel] = useState<string | null>(null);
  const [appliedNotice, setAppliedNotice] = useState<boolean>(false);

  const availableSymbols = useMemo(() => {
    const set = new Set<string>(['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'WCORE', 'USDT']);
    allocation.forEach((a) => set.add(a.symbol));
    assets.forEach((a) => set.add(a.symbol));
    return Array.from(set);
  }, [allocation, assets]);

  const unallocatedSymbols = useMemo(
    () => availableSymbols.filter((sym) => !targets.some((t) => t.symbol === sym)),
    [availableSymbols, targets]
  );

  const totalTargetPct = useMemo(
    () => targets.reduce((sum, t) => sum + (Number.isFinite(t.targetPct) ? t.targetPct : 0), 0),
    [targets]
  );

  const isTargetSumValid = Math.abs(totalTargetPct - 100) <= 0.5;

  const resolvePriceUsdt = (symbol: string): number => {
    if (symbol === 'USDT') return 1.0;
    const fromAssets = assets.find((a) => a.symbol === symbol)?.price;
    if (fromAssets && fromAssets > 0) return fromAssets;
    const fromAllocation = allocation.find((a) => a.symbol === symbol)?.price;
    return fromAllocation || 0;
  };

  const formatFiat = (usdtVal: number) => {
    if (hideBalances) return '••••••••';
    const rate = currency === 'PHP' ? phpRate : 1;
    const sym = currency === 'PHP' ? '₱' : '$';
    return `${sym}${(usdtVal * rate).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatQty = (qty: number) => {
    if (hideBalances) return '••••';
    if (qty >= 1000) {
      return qty.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    if (qty >= 1) {
      return qty.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    }
    return qty.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  };

  const handleSelectPreset = (preset: StrategyPreset) => {
    setActivePresetId(preset.id);
    setTargets(preset.targets.map((t) => ({ ...t })));
    setError(null);
    setAppliedNotice(false);
  };

  const handleTargetPctChange = (symbol: string, rawVal: string) => {
    const parsed = rawVal === '' ? 0 : parseFloat(rawVal);
    setActivePresetId('custom');
    setTargets((prev) =>
      prev.map((item) =>
        item.symbol === symbol
          ? { ...item, targetPct: Number.isFinite(parsed) && parsed >= 0 ? Math.min(100, parsed) : 0 }
          : item
      )
    );
    setAppliedNotice(false);
  };

  const handleRemoveTarget = (symbol: string) => {
    if (targets.length <= 1) return;
    setActivePresetId('custom');
    setTargets((prev) => prev.filter((t) => t.symbol !== symbol));
    setAppliedNotice(false);
  };

  const handleAddTargetSymbol = () => {
    const candidate = unallocatedSymbols.includes(symbolToAdd)
      ? symbolToAdd
      : unallocatedSymbols[0];
    if (!candidate) return;
    setActivePresetId('custom');
    const remaining = Math.max(0, Number((100 - totalTargetPct).toFixed(1)));
    setTargets((prev) => [...prev, { symbol: candidate, targetPct: remaining }]);
    const nextUnallocated = unallocatedSymbols.filter((s) => s !== candidate);
    if (nextUnallocated.length > 0) {
      setSymbolToAdd(nextUnallocated[0]);
    }
    setAppliedNotice(false);
  };

  const handleNormalizeTo100 = () => {
    if (totalTargetPct <= 0) return;
    setActivePresetId('custom');
    setTargets((prev) => {
      const scaled = prev.map((t) => ({
        ...t,
        targetPct: Number(((t.targetPct / totalTargetPct) * 100).toFixed(1)),
      }));
      const scaledSum = scaled.reduce((s, t) => s + t.targetPct, 0);
      if (scaled.length > 0 && Math.abs(scaledSum - 100) > 0.01) {
        scaled[0].targetPct = Number((scaled[0].targetPct + (100 - scaledSum)).toFixed(1));
      }
      return scaled;
    });
  };

  const runSimulation = async (overrideTargets?: RebalanceTargetWeight[]) => {
    const activeTargets = overrideTargets || targets;
    const sum = activeTargets.reduce((s, t) => s + t.targetPct, 0);
    if (Math.abs(sum - 100) > 0.5) {
      setError(`Target weights must equal 100% (currently ${sum.toFixed(1)}%).`);
      return;
    }

    if (totalValueUsdt <= 0) {
      setError('Portfolio total value must be greater than $0 to simulate a rebalance.');
      return;
    }

    setIsSimulating(true);
    setError(null);
    setAppliedNotice(false);

    try {
      const response = await fetch('/api/gemini/rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdings: allocation.map((item) => ({
            symbol: item.symbol,
            name: item.name,
            quantity: item.quantity,
            priceUsdt: item.price,
            valueUsdt: item.valueUsdt,
            currentPct: Number(item.sharePct.toFixed(2)),
          })),
          targetAllocation: activeTargets.map((t) => ({
            symbol: t.symbol,
            targetPct: t.targetPct,
            priceUsdt: resolvePriceUsdt(t.symbol),
          })),
          totalValueUsdt,
          phpRate,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload?.error || `Gemini API returned HTTP ${response.status}`);
      }

      setPlan(payload.plan as GeminiRebalancePlan);
      setUsedModel(payload.model || 'gemini-4-hydrogen');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to complete Gemini rebalance simulation.'
      );
      setPlan(null);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleApplyPlanToDemo = () => {
    if (!plan) return;
    const updatedMap = new Map<string, number>();

    // Start with zeroed or existing symbols, then apply target quantities from Gemini plan
    allocation.forEach((item) => {
      updatedMap.set(item.symbol, item.quantity);
    });

    plan.steps.forEach((step) => {
      const sym = step.symbol.toUpperCase();
      updatedMap.set(sym, Math.max(0, Number(step.targetQuantity) || 0));
    });

    const nextHoldings = Array.from(updatedMap.entries())
      .filter(([, qty]) => qty > 0)
      .map(([symbol, quantity]) => ({ symbol, quantity }));

    if (nextHoldings.length === 0) return;
    onApplyRebalance(nextHoldings);
    setAppliedNotice(true);
  };

  const sellCount = plan ? plan.steps.filter((s) => s.action === 'SELL').length : 0;
  const buyCount = plan ? plan.steps.filter((s) => s.action === 'BUY').length : 0;

  return (
    <div className="p-4 sm:p-6 bg-gradient-to-br from-zinc-950 via-zinc-900/70 to-indigo-950/20 border-b border-zinc-800 space-y-5">
      {/* Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-sm font-black uppercase tracking-wider text-zinc-100">
              AI Portfolio Rebalance Simulator
            </h3>
            <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/25">
              Gemini Powered · Demo Simulation
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            Analyze your current holdings ({formatFiat(totalValueUsdt)}) and let Gemini calculate step-by-step simulated trades to match your target allocation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasPendingUndo && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onUndoRebalance();
                setAppliedNotice(false);
              }}
              className="h-8 px-3 border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-bold"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5 text-yellow-500" />
              Undo Last Applied Rebalance
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            onClick={() => runSimulation()}
            disabled={isSimulating || !isTargetSumValid || totalValueUsdt <= 0}
            className="h-8 px-4 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-zinc-950 font-black text-xs shadow-lg shadow-cyan-950/50 disabled:opacity-50"
          >
            {isSimulating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                <span>Calculating Strategy…</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
                <span>Simulate Rebalance with Gemini</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Strategy Presets + Custom Target Allocation */}
      <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/75 p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Scale className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
              Target Allocation Strategy
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                isTargetSumValid
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              }`}
            >
              Total: {totalTargetPct.toFixed(1)}%
            </span>
            {!isTargetSumValid && totalTargetPct > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleNormalizeTo100}
                className="h-6 px-2 text-[11px] border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              >
                Normalize to 100%
              </Button>
            )}
          </div>
        </div>

        {/* Preset Strategy Pills */}
        <div className="flex flex-wrap gap-2">
          {STRATEGY_PRESETS.map((preset) => {
            const isSelected = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset)}
                className={`px-3 py-1.5 rounded-lg border text-left transition-all ${
                  isSelected
                    ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                    : 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                <div className="text-[11px] font-mono font-bold">{preset.label}</div>
                <div className="text-[10px] text-zinc-500">{preset.description}</div>
              </button>
            );
          })}
        </div>

        {/* Editable Target Weight Tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {targets.map((target) => {
            const currentItem = allocation.find((a) => a.symbol === target.symbol);
            const currentPct = currentItem ? currentItem.sharePct : 0;
            const livePrice = resolvePriceUsdt(target.symbol);

            return (
              <div
                key={target.symbol}
                className="p-2.5 rounded-xl bg-zinc-900/90 border border-zinc-800 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-zinc-100">{target.symbol}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-zinc-500">
                      Now: {currentPct.toFixed(1)}%
                    </span>
                    {targets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTarget(target.symbol)}
                        className="text-zinc-500 hover:text-red-400 transition-colors"
                        title={`Remove ${target.symbol} from target`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded-lg px-2 h-8">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    aria-label={`Target percentage for ${target.symbol}`}
                    value={target.targetPct}
                    onChange={(e) => handleTargetPctChange(target.symbol, e.target.value)}
                    className="w-full bg-transparent text-xs font-mono font-bold text-cyan-400 focus:outline-none"
                  />
                  <span className="text-[11px] font-mono text-zinc-500">%</span>
                </div>

                <div className="text-[10px] font-mono text-zinc-500 truncate">
                  Target Val: {formatFiat((totalValueUsdt * target.targetPct) / 100)}
                  {livePrice <= 0 && (
                    <span className="text-amber-400 ml-1">(No Price)</span>
                  )}
                </div>
              </div>
            );
          })}

          {unallocatedSymbols.length > 0 && (
            <div className="p-2.5 rounded-xl bg-zinc-900/40 border border-dashed border-zinc-800 flex flex-col justify-between space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Add Asset Weight
              </span>
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Select asset to add to target allocation"
                  value={unallocatedSymbols.includes(symbolToAdd) ? symbolToAdd : unallocatedSymbols[0]}
                  onChange={(e) => setSymbolToAdd(e.target.value)}
                  className="h-8 flex-1 min-w-0 px-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono font-bold text-zinc-200 focus:outline-none"
                >
                  {unallocatedSymbols.map((sym) => (
                    <option key={sym} value={sym}>
                      {sym}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddTargetSymbol}
                  className="h-8 px-2.5 border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-cyan-400"
                  title="Add asset to target allocation"
                >
                  <Plus className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-2.5 text-xs text-red-300">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold text-red-200">Gemini Rebalance Calculation Error</div>
            <div className="font-mono text-[11px] text-red-300/90">{error}</div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {isSimulating && (
        <div className="p-6 rounded-xl border border-cyan-500/20 bg-zinc-950/70 flex flex-col items-center justify-center gap-2.5 text-center">
          <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
          <div className="text-xs font-bold text-zinc-200">
            Analyzing {allocation.length} portfolio positions with Gemini…
          </div>
          <div className="text-[11px] text-zinc-500">
            Computing weight drift, sell-before-buy sequencing, and exact simulated trade quantities.
          </div>
        </div>
      )}

      {/* Gemini Rebalance Results */}
      {!isSimulating && plan && (
        <div className="space-y-4">
          {/* Strategy Overview & KPIs */}
          <div className="rounded-xl border border-cyan-500/30 bg-zinc-950/85 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Coins className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-black uppercase tracking-wider text-zinc-100">
                  Gemini Rebalance Strategy
                </span>
                {usedModel && (
                  <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-cyan-400">
                    {usedModel}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApplyPlanToDemo}
                  className="h-7 px-3 bg-emerald-500 hover:bg-emerald-600 text-black font-black text-[11px]"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  Apply Simulated Rebalance
                </Button>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-zinc-300">
              {plan.strategySummary}
            </p>
            <p className="text-[11px] font-mono text-cyan-300/90 bg-cyan-500/5 border border-cyan-500/15 rounded-lg px-3 py-2">
              {plan.executionOrderNote}
            </p>

            {appliedNotice && (
              <div className="px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  Simulated rebalance applied to your demo portfolio holdings above.
                </span>
                {hasPendingUndo && (
                  <button
                    type="button"
                    onClick={() => {
                      onUndoRebalance();
                      setAppliedNotice(false);
                    }}
                    className="underline font-bold text-emerald-200 hover:text-white"
                  >
                    Undo
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              <div className="p-3 rounded-lg bg-zinc-900/70 border border-zinc-800">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Simulated Trade Volume
                </div>
                <div className="text-sm font-mono font-black text-zinc-100 tabular-nums mt-0.5">
                  {formatFiat(plan.estimatedTotalTurnoverUsdt)}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-zinc-900/70 border border-zinc-800">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Est. 0.1% Spot Fee
                </div>
                <div className="text-sm font-mono font-black text-yellow-400 tabular-nums mt-0.5">
                  {formatFiat(plan.estimatedFeeUsdt)}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-zinc-900/70 border border-zinc-800">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Trade Operations
                </div>
                <div className="text-sm font-mono font-black text-zinc-100 mt-0.5 flex items-center gap-2">
                  <span className="text-red-400">{sellCount} SELL</span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-emerald-400">{buyCount} BUY</span>
                </div>
              </div>
            </div>
          </div>

          {/* Step-by-Step Simulated Trade Plan */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/90 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                Recommended Simulated Trade Steps
              </span>
              <span className="text-[11px] font-mono text-zinc-500">
                {plan.steps.length} {plan.steps.length === 1 ? 'position' : 'positions'} analyzed
              </span>
            </div>

            <div className="divide-y divide-zinc-800/70">
              {plan.steps.map((step) => {
                const actionUpper = String(step.action || '').toUpperCase();
                const badgeStyle =
                  actionUpper === 'SELL'
                    ? 'bg-red-500/15 text-red-400 border-red-500/30'
                    : actionUpper === 'BUY'
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-zinc-800 text-zinc-300 border-zinc-700';

                return (
                  <div
                    key={`${step.stepNumber}-${step.symbol}`}
                    className="p-3.5 sm:px-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-zinc-900/40 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-[11px] font-mono font-bold text-zinc-400 shrink-0 mt-0.5">
                        {step.stepNumber}
                      </div>

                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded border text-[10px] font-mono font-black uppercase ${badgeStyle}`}
                          >
                            {actionUpper}
                          </span>
                          <span className="text-sm font-black text-zinc-100">
                            {actionUpper === 'HOLD'
                              ? `${step.symbol} (On Target)`
                              : `${formatQty(step.quantityDelta)} ${step.symbol}`}
                          </span>
                          <span className="text-xs font-mono text-zinc-400 flex items-center gap-1">
                            <span>{step.currentPct.toFixed(1)}%</span>
                            <ArrowRight className="w-3 h-3 text-zinc-600" />
                            <span className="text-cyan-400 font-bold">
                              {step.targetPct.toFixed(1)}%
                            </span>
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 leading-snug">
                          {step.rationale}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between lg:justify-end gap-5 pl-9 lg:pl-0 shrink-0 font-mono">
                      <div className="text-left lg:text-right">
                        <div className="text-[10px] uppercase text-zinc-500">Order Value</div>
                        <div className="text-xs font-bold text-zinc-100 tabular-nums">
                          {actionUpper === 'HOLD' ? '—' : formatFiat(step.notionalUsdt)}
                        </div>
                      </div>

                      <div className="text-right min-w-[96px]">
                        <div className="text-[10px] uppercase text-zinc-500">Target Holding</div>
                        <div className="text-xs font-bold text-zinc-300 tabular-nums">
                          {formatQty(step.targetQuantity)} {step.symbol}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Simulation Disclaimer */}
      <div className="flex items-start gap-2 text-[11px] text-zinc-500 bg-zinc-950/60 border border-zinc-800/80 rounded-xl px-3.5 py-2.5">
        <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
        <span>
          <strong>Simulation Only:</strong> Gemini calculates hypothetical rebalance steps using live CoinGecko spot prices and your demo portfolio quantities. No real trades, deposits, or on-chain transactions are executed, and output is not financial advice.
        </span>
      </div>
    </div>
  );
}
