import { Time } from 'lightweight-charts';
import { RSI, MACD, BollingerBands, EMA, SMA } from 'technicalindicators';
import { KlinePoint } from './binance';

export type IndicatorType = 'rsi' | 'macd' | 'bb' | 'ema';

export interface RSIPoint {
  time: Time;
  value: number;
}

export interface MACDPoint {
  time: Time;
  value: number;
}

export interface MACDHistogramPoint {
  time: Time;
  value: number;
  color: string;
}

export interface MACDSeriesData {
  macd: MACDPoint[];
  signal: MACDPoint[];
  histogram: MACDHistogramPoint[];
}

export interface LinePoint {
  time: Time;
  value: number;
}

export interface BollingerBandsData {
  upper: LinePoint[];
  middle: LinePoint[];
  lower: LinePoint[];
}

export interface EMASeriesData {
  ema7: LinePoint[];
  ema25: LinePoint[];
  ema99: LinePoint[];
}

/**
 * Calculates Relative Strength Index (RSI) using standard 14-period Wilder's smoothing
 */
export function calculateRSI(points: KlinePoint[], period: number = 14): RSIPoint[] {
  if (!points || points.length <= period) return [];

  const values = points.map((p) => p.close ?? p.value);
  try {
    const rsiValues = RSI.calculate({
      values,
      period,
    });

    // Match times: RSI values start at index (period)
    const offset = points.length - rsiValues.length;
    return rsiValues.map((val, idx) => ({
      time: points[offset + idx].time,
      value: parseFloat(val.toFixed(2)),
    }));
  } catch (err) {
    console.warn('RSI calculation error:', err);
    return [];
  }
}

/**
 * Calculates Moving Average Convergence Divergence (MACD)
 * Standard parameters: fast = 12, slow = 26, signal = 9
 */
export function calculateMACD(
  points: KlinePoint[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDSeriesData {
  if (!points || points.length <= slowPeriod + signalPeriod) {
    return { macd: [], signal: [], histogram: [] };
  }

  const values = points.map((p) => p.close ?? p.value);
  try {
    const results = MACD.calculate({
      values,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    const offset = points.length - results.length;
    const macd: MACDPoint[] = [];
    const signal: MACDPoint[] = [];
    const histogram: MACDHistogramPoint[] = [];

    results.forEach((item, idx) => {
      const time = points[offset + idx].time;
      if (item.MACD !== undefined && item.signal !== undefined && item.histogram !== undefined) {
        macd.push({ time, value: parseFloat(item.MACD.toFixed(4)) });
        signal.push({ time, value: parseFloat(item.signal.toFixed(4)) });
        histogram.push({
          time,
          value: parseFloat(item.histogram.toFixed(4)),
          color: item.histogram >= 0 ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)',
        });
      }
    });

    return { macd, signal, histogram };
  } catch (err) {
    console.warn('MACD calculation error:', err);
    return { macd: [], signal: [], histogram: [] };
  }
}

/**
 * Calculates Bollinger Bands (BB)
 * Standard parameters: period = 20, stdDev = 2
 */
export function calculateBollingerBands(
  points: KlinePoint[],
  period: number = 20,
  stdDev: number = 2
): BollingerBandsData {
  if (!points || points.length <= period) {
    return { upper: [], middle: [], lower: [] };
  }

  const values = points.map((p) => p.close ?? p.value);
  try {
    const results = BollingerBands.calculate({
      values,
      period,
      stdDev,
    });

    const offset = points.length - results.length;
    const upper: LinePoint[] = [];
    const middle: LinePoint[] = [];
    const lower: LinePoint[] = [];

    results.forEach((item, idx) => {
      const time = points[offset + idx].time;
      if (item.upper !== undefined && item.middle !== undefined && item.lower !== undefined) {
        upper.push({ time, value: parseFloat(item.upper.toFixed(4)) });
        middle.push({ time, value: parseFloat(item.middle.toFixed(4)) });
        lower.push({ time, value: parseFloat(item.lower.toFixed(4)) });
      }
    });

    return { upper, middle, lower };
  } catch (err) {
    console.warn('Bollinger Bands calculation error:', err);
    return { upper: [], middle: [], lower: [] };
  }
}

/**
 * Calculates Triple Exponential Moving Averages (EMA 7, 25, 99)
 */
export function calculateEMA(points: KlinePoint[]): EMASeriesData {
  const values = points.map((p) => p.close ?? p.value);
  const computeSingle = (period: number): LinePoint[] => {
    if (points.length <= period) return [];
    try {
      const raw = EMA.calculate({ values, period });
      const offset = points.length - raw.length;
      return raw.map((val, idx) => ({
        time: points[offset + idx].time,
        value: parseFloat(val.toFixed(4)),
      }));
    } catch {
      return [];
    }
  };

  return {
    ema7: computeSingle(7),
    ema25: computeSingle(25),
    ema99: computeSingle(99),
  };
}
