import { SimulatedTrade } from './simulatedTrades';

export type CostBasisMethod = 'FIFO' | 'AVERAGE';
export type TaxStatusFilter = 'filled_only' | 'all';

export interface PhTaxOptions {
  phpRate: number;
  costBasisMethod: CostBasisMethod;
  taxYear: string; // 'ALL' or '2026', etc.
  statusFilter: TaxStatusFilter;
}

export interface PhTaxLedgerRow {
  tradeId: string;
  dateTimePht: string;
  asset: string;
  pair: string;
  orderType: string;
  side: 'Buy' | 'Sell';
  status: 'Open' | 'Filled' | 'Canceled';
  leverage: number;
  quantity: number;
  unitPriceUsdt: number;
  unitPricePhp: number;
  grossTotalUsdt: number;
  grossTotalPhp: number;
  feeUsdt: number;
  feePhp: number;
  netCashflowPhp: number;
  costBasisPhp: number;
  realizedGainLossPhp: number;
  taxClassification: string;
  birReferenceNote: string;
}

export interface PhTaxSummaryMetrics {
  rows: PhTaxLedgerRow[];
  filledBuyCount: number;
  filledSellCount: number;
  nonTaxableCount: number;
  totalAcquisitionsPhp: number;
  totalDisposalsProceedsPhp: number;
  totalDisposalsCostBasisPhp: number;
  totalFeesPhp: number;
  netRealizedGainLossPhp: number;
  estimatedShortTermTaxablePhp: number;
  availableYears: string[];
  phpRate: number;
  costBasisMethod: CostBasisMethod;
}

interface CostLot {
  qty: number;
  unitCostPhp: number;
}

function getTradeTimestampMs(trade: SimulatedTrade): number {
  if (trade.timestampIso) {
    const parsed = Date.parse(trade.timestampIso);
    if (!isNaN(parsed)) return parsed;
  }
  const normalized = trade.time.replace(' ', 'T') + '+08:00';
  const parsed = Date.parse(normalized);
  return isNaN(parsed) ? 0 : parsed;
}

export function getAvailableTaxYears(trades: SimulatedTrade[]): string[] {
  const years = new Set<string>();
  trades.forEach((t) => {
    const match = t.time.match(/^(\d{4})/);
    if (match) years.add(match[1]);
  });
  return Array.from(years).sort((a, b) => b.localeCompare(a));
}

export function computePhTaxSummary(
  trades: SimulatedTrade[],
  options: PhTaxOptions
): PhTaxSummaryMetrics {
  const phpRate = options.phpRate > 0 ? options.phpRate : 58.45;
  const availableYears = getAvailableTaxYears(trades);

  // Sort chronologically ascending so FIFO / Weighted Average lots consume accurately
  const chronological = [...trades].sort(
    (a, b) => getTradeTimestampMs(a) - getTradeTimestampMs(b)
  );

  // Per-asset lot queues (for FIFO) and running pools (for Weighted Average)
  const fifoLots: Record<string, CostLot[]> = {};
  const avgPools: Record<string, { qty: number; totalCostPhp: number }> = {};

  const computedAll: Array<PhTaxLedgerRow & { year: string; ts: number }> = [];

  for (const trade of chronological) {
    const ts = getTradeTimestampMs(trade);
    const yearMatch = trade.time.match(/^(\d{4})/);
    const year = yearMatch ? yearMatch[1] : '2026';

    const feeUsdt =
      trade.feeUsdt !== undefined
        ? trade.feeUsdt
        : trade.status === 'Filled'
        ? Number((trade.total * 0.001).toFixed(4))
        : 0;
    const feePhp = Number((feeUsdt * phpRate).toFixed(2));
    const unitPricePhp = Number((trade.price * phpRate).toFixed(2));
    const grossTotalPhp = Number((trade.total * phpRate).toFixed(2));
    const leverage = trade.leverage ?? 1;

    let costBasisPhp = 0;
    let realizedGainLossPhp = 0;
    let netCashflowPhp = 0;
    let taxClassification = '';
    let birReferenceNote = '';

    if (trade.status !== 'Filled') {
      taxClassification =
        trade.status === 'Open'
          ? 'Pending / Non-Taxable'
          : 'Canceled / Non-Taxable';
      birReferenceNote = 'No completed disposal or acquisition event';
    } else if (trade.side === 'Buy') {
      const totalAcquisitionCostPhp = Number((grossTotalPhp + feePhp).toFixed(2));
      const unitCostPhp =
        trade.amount > 0 ? totalAcquisitionCostPhp / trade.amount : 0;

      if (!fifoLots[trade.asset]) fifoLots[trade.asset] = [];
      fifoLots[trade.asset].push({ qty: trade.amount, unitCostPhp });

      if (!avgPools[trade.asset]) {
        avgPools[trade.asset] = { qty: 0, totalCostPhp: 0 };
      }
      avgPools[trade.asset].qty += trade.amount;
      avgPools[trade.asset].totalCostPhp += totalAcquisitionCostPhp;

      costBasisPhp = totalAcquisitionCostPhp;
      netCashflowPhp = -totalAcquisitionCostPhp;
      realizedGainLossPhp = 0;
      taxClassification = 'Acquisition (Cost Basis Added)';
      birReferenceNote =
        'Capital acquisition; establish PHP cost basis for future disposal';
    } else {
      // Filled Sell (Disposal)
      const netProceedsPhp = Number((grossTotalPhp - feePhp).toFixed(2));
      netCashflowPhp = netProceedsPhp;

      if (options.costBasisMethod === 'FIFO') {
        const lots = fifoLots[trade.asset] || [];
        let remainingToSell = trade.amount;
        let consumedCostPhp = 0;

        while (remainingToSell > 1e-12 && lots.length > 0) {
          const head = lots[0];
          const take = Math.min(remainingToSell, head.qty);
          consumedCostPhp += take * head.unitCostPhp;
          head.qty -= take;
          remainingToSell -= take;
          if (head.qty <= 1e-12) {
            lots.shift();
          }
        }

        // If sold quantity exceeds tracked buys in demo log, fallback cost basis for remainder
        if (remainingToSell > 1e-12) {
          // Assume prior simulated acquisition at ~92% of disposal price so log stays realistic
          consumedCostPhp += remainingToSell * unitPricePhp * 0.92;
        }

        costBasisPhp = Number(consumedCostPhp.toFixed(2));
      } else {
        // Weighted Average Cost Basis
        const pool = avgPools[trade.asset] || { qty: 0, totalCostPhp: 0 };
        if (pool.qty > 1e-12) {
          const avgUnitCostPhp = pool.totalCostPhp / pool.qty;
          const matchedQty = Math.min(trade.amount, pool.qty);
          const unmatchedQty = Math.max(0, trade.amount - matchedQty);
          const matchedCost = matchedQty * avgUnitCostPhp;
          const fallbackCost = unmatchedQty * unitPricePhp * 0.92;

          costBasisPhp = Number((matchedCost + fallbackCost).toFixed(2));
          pool.qty = Math.max(0, pool.qty - matchedQty);
          pool.totalCostPhp = Math.max(0, pool.totalCostPhp - matchedCost);
        } else {
          costBasisPhp = Number((trade.amount * unitPricePhp * 0.92).toFixed(2));
        }
      }

      realizedGainLossPhp = Number((netProceedsPhp - costBasisPhp).toFixed(2));
      taxClassification =
        realizedGainLossPhp >= 0
          ? 'Disposal (Realized Gain)'
          : 'Disposal (Realized Loss)';
      birReferenceNote =
        'Potentially reportable under NIRC Sec. 24(A)/32(A) (BIR Form 1701/1701A/1700)';
    }

    computedAll.push({
      tradeId: trade.id,
      dateTimePht: `${trade.time} PHT`,
      asset: trade.asset,
      pair: `${trade.asset}/USDT`,
      orderType: trade.type,
      side: trade.side,
      status: trade.status,
      leverage,
      quantity: trade.amount,
      unitPriceUsdt: trade.price,
      unitPricePhp,
      grossTotalUsdt: trade.total,
      grossTotalPhp,
      feeUsdt,
      feePhp,
      netCashflowPhp,
      costBasisPhp,
      realizedGainLossPhp,
      taxClassification,
      birReferenceNote,
      year,
      ts,
    });
  }

  // Apply user's taxYear and status filters after accurate chronological cost-basis computation
  const filteredRows = computedAll
    .filter((row) => {
      if (options.taxYear !== 'ALL' && row.year !== options.taxYear) return false;
      if (options.statusFilter === 'filled_only' && row.status !== 'Filled') {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.ts - a.ts);

  let filledBuyCount = 0;
  let filledSellCount = 0;
  let nonTaxableCount = 0;
  let totalAcquisitionsPhp = 0;
  let totalDisposalsProceedsPhp = 0;
  let totalDisposalsCostBasisPhp = 0;
  let totalFeesPhp = 0;
  let netRealizedGainLossPhp = 0;

  filteredRows.forEach((r) => {
    totalFeesPhp += r.feePhp;
    if (r.status !== 'Filled') {
      nonTaxableCount += 1;
    } else if (r.side === 'Buy') {
      filledBuyCount += 1;
      totalAcquisitionsPhp += r.grossTotalPhp;
    } else {
      filledSellCount += 1;
      totalDisposalsProceedsPhp += r.grossTotalPhp - r.feePhp;
      totalDisposalsCostBasisPhp += r.costBasisPhp;
      netRealizedGainLossPhp += r.realizedGainLossPhp;
    }
  });

  return {
    rows: filteredRows,
    filledBuyCount,
    filledSellCount,
    nonTaxableCount,
    totalAcquisitionsPhp: Number(totalAcquisitionsPhp.toFixed(2)),
    totalDisposalsProceedsPhp: Number(totalDisposalsProceedsPhp.toFixed(2)),
    totalDisposalsCostBasisPhp: Number(totalDisposalsCostBasisPhp.toFixed(2)),
    totalFeesPhp: Number(totalFeesPhp.toFixed(2)),
    netRealizedGainLossPhp: Number(netRealizedGainLossPhp.toFixed(2)),
    estimatedShortTermTaxablePhp: Number(
      Math.max(0, netRealizedGainLossPhp).toFixed(2)
    ),
    availableYears,
    phpRate,
    costBasisMethod: options.costBasisMethod,
  };
}

function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildPhTaxCsvContent(
  summary: PhTaxSummaryMetrics,
  options: PhTaxOptions,
  accountLabel?: string
): string {
  const generatedAt = new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const lines: string[] = [];

  // Metadata Header Block
  lines.push(
    [
      'BINANCEPH SIMULATED CRYPTO TAX SUMMARY (PHILIPPINES / BIR PREPARATION AID)',
    ]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    ['Generated At (PHT)', `${generatedAt} PHT`].map(escapeCsvField).join(',')
  );
  lines.push(
    ['Trader Account', accountLabel || 'BINANCEPH Demo / Preview Account']
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    ['Tax Year Filter', options.taxYear === 'ALL' ? 'All Years' : options.taxYear]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    ['Cost Basis Method', summary.costBasisMethod].map(escapeCsvField).join(',')
  );
  lines.push(
    ['FX Reference Rate (PHP/USDT)', summary.phpRate.toFixed(2)]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    [
      'Disclaimer',
      'SIMULATED TRADING DATA FOR INFORMATIONAL TAX CALCULATION ONLY. Consult a Philippine CPA or BIR-accredited tax practitioner before filing.',
    ]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push('');

  // Column Headers
  const headers = [
    'Trade ID',
    'Timestamp (PHT)',
    'Asset',
    'Pair',
    'Order Type',
    'Side',
    'Status',
    'Leverage',
    'Quantity',
    'Unit Price (USDT)',
    'Unit Price (PHP)',
    'Gross Total (USDT)',
    'Gross Total (PHP)',
    'Est. Trading Fee (USDT)',
    'Est. Trading Fee (PHP)',
    'Cost Basis (PHP)',
    'Realized Gain / Loss (PHP)',
    'Tax Classification',
    'BIR Reference Note',
  ];
  lines.push(headers.map(escapeCsvField).join(','));

  // Ledger Rows
  summary.rows.forEach((row) => {
    lines.push(
      [
        row.tradeId,
        row.dateTimePht,
        row.asset,
        row.pair,
        row.orderType,
        row.side,
        row.status,
        `${row.leverage}x`,
        row.quantity,
        row.unitPriceUsdt.toFixed(4),
        row.unitPricePhp.toFixed(2),
        row.grossTotalUsdt.toFixed(2),
        row.grossTotalPhp.toFixed(2),
        row.feeUsdt.toFixed(4),
        row.feePhp.toFixed(2),
        row.costBasisPhp.toFixed(2),
        row.realizedGainLossPhp.toFixed(2),
        row.taxClassification,
        row.birReferenceNote,
      ]
        .map(escapeCsvField)
        .join(',')
    );
  });

  // Aggregate Summary Block
  lines.push('');
  lines.push(['AGGREGATE SUMMARY (PHP)'].map(escapeCsvField).join(','));
  lines.push(
    ['Total Filled Acquisitions (Buy Count)', summary.filledBuyCount]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    ['Total Filled Disposals (Sell Count)', summary.filledSellCount]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    ['Total Acquisitions Value (PHP)', summary.totalAcquisitionsPhp.toFixed(2)]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    [
      'Total Disposals Net Proceeds (PHP)',
      summary.totalDisposalsProceedsPhp.toFixed(2),
    ]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    [
      'Total Disposals Cost Basis (PHP)',
      summary.totalDisposalsCostBasisPhp.toFixed(2),
    ]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    ['Total Trading Fees Paid (PHP)', summary.totalFeesPhp.toFixed(2)]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    [
      'Net Realized Gain / Loss (PHP)',
      summary.netRealizedGainLossPhp.toFixed(2),
    ]
      .map(escapeCsvField)
      .join(',')
  );
  lines.push(
    [
      'Net Positive Taxable Gain Estimate (PHP)',
      summary.estimatedShortTermTaxablePhp.toFixed(2),
    ]
      .map(escapeCsvField)
      .join(',')
  );

  // Prepend UTF-8 BOM for clean Excel / Google Sheets opening
  return '\uFEFF' + lines.join('\r\n');
}

export function downloadPhTaxCsv(
  summary: PhTaxSummaryMetrics,
  options: PhTaxOptions,
  accountLabel?: string
): string {
  const csv = buildPhTaxCsvContent(summary, options, accountLabel);
  const dateSlug = new Date().toISOString().slice(0, 10);
  const yearSlug = options.taxYear === 'ALL' ? 'all-years' : options.taxYear;
  const filename = `binanceph-ph-crypto-tax-${yearSlug}-${options.costBasisMethod.toLowerCase()}-${dateSlug}.csv`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return filename;
}
