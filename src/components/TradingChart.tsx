import { useEffect, useRef, useState, useCallback } from 'react';
import { 
  createChart, 
  ColorType, 
  CrosshairMode, 
  IChartApi, 
  ISeriesApi, 
  Time, 
  CandlestickSeries, 
  AreaSeries, 
  HistogramSeries,
  LineSeries,
  MouseEventParams
} from 'lightweight-charts';
import { Asset } from './AssetList';
import { 
  Maximize2, 
  Minimize2, 
  BarChart2, 
  Activity, 
  Wifi, 
  Bell, 
  TrendingUp, 
  TrendingDown, 
  Eye, 
  EyeOff,
  Layers,
  ChevronDown,
  Check
} from 'lucide-react';
import { fetchLiveBinanceKlines, KlinePoint, VolumePoint, formatPrice } from '@/lib/binance';
import { 
  IndicatorType, 
  calculateRSI, 
  calculateMACD, 
  calculateBollingerBands, 
  calculateEMA 
} from '@/lib/indicators';

export interface OHLCData {
  time: number | string;
  formattedTime: string;
  formattedDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  volume?: number;
  isBullish: boolean;
  amplitude: number;
  amplitudePercent: number;
}

function formatTimestamp(time: Time): { date: string; time: string; full: string } {
  let dateObj: Date;
  if (typeof time === 'number') {
    dateObj = new Date(time * 1000);
  } else if (typeof time === 'string') {
    dateObj = new Date(time);
  } else if (time && typeof time === 'object' && 'year' in time) {
    dateObj = new Date((time as any).year, (time as any).month - 1, (time as any).day);
  } else {
    dateObj = new Date();
  }

  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const hh = String(dateObj.getHours()).padStart(2, '0');
  const min = String(dateObj.getMinutes()).padStart(2, '0');
  const ss = String(dateObj.getSeconds()).padStart(2, '0');

  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${min}:${ss}`,
    full: `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`,
  };
}

export function TradingChart({
  asset,
  onOpenPriceAlert,
  activeAlertCount = 0,
}: {
  asset: Asset;
  onOpenPriceAlert?: (asset: Asset) => void;
  activeAlertCount?: number;
}) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Technical Indicator Series Refs
  // RSI (14)
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiOverboughtRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiOversoldRef = useRef<ISeriesApi<"Line"> | null>(null);

  // MACD (12, 26, 9)
  const macdLineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Bollinger Bands (20, 2)
  const bbUpperRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMiddleRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<"Line"> | null>(null);

  // EMA (7, 25, 99)
  const ema7Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema25Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema99Ref = useRef<ISeriesApi<"Line"> | null>(null);

  const lastPriceRef = useRef<number>(asset?.price || 100);
  const lastBarTimeRef = useRef<number>(0);
  const currentChartTypeRef = useRef<'candlestick' | 'area'>('candlestick');
  const isDisposedRef = useRef<boolean>(false);
  const lastWsTickTimeRef = useRef<number>(0);
  const cachedPointsRef = useRef<KlinePoint[]>([]);
  const cachedVolPointsRef = useRef<VolumePoint[]>([]);
  
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chartType, setChartType] = useState<'candlestick' | 'area'>('candlestick');
  const [timeframe, setTimeframe] = useState('1m');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [showFloatingTooltip, setShowFloatingTooltip] = useState(true);

  // Technical Indicators State
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorType>>(new Set(['rsi']));
  const [isIndicatorDropdownOpen, setIsIndicatorDropdownOpen] = useState(false);

  // Current Indicator Values for display
  const [indicatorValues, setIndicatorValues] = useState<{
    rsi?: number;
    macd?: { macd: number; signal: number; histogram: number };
    bb?: { upper: number; middle: number; lower: number };
    ema?: { ema7: number; ema25: number; ema99: number };
  }>({});

  // Hovered OHLC data for crosshair tooltip & HUD
  const [hoveredOHLC, setHoveredOHLC] = useState<OHLCData | null>(null);
  // Default latest OHLC data
  const [latestOHLC, setLatestOHLC] = useState<OHLCData | null>(null);
  // Tooltip position (x, y coordinates inside container)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  currentChartTypeRef.current = chartType;

  // Fallback synthetic data generator if network is completely offline
  const generateFallbackData = useCallback((basePrice: number) => {
    const validBase = typeof basePrice === 'number' && !isNaN(basePrice) && basePrice > 0 ? basePrice : 100;
    const points: KlinePoint[] = [];
    const volPoints: VolumePoint[] = [];
    
    let currentPrice = validBase * 0.98;
    const now = Math.floor(Date.now() / 1000);
    
    for (let i = 80; i >= 0; i--) {
      const barTime = (now - i * 60) as Time;
      const open = Math.max(0.00000001, currentPrice);
      const close = Math.max(0.00000001, open * (1 + (Math.random() * 0.008 - 0.004)));
      const high = Math.max(open, close) * (1 + Math.random() * 0.004);
      const low = Math.max(0.00000001, Math.min(open, close) * (1 - Math.random() * 0.004));
      
      currentPrice = close;
      points.push({ time: barTime, open, high, low, close, value: close });
      volPoints.push({
        time: barTime,
        value: Math.random() * 100 + 50,
        color: close >= open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
      });
    }

    if (points.length > 0) {
      lastBarTimeRef.current = points[points.length - 1].time as number;
    }

    return { points, volPoints };
  }, []);

  // Update latest OHLC snapshot whenever points change
  const updateLatestOHLC = useCallback((points: KlinePoint[], volPoints?: VolumePoint[]) => {
    if (!points || points.length === 0) return;
    const last = points[points.length - 1];
    const open = last.open ?? last.value;
    const high = last.high ?? last.value;
    const low = last.low ?? last.value;
    const close = last.close ?? last.value;
    const change = close - open;
    const changePercent = open > 0 ? (change / open) * 100 : 0;
    const isBullish = close >= open;
    const amplitude = high - low;
    const amplitudePercent = low > 0 ? (amplitude / low) * 100 : 0;
    const vol = volPoints && volPoints.length > 0 ? volPoints[volPoints.length - 1].value : undefined;
    const formatted = formatTimestamp(last.time);

    setLatestOHLC({
      time: last.time as any,
      formattedTime: formatted.time,
      formattedDate: formatted.date,
      open,
      high,
      low,
      close,
      change,
      changePercent,
      volume: vol,
      isBullish,
      amplitude,
      amplitudePercent,
    });
  }, []);

  // Recalculate and push data to active indicator series
  const updateIndicatorSeries = useCallback((points: KlinePoint[]) => {
    if (!points || points.length === 0 || isDisposedRef.current || !chartRef.current) return;

    const valuesToUpdate: {
      rsi?: number;
      macd?: { macd: number; signal: number; histogram: number };
      bb?: { upper: number; middle: number; lower: number };
      ema?: { ema7: number; ema25: number; ema99: number };
    } = {};

    // 1. RSI
    if (activeIndicators.has('rsi')) {
      const rsiData = calculateRSI(points, 14);
      if (rsiSeriesRef.current && rsiData.length > 0) {
        rsiSeriesRef.current.setData(rsiData);
        const latestRSI = rsiData[rsiData.length - 1].value;
        valuesToUpdate.rsi = latestRSI;

        // Draw guideline lines at 70 and 30
        if (rsiOverboughtRef.current && rsiOversoldRef.current) {
          const overbought = rsiData.map((d) => ({ time: d.time, value: 70 }));
          const oversold = rsiData.map((d) => ({ time: d.time, value: 30 }));
          rsiOverboughtRef.current.setData(overbought);
          rsiOversoldRef.current.setData(oversold);
        }
      }
    }

    // 2. MACD
    if (activeIndicators.has('macd')) {
      const macdData = calculateMACD(points, 12, 26, 9);
      if (macdLineRef.current && macdSignalRef.current && macdHistRef.current && macdData.macd.length > 0) {
        macdLineRef.current.setData(macdData.macd);
        macdSignalRef.current.setData(macdData.signal);
        macdHistRef.current.setData(macdData.histogram);

        const lastM = macdData.macd[macdData.macd.length - 1].value;
        const lastS = macdData.signal[macdData.signal.length - 1].value;
        const lastH = macdData.histogram[macdData.histogram.length - 1].value;
        valuesToUpdate.macd = { macd: lastM, signal: lastS, histogram: lastH };
      }
    }

    // 3. Bollinger Bands
    if (activeIndicators.has('bb')) {
      const bbData = calculateBollingerBands(points, 20, 2);
      if (bbUpperRef.current && bbMiddleRef.current && bbLowerRef.current && bbData.upper.length > 0) {
        bbUpperRef.current.setData(bbData.upper);
        bbMiddleRef.current.setData(bbData.middle);
        bbLowerRef.current.setData(bbData.lower);

        const lastU = bbData.upper[bbData.upper.length - 1].value;
        const lastM = bbData.middle[bbData.middle.length - 1].value;
        const lastL = bbData.lower[bbData.lower.length - 1].value;
        valuesToUpdate.bb = { upper: lastU, middle: lastM, lower: lastL };
      }
    }

    // 4. EMA (7, 25, 99)
    if (activeIndicators.has('ema')) {
      const emaData = calculateEMA(points);
      if (ema7Ref.current && ema25Ref.current && ema99Ref.current) {
        if (emaData.ema7.length > 0) ema7Ref.current.setData(emaData.ema7);
        if (emaData.ema25.length > 0) ema25Ref.current.setData(emaData.ema25);
        if (emaData.ema99.length > 0) ema99Ref.current.setData(emaData.ema99);

        const last7 = emaData.ema7.length > 0 ? emaData.ema7[emaData.ema7.length - 1].value : 0;
        const last25 = emaData.ema25.length > 0 ? emaData.ema25[emaData.ema25.length - 1].value : 0;
        const last99 = emaData.ema99.length > 0 ? emaData.ema99[emaData.ema99.length - 1].value : 0;
        valuesToUpdate.ema = { ema7: last7, ema25: last25, ema99: last99 };
      }
    }

    setIndicatorValues((prev) => ({ ...prev, ...valuesToUpdate }));
  }, [activeIndicators]);

  // Synchronize indicator chart series when active indicators change
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || isDisposedRef.current) return;

    // --- RSI Series Setup ---
    if (activeIndicators.has('rsi')) {
      if (!rsiSeriesRef.current) {
        try {
          const rsiSeries = chart.addSeries(LineSeries, {
            color: '#c084fc', // purple-400
            lineWidth: 2,
            priceScaleId: 'rsi_scale',
          });
          const rsiOverbought = chart.addSeries(LineSeries, {
            color: 'rgba(239, 68, 68, 0.4)', // red dashed
            lineWidth: 1,
            lineStyle: 2,
            priceScaleId: 'rsi_scale',
          });
          const rsiOversold = chart.addSeries(LineSeries, {
            color: 'rgba(34, 197, 94, 0.4)', // green dashed
            lineWidth: 1,
            lineStyle: 2,
            priceScaleId: 'rsi_scale',
          });

          rsiSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.78, bottom: 0.02 },
          });

          rsiSeriesRef.current = rsiSeries;
          rsiOverboughtRef.current = rsiOverbought;
          rsiOversoldRef.current = rsiOversold;
        } catch (e) {
          console.warn("Failed to create RSI series:", e);
        }
      }
    } else {
      if (rsiSeriesRef.current) {
        try {
          chart.removeSeries(rsiSeriesRef.current);
          if (rsiOverboughtRef.current) chart.removeSeries(rsiOverboughtRef.current);
          if (rsiOversoldRef.current) chart.removeSeries(rsiOversoldRef.current);
        } catch {}
        rsiSeriesRef.current = null;
        rsiOverboughtRef.current = null;
        rsiOversoldRef.current = null;
      }
    }

    // --- MACD Series Setup ---
    if (activeIndicators.has('macd')) {
      if (!macdLineRef.current) {
        try {
          const macdLine = chart.addSeries(LineSeries, {
            color: '#38bdf8', // sky-400
            lineWidth: 2,
            priceScaleId: 'macd_scale',
          });
          const macdSignal = chart.addSeries(LineSeries, {
            color: '#fb923c', // orange-400
            lineWidth: 1,
            priceScaleId: 'macd_scale',
          });
          const macdHist = chart.addSeries(HistogramSeries, {
            priceScaleId: 'macd_scale',
          });

          macdLine.priceScale().applyOptions({
            scaleMargins: { top: 0.82, bottom: 0.01 },
          });

          macdLineRef.current = macdLine;
          macdSignalRef.current = macdSignal;
          macdHistRef.current = macdHist;
        } catch (e) {
          console.warn("Failed to create MACD series:", e);
        }
      }
    } else {
      if (macdLineRef.current) {
        try {
          chart.removeSeries(macdLineRef.current);
          if (macdSignalRef.current) chart.removeSeries(macdSignalRef.current);
          if (macdHistRef.current) chart.removeSeries(macdHistRef.current);
        } catch {}
        macdLineRef.current = null;
        macdSignalRef.current = null;
        macdHistRef.current = null;
      }
    }

    // --- Bollinger Bands Setup ---
    if (activeIndicators.has('bb')) {
      if (!bbUpperRef.current) {
        try {
          const bbUpper = chart.addSeries(LineSeries, {
            color: '#38bdf8', // cyan
            lineWidth: 1,
            lineStyle: 2, // dashed
          });
          const bbMiddle = chart.addSeries(LineSeries, {
            color: '#fbbf24', // amber
            lineWidth: 1,
          });
          const bbLower = chart.addSeries(LineSeries, {
            color: '#38bdf8', // cyan
            lineWidth: 1,
            lineStyle: 2,
          });

          bbUpperRef.current = bbUpper;
          bbMiddleRef.current = bbMiddle;
          bbLowerRef.current = bbLower;
        } catch (e) {
          console.warn("Failed to create Bollinger Bands series:", e);
        }
      }
    } else {
      if (bbUpperRef.current) {
        try {
          chart.removeSeries(bbUpperRef.current);
          if (bbMiddleRef.current) chart.removeSeries(bbMiddleRef.current);
          if (bbLowerRef.current) chart.removeSeries(bbLowerRef.current);
        } catch {}
        bbUpperRef.current = null;
        bbMiddleRef.current = null;
        bbLowerRef.current = null;
      }
    }

    // --- EMA Setup ---
    if (activeIndicators.has('ema')) {
      if (!ema7Ref.current) {
        try {
          const ema7 = chart.addSeries(LineSeries, {
            color: '#22d3ee', // cyan-400
            lineWidth: 1,
          });
          const ema25 = chart.addSeries(LineSeries, {
            color: '#facc15', // yellow-400
            lineWidth: 1,
          });
          const ema99 = chart.addSeries(LineSeries, {
            color: '#c084fc', // purple-400
            lineWidth: 1,
          });

          ema7Ref.current = ema7;
          ema25Ref.current = ema25;
          ema99Ref.current = ema99;
        } catch (e) {
          console.warn("Failed to create EMA series:", e);
        }
      }
    } else {
      if (ema7Ref.current) {
        try {
          chart.removeSeries(ema7Ref.current);
          if (ema25Ref.current) chart.removeSeries(ema25Ref.current);
          if (ema99Ref.current) chart.removeSeries(ema99Ref.current);
        } catch {}
        ema7Ref.current = null;
        ema25Ref.current = null;
        ema99Ref.current = null;
      }
    }

    // Repopulate data for newly enabled indicators
    if (cachedPointsRef.current.length > 0) {
      updateIndicatorSeries(cachedPointsRef.current);
    }
  }, [activeIndicators, updateIndicatorSeries]);

  // Toggle indicator selection
  const toggleIndicator = (type: IndicatorType) => {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Initialize and mount chart
  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    isDisposedRef.current = false;

    const initialWidth = container.clientWidth > 0 ? container.clientWidth : 600;
    const initialHeight = container.clientHeight > 0 ? container.clientHeight : 350;

    let chart: IChartApi;
    try {
      chart = createChart(container, {
        width: initialWidth,
        height: initialHeight,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: '#A1A1AA', // zinc-400
        },
        grid: {
          vertLines: { color: '#27272a' }, // zinc-800
          horzLines: { color: '#27272a' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: {
            color: '#eab308',
            width: 1,
            style: 2, // Dashed
            labelBackgroundColor: '#27272a',
          },
          horzLine: {
            color: '#eab308',
            width: 1,
            style: 2, // Dashed
            labelBackgroundColor: '#27272a',
          },
        },
        timeScale: {
          borderColor: '#27272a',
          timeVisible: true,
          secondsVisible: false,
        },
        rightPriceScale: {
          borderColor: '#27272a',
          autoScale: true,
        },
      });
    } catch (e) {
      console.warn("Failed to create lightweight chart instance:", e);
      return;
    }

    chartRef.current = chart;

    // Create volume series
    let volumeSeries: ISeriesApi<"Histogram"> | null = null;
    try {
      volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume_scale',
      });
      volumeSeriesRef.current = volumeSeries;

      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });
    } catch (e) {
      console.warn("Error adding volume series:", e);
    }

    // Create price series
    let priceSeries: ISeriesApi<"Candlestick"> | ISeriesApi<"Area"> | null = null;
    try {
      if (currentChartTypeRef.current === 'candlestick') {
        priceSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderVisible: false,
          wickUpColor: '#22c55e',
          wickDownColor: '#ef4444',
        });
      } else {
        priceSeries = chart.addSeries(AreaSeries, {
          lineColor: '#eab308',
          topColor: 'rgba(234, 179, 8, 0.4)',
          bottomColor: 'rgba(234, 179, 8, 0.0)',
          lineWidth: 2,
        });
      }
      seriesRef.current = priceSeries;
    } catch (e) {
      console.warn("Error adding price series:", e);
    }

    // Subscribe to crosshair move event for interactive OHLC tooltips
    const handleCrosshairMove = (param: MouseEventParams) => {
      if (
        !param.point ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        setHoveredOHLC(null);
        setTooltipPos(null);
        return;
      }

      const activeSeries = seriesRef.current;
      if (!activeSeries) {
        setHoveredOHLC(null);
        setTooltipPos(null);
        return;
      }

      const barData = param.seriesData.get(activeSeries) as any;
      if (!barData) {
        setHoveredOHLC(null);
        setTooltipPos(null);
        return;
      }

      const volData = volumeSeriesRef.current ? (param.seriesData.get(volumeSeriesRef.current) as any) : undefined;
      const open = typeof barData.open === 'number' ? barData.open : barData.value;
      const high = typeof barData.high === 'number' ? barData.high : barData.value;
      const low = typeof barData.low === 'number' ? barData.low : barData.value;
      const close = typeof barData.close === 'number' ? barData.close : barData.value;
      const change = close - open;
      const changePercent = open > 0 ? (change / open) * 100 : 0;
      const isBullish = close >= open;
      const amplitude = high - low;
      const amplitudePercent = low > 0 ? (amplitude / low) * 100 : 0;
      const vol = volData && typeof volData.value === 'number' ? volData.value : undefined;
      const formatted = formatTimestamp(param.time);

      setHoveredOHLC({
        time: param.time as any,
        formattedTime: formatted.time,
        formattedDate: formatted.date,
        open,
        high,
        low,
        close,
        change,
        changePercent,
        volume: vol,
        isBullish,
        amplitude,
        amplitudePercent,
      });

      setTooltipPos({ x: param.point.x, y: param.point.y });
    };

    chart.subscribeCrosshairMove(handleCrosshairMove);

    // ResizeObserver for responsive container
    const resizeObserver = new ResizeObserver((entries) => {
      if (isDisposedRef.current || !chartRef.current) return;
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          try {
            chartRef.current.applyOptions({ width, height });
          } catch {
            // suppress transient resize errors
          }
        }
      }
    });

    resizeObserver.observe(container);

    return () => {
      isDisposedRef.current = true;
      resizeObserver.disconnect();
      
      const currentChart = chartRef.current;
      if (currentChart) {
        try {
          currentChart.unsubscribeCrosshairMove(handleCrosshairMove);
        } catch {
          // ignore
        }
      }

      seriesRef.current = null;
      volumeSeriesRef.current = null;
      rsiSeriesRef.current = null;
      rsiOverboughtRef.current = null;
      rsiOversoldRef.current = null;
      macdLineRef.current = null;
      macdSignalRef.current = null;
      macdHistRef.current = null;
      bbUpperRef.current = null;
      bbMiddleRef.current = null;
      bbLowerRef.current = null;
      ema7Ref.current = null;
      ema25Ref.current = null;
      ema99Ref.current = null;
      chartRef.current = null;

      if (currentChart) {
        try {
          currentChart.remove();
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, []);

  // Fetch real Binance candlestick historical data when asset or timeframe changes
  useEffect(() => {
    let isCancelled = false;
    setIsLoadingHistory(true);

    const intervalParam = timeframe === '1s' ? '1m' : timeframe;

    fetchLiveBinanceKlines(asset.symbol, intervalParam, 120)
      .then(({ points, volPoints }) => {
        if (isCancelled || isDisposedRef.current || !chartRef.current) return;

        let finalPoints = points;
        let finalVolPoints = volPoints;

        if (finalPoints.length === 0) {
          const fallback = generateFallbackData(asset?.price || 100);
          finalPoints = fallback.points;
          finalVolPoints = fallback.volPoints;
        }

        cachedPointsRef.current = finalPoints;
        cachedVolPointsRef.current = finalVolPoints;

        if (finalPoints.length > 0) {
          const lastPoint = finalPoints[finalPoints.length - 1];
          lastBarTimeRef.current = lastPoint.time as number;
          lastPriceRef.current = lastPoint.close;
          updateLatestOHLC(finalPoints, finalVolPoints);
          updateIndicatorSeries(finalPoints);
        }

        try {
          if (seriesRef.current) {
            if (currentChartTypeRef.current === 'candlestick') {
              (seriesRef.current as ISeriesApi<"Candlestick">).setData(finalPoints as any);
            } else {
              (seriesRef.current as ISeriesApi<"Area">).setData(finalPoints.map(p => ({ time: p.time, value: p.value })));
            }
          }
          if (volumeSeriesRef.current) {
            volumeSeriesRef.current.setData(finalVolPoints);
          }
          chartRef.current.timeScale().fitContent();
        } catch (e) {
          console.warn("Error setting Binance kline data:", e);
        }
      })
      .catch((err) => {
        console.warn("Failed to load Binance klines, using fallback:", err);
        if (isCancelled || isDisposedRef.current || !chartRef.current) return;
        const fallback = generateFallbackData(asset?.price || 100);
        cachedPointsRef.current = fallback.points;
        cachedVolPointsRef.current = fallback.volPoints;
        updateLatestOHLC(fallback.points, fallback.volPoints);
        updateIndicatorSeries(fallback.points);
        if (seriesRef.current) {
          if (currentChartTypeRef.current === 'candlestick') {
            (seriesRef.current as ISeriesApi<"Candlestick">).setData(fallback.points as any);
          } else {
            (seriesRef.current as ISeriesApi<"Area">).setData(fallback.points.map(p => ({ time: p.time, value: p.value })));
          }
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingHistory(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [asset?.symbol, timeframe, generateFallbackData, updateLatestOHLC, updateIndicatorSeries]);

  // Connect to Binance live kline stream for the active symbol and timeframe
  useEffect(() => {
    let ws: WebSocket | null = null;
    let isMounted = true;
    const intervalParam = timeframe === '1s' ? '1m' : timeframe;
    const streamName = `${asset.symbol.toLowerCase()}usdt@kline_${intervalParam}`;

    const connectKlineWS = () => {
      try {
        ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamName}`);

        ws.onopen = () => {
          if (isMounted) setIsWsConnected(true);
        };

        ws.onmessage = (event) => {
          if (!isMounted || isDisposedRef.current || !seriesRef.current || !volumeSeriesRef.current) return;
          try {
            const data = JSON.parse(event.data);
            if (data.e === 'kline' && data.k) {
              const k = data.k;
              const timeSec = Math.floor(k.t / 1000) as Time;
              const open = parseFloat(k.o);
              const high = parseFloat(k.h);
              const low = parseFloat(k.l);
              const close = parseFloat(k.c);
              const vol = parseFloat(k.v);

              if (isNaN(close) || close <= 0) return;

              lastWsTickTimeRef.current = Date.now();
              lastBarTimeRef.current = timeSec as number;
              lastPriceRef.current = close;

              const isBullish = close >= open;
              const change = close - open;
              const changePercent = open > 0 ? (change / open) * 100 : 0;
              const amplitude = high - low;
              const amplitudePercent = low > 0 ? (amplitude / low) * 100 : 0;
              const formatted = formatTimestamp(timeSec);

              setLatestOHLC({
                time: timeSec as any,
                formattedTime: formatted.time,
                formattedDate: formatted.date,
                open,
                high,
                low,
                close,
                change,
                changePercent,
                volume: vol,
                isBullish,
                amplitude,
                amplitudePercent,
              });

              if (currentChartTypeRef.current === 'candlestick') {
                (seriesRef.current as ISeriesApi<"Candlestick">).update({
                  time: timeSec,
                  open,
                  high,
                  low,
                  close,
                });
              } else {
                (seriesRef.current as ISeriesApi<"Area">).update({
                  time: timeSec,
                  value: close,
                });
              }

              volumeSeriesRef.current.update({
                time: timeSec,
                value: vol,
                color: close >= open ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)',
              });

              // Update cached points with live tick for real-time indicator computation
              const existingPoints = cachedPointsRef.current;
              if (existingPoints.length > 0) {
                const lastIdx = existingPoints.length - 1;
                if (existingPoints[lastIdx].time === timeSec) {
                  existingPoints[lastIdx] = { time: timeSec, open, high, low, close, value: close };
                } else {
                  existingPoints.push({ time: timeSec, open, high, low, close, value: close });
                }
                updateIndicatorSeries(existingPoints);
              }
            }
          } catch {
            // ignore malformed ws messages
          }
        };

        ws.onclose = () => {
          if (isMounted) {
            setIsWsConnected(false);
            // Reconnect after 3 seconds
            setTimeout(connectKlineWS, 3000);
          }
        };

        ws.onerror = () => {
          if (ws) ws.close();
        };
      } catch (err) {
        console.warn("WebSocket init error:", err);
      }
    };

    connectKlineWS();

    return () => {
      isMounted = false;
      setIsWsConnected(false);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [asset?.symbol, timeframe, updateIndicatorSeries]);

  // Handle chartType switch: safely swap price series without losing data
  useEffect(() => {
    if (isDisposedRef.current || !chartRef.current) return;

    const chart = chartRef.current;
    const oldSeries = seriesRef.current;

    try {
      if (oldSeries) {
        chart.removeSeries(oldSeries);
      }
    } catch {
      // old series might already be removed
    }
    seriesRef.current = null;

    try {
      let newSeries: ISeriesApi<"Candlestick"> | ISeriesApi<"Area">;
      if (chartType === 'candlestick') {
        newSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderVisible: false,
          wickUpColor: '#22c55e',
          wickDownColor: '#ef4444',
        });
      } else {
        newSeries = chart.addSeries(AreaSeries, {
          lineColor: '#eab308',
          topColor: 'rgba(234, 179, 8, 0.4)',
          bottomColor: 'rgba(234, 179, 8, 0.0)',
          lineWidth: 2,
        });
      }

      seriesRef.current = newSeries;
      const points = cachedPointsRef.current;
      if (points.length > 0) {
        if (chartType === 'candlestick') {
          newSeries.setData(points as any);
        } else {
          newSeries.setData(points.map(p => ({ time: p.time, value: p.value })));
        }
      }
    } catch (e) {
      console.warn("Error switching chart series type:", e);
    }
  }, [chartType]);

  // Fallback update on asset.price if WebSocket kline stream hasn't ticked recently
  useEffect(() => {
    if (isDisposedRef.current || !seriesRef.current || !volumeSeriesRef.current || !chartRef.current) return;
    if (typeof asset?.price !== 'number' || isNaN(asset.price) || asset.price <= 0) return;

    // If we received a real WS tick in the last 2 seconds, let the WS handle live candle precision
    if (Date.now() - lastWsTickTimeRef.current < 2000) return;

    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const time = Math.max(lastBarTimeRef.current, nowSeconds) as Time;
      lastBarTimeRef.current = time as number;

      const currentPrice = asset.price;
      const open = typeof lastPriceRef.current === 'number' && !isNaN(lastPriceRef.current) && lastPriceRef.current > 0
        ? lastPriceRef.current
        : currentPrice;
      const high = Math.max(open, currentPrice);
      const low = Math.min(open, currentPrice);
      
      lastPriceRef.current = currentPrice;

      if (chartType === 'candlestick') {
        (seriesRef.current as ISeriesApi<"Candlestick">).update({
          time,
          open,
          high,
          low,
          close: currentPrice,
        });
      } else {
        (seriesRef.current as ISeriesApi<"Area">).update({
          time,
          value: currentPrice,
        });
      }
    } catch {
      // Ignore sequencing or transient chart update errors
    }
  }, [asset?.price, chartType]);

  const toggleFullscreen = () => {
    if (!chartContainerRef.current) return;
    if (!isFullscreen) {
      chartContainerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen mode: ${err.message} (${err.name})`);
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isIndicatorDropdownOpen) return;
    const handleOutsideClick = () => setIsIndicatorDropdownOpen(false);
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [isIndicatorDropdownOpen]);

  if (!asset) return null;

  const displayHigh = asset.high24h ? formatPrice(asset.high24h) : formatPrice(asset.price * 1.02);
  const displayLow = asset.low24h ? formatPrice(asset.low24h) : formatPrice(asset.price * 0.98);

  // Active OHLC to display in the header HUD (either hovered candle or latest candle)
  const activeOHLC = hoveredOHLC || latestOHLC;

  // Calculate tooltip dynamic position constrained to container
  const getTooltipStyle = () => {
    if (!tooltipPos || !chartContainerRef.current) return { display: 'none' };
    const containerWidth = chartContainerRef.current.clientWidth;
    const containerHeight = chartContainerRef.current.clientHeight;

    const tooltipWidth = 220;
    const tooltipHeight = 175;
    const offset = 14;

    let left = tooltipPos.x + offset;
    let top = tooltipPos.y + offset;

    // Flip horizontally if overflow on right
    if (left + tooltipWidth > containerWidth - 10) {
      left = tooltipPos.x - tooltipWidth - offset;
    }
    // Clamp left edge
    if (left < 10) left = 10;

    // Flip vertically if overflow on bottom
    if (top + tooltipHeight > containerHeight - 10) {
      top = tooltipPos.y - tooltipHeight - offset;
    }
    // Clamp top edge
    if (top < 10) top = 10;

    return {
      left: `${left}px`,
      top: `${top}px`,
    };
  };

  return (
    <div className={`w-full bg-zinc-950 rounded-xl border border-zinc-800 flex flex-col shadow-2xl shadow-black/50 ${isFullscreen ? 'h-full fixed inset-0 z-50 rounded-none border-none p-4' : 'h-[520px] p-4 sm:p-6'}`}>
      {/* Top Header Row */}
      <div className="flex items-start sm:items-center justify-between mb-3 shrink-0 flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-5 sm:gap-6">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl sm:text-3xl font-black text-zinc-100 tracking-tighter">{asset.symbol}/USDT</h2>
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 text-[10px] font-bold uppercase tracking-wider">
                <span className={`w-1.5 h-1.5 rounded-full ${isWsConnected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                {isWsConnected ? 'Binance Live' : 'Binance Syncing'}
              </div>
            </div>
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{asset.name} Perpetual</span>
          </div>
          <div className="flex flex-col">
            <span className={`text-xl sm:text-2xl font-mono font-bold ${asset.change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              ${formatPrice(asset.price)}
            </span>
            <span className={`text-xs font-mono font-bold ${asset.change >= 0 ? 'text-green-500/80' : 'text-red-500/80'}`}>
              {asset.change >= 0 ? '+' : ''}{asset.change.toFixed(2)}%
            </span>
          </div>
        </div>
        
        {/* Controls Toolbar */}
        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
          {/* Technical Indicators Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsIndicatorDropdownOpen(!isIndicatorDropdownOpen);
              }}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeIndicators.size > 0
                  ? 'bg-zinc-900 border-yellow-500/50 text-yellow-500'
                  : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
              }`}
              title="Technical Indicators (RSI, MACD, Bollinger Bands, EMA)"
            >
              <Layers className="w-3.5 h-3.5 text-yellow-500" />
              <span className="text-[10px] uppercase tracking-wider">Indicators</span>
              {activeIndicators.size > 0 && (
                <span className="bg-yellow-500 text-black text-[9px] font-black px-1.5 py-0.2 rounded-full">
                  {activeIndicators.size}
                </span>
              )}
              <ChevronDown className="w-3 h-3 text-zinc-500 ml-0.5" />
            </button>

            {/* Dropdown Menu */}
            {isIndicatorDropdownOpen && (
              <div 
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-full mt-2 w-56 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/80 rounded-xl shadow-2xl z-40 p-2 text-xs space-y-1 animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                  Technical Indicators
                </div>

                {/* RSI Toggle */}
                <button
                  type="button"
                  onClick={() => toggleIndicator('rsi')}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors text-left ${
                    activeIndicators.has('rsi') ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    <div>
                      <div className="font-bold">RSI (14)</div>
                      <div className="text-[10px] text-zinc-500">Relative Strength Index</div>
                    </div>
                  </div>
                  {activeIndicators.has('rsi') && <Check className="w-3.5 h-3.5 text-yellow-500" />}
                </button>

                {/* MACD Toggle */}
                <button
                  type="button"
                  onClick={() => toggleIndicator('macd')}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors text-left ${
                    activeIndicators.has('macd') ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    <div>
                      <div className="font-bold">MACD (12, 26, 9)</div>
                      <div className="text-[10px] text-zinc-500">Trend & Momentum</div>
                    </div>
                  </div>
                  {activeIndicators.has('macd') && <Check className="w-3.5 h-3.5 text-yellow-500" />}
                </button>

                {/* Bollinger Bands Toggle */}
                <button
                  type="button"
                  onClick={() => toggleIndicator('bb')}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors text-left ${
                    activeIndicators.has('bb') ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <div>
                      <div className="font-bold">Bollinger Bands (20, 2)</div>
                      <div className="text-[10px] text-zinc-500">Volatility Envelope</div>
                    </div>
                  </div>
                  {activeIndicators.has('bb') && <Check className="w-3.5 h-3.5 text-yellow-500" />}
                </button>

                {/* EMA Toggle */}
                <button
                  type="button"
                  onClick={() => toggleIndicator('ema')}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg transition-colors text-left ${
                    activeIndicators.has('ema') ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <div>
                      <div className="font-bold">EMA (7, 25, 99)</div>
                      <div className="text-[10px] text-zinc-500">Triple Moving Averages</div>
                    </div>
                  </div>
                  {activeIndicators.has('ema') && <Check className="w-3.5 h-3.5 text-yellow-500" />}
                </button>
              </div>
            )}
          </div>

          {/* Tooltip Visibility Toggle */}
          <button
            type="button"
            onClick={() => setShowFloatingTooltip(!showFloatingTooltip)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold transition-colors flex items-center gap-1.5 ${
              showFloatingTooltip 
                ? 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30' 
                : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:text-zinc-300'
            }`}
            title={showFloatingTooltip ? "Hide floating OHLC crosshair card" : "Show floating OHLC crosshair card"}
          >
            {showFloatingTooltip ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span className="text-[10px] uppercase tracking-wider hidden sm:inline">OHLC Card</span>
          </button>

          {/* Chart Type Toggle */}
          <div className="flex bg-zinc-900/80 rounded-lg p-1 border border-zinc-800">
            <button
              onClick={() => setChartType('area')}
              className={`p-1.5 rounded-md transition-colors ${chartType === 'area' ? 'bg-zinc-800 text-yellow-500' : 'text-zinc-500 hover:text-zinc-300'}`}
              title="Area Chart"
            >
              <Activity className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('candlestick')}
              className={`p-1.5 rounded-md transition-colors ${chartType === 'candlestick' ? 'bg-zinc-800 text-yellow-500' : 'text-zinc-500 hover:text-zinc-300'}`}
              title="Candlestick Chart"
            >
              <BarChart2 className="w-4 h-4" />
            </button>
          </div>

          {/* Timeframes */}
          <div className="flex gap-1 bg-zinc-900/50 p-1 rounded-lg border border-zinc-800 overflow-x-auto no-scrollbar">
            {['1s', '1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${
                  timeframe === tf ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20 font-extrabold' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {onOpenPriceAlert && (
            <button
              type="button"
              onClick={() => onOpenPriceAlert(asset)}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 rounded-lg border border-zinc-800 hover:border-yellow-500/40 text-zinc-300 hover:text-yellow-500 transition-colors flex items-center gap-1.5 text-xs font-bold"
              title={`Set price alert for ${asset.symbol}/USDT`}
            >
              <Bell className="w-3.5 h-3.5 text-yellow-500" />
              <span>Alert</span>
              {activeAlertCount > 0 && (
                <span className="font-mono text-[10px] text-yellow-500">({activeAlertCount})</span>
              )}
            </button>
          )}

          <button
            onClick={toggleFullscreen}
            className="p-2 bg-zinc-900 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Interactive OHLC HUD Bar (Always visible above chart, updates live on crosshair hover) */}
      <div className="mb-2 px-3 py-1.5 bg-zinc-900/70 border border-zinc-800/80 rounded-lg flex items-center justify-between gap-3 text-xs overflow-x-auto no-scrollbar shrink-0">
        <div className="flex items-center gap-3 sm:gap-4 font-mono">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-zinc-500 uppercase font-bold text-[9px] tracking-wider">
              {hoveredOHLC ? 'Crosshair' : 'Latest'}
            </span>
            <span className="text-zinc-300 font-semibold">
              {activeOHLC ? `${activeOHLC.formattedDate} ${activeOHLC.formattedTime}` : '---'}
            </span>
          </div>

          {activeOHLC && (
            <>
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-zinc-500 font-bold">O</span>
                <span className="text-zinc-200 font-bold">${formatPrice(activeOHLC.open)}</span>
              </div>
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-zinc-500 font-bold">H</span>
                <span className="text-green-400 font-bold">${formatPrice(activeOHLC.high)}</span>
              </div>
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-zinc-500 font-bold">L</span>
                <span className="text-red-400 font-bold">${formatPrice(activeOHLC.low)}</span>
              </div>
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-zinc-500 font-bold">C</span>
                <span className={`font-bold ${activeOHLC.isBullish ? 'text-green-400' : 'text-red-400'}`}>
                  ${formatPrice(activeOHLC.close)}
                </span>
              </div>
              <div className="hidden md:flex items-center gap-1 text-[11px]">
                <span className="text-zinc-500 font-bold">Change</span>
                <span className={`font-bold ${activeOHLC.isBullish ? 'text-green-400' : 'text-red-400'}`}>
                  {activeOHLC.change >= 0 ? '+' : ''}{activeOHLC.changePercent.toFixed(2)}% ({activeOHLC.change >= 0 ? '+' : ''}${formatPrice(Math.abs(activeOHLC.change))})
                </span>
              </div>
              <div className="hidden lg:flex items-center gap-1 text-[11px]">
                <span className="text-zinc-500 font-bold">Range</span>
                <span className="text-zinc-300 font-bold">
                  ${formatPrice(activeOHLC.amplitude)} ({activeOHLC.amplitudePercent.toFixed(2)}%)
                </span>
              </div>
            </>
          )}
        </div>

        {/* Active Indicators Real-time Summary Pills */}
        <div className="flex items-center gap-2 font-mono text-[10px] shrink-0">
          {activeIndicators.has('rsi') && indicatorValues.rsi !== undefined && (
            <span className="px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-300 font-bold">
              RSI(14): {indicatorValues.rsi.toFixed(2)}
            </span>
          )}
          {activeIndicators.has('macd') && indicatorValues.macd !== undefined && (
            <span className="hidden md:inline-flex px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-300 font-bold">
              MACD: {indicatorValues.macd.macd.toFixed(2)} / {indicatorValues.macd.signal.toFixed(2)}
            </span>
          )}
          {activeIndicators.has('bb') && indicatorValues.bb !== undefined && (
            <span className="hidden lg:inline-flex px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold">
              BB: ${formatPrice(indicatorValues.bb.upper)} / ${formatPrice(indicatorValues.bb.lower)}
            </span>
          )}
        </div>
      </div>
      
      {/* Chart Container & Floating Crosshair Tooltip */}
      <div className="relative flex-1 w-full min-h-[260px] overflow-hidden">
        {isLoadingHistory && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/40 backdrop-blur-[1px]">
            <div className="flex items-center gap-2 text-xs font-mono text-yellow-500">
              <span className="w-2 h-2 rounded-full bg-yellow-500 animate-ping" />
              Loading {asset.symbol} live Binance klines...
            </div>
          </div>
        )}

        {/* Floating OHLC Crosshair Tooltip Card */}
        {showFloatingTooltip && hoveredOHLC && tooltipPos && (
          <div
            className="absolute z-30 pointer-events-none transition-all duration-75 ease-out shadow-2xl rounded-xl bg-zinc-900/95 backdrop-blur-md border border-zinc-700/80 p-3 min-w-[210px] text-xs font-mono text-zinc-200"
            style={getTooltipStyle()}
          >
            {/* Tooltip Header */}
            <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-zinc-800">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-zinc-100">{asset.symbol}</span>
                <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-[9px] text-yellow-500 font-bold">
                  {timeframe}
                </span>
              </div>
              <div className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                hoveredOHLC.isBullish 
                  ? 'bg-green-500/15 text-green-400 border border-green-500/30' 
                  : 'bg-red-500/15 text-red-400 border border-red-500/30'
              }`}>
                {hoveredOHLC.isBullish ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                <span>{hoveredOHLC.isBullish ? 'Bullish' : 'Bearish'}</span>
              </div>
            </div>

            {/* Timestamp */}
            <div className="text-[10px] text-zinc-400 mb-2">
              {hoveredOHLC.formattedDate} <span className="text-zinc-200 font-bold">{hoveredOHLC.formattedTime}</span>
            </div>

            {/* OHLC Values Grid */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] mb-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 font-bold">Open</span>
                <span className="text-zinc-200 font-bold">${formatPrice(hoveredOHLC.open)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 font-bold">High</span>
                <span className="text-green-400 font-bold">${formatPrice(hoveredOHLC.high)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 font-bold">Low</span>
                <span className="text-red-400 font-bold">${formatPrice(hoveredOHLC.low)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500 font-bold">Close</span>
                <span className={`font-bold ${hoveredOHLC.isBullish ? 'text-green-400' : 'text-red-400'}`}>
                  ${formatPrice(hoveredOHLC.close)}
                </span>
              </div>
            </div>

            {/* Change & Range Summary Footer */}
            <div className="pt-2 border-t border-zinc-800/80 flex flex-col gap-1 text-[10px]">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Change</span>
                <span className={`font-bold ${hoveredOHLC.isBullish ? 'text-green-400' : 'text-red-400'}`}>
                  {hoveredOHLC.change >= 0 ? '+' : ''}{hoveredOHLC.changePercent.toFixed(2)}% ({hoveredOHLC.change >= 0 ? '+' : ''}${formatPrice(Math.abs(hoveredOHLC.change))})
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Range (H-L)</span>
                <span className="text-zinc-300 font-bold">
                  ${formatPrice(hoveredOHLC.amplitude)} ({hoveredOHLC.amplitudePercent.toFixed(2)}%)
                </span>
              </div>
              {hoveredOHLC.volume !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Volume</span>
                  <span className="text-yellow-500 font-bold">
                    {hoveredOHLC.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div 
          ref={chartContainerRef} 
          className="w-full h-full cursor-crosshair"
          onMouseLeave={() => {
            setHoveredOHLC(null);
            setTooltipPos(null);
          }}
        />
      </div>
      
      {/* 24h Stats Footer */}
      <div className="mt-3 pt-3 border-t border-zinc-900 flex items-center justify-between shrink-0">
        <div className="flex gap-4 sm:gap-6">
          <div className="flex flex-col">
            <span className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest hidden sm:block">24h High</span>
            <span className="text-[11px] font-mono font-bold text-zinc-300">${displayHigh}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest hidden sm:block">24h Low</span>
            <span className="text-[11px] font-mono font-bold text-zinc-300">${displayLow}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[8px] text-zinc-600 font-bold uppercase tracking-widest hidden sm:block">24h Volume</span>
            <span className="text-[11px] font-mono font-bold text-zinc-300">{asset.volume} USDT</span>
          </div>
        </div>
        <div className="text-[9px] text-zinc-500 font-mono font-medium flex items-center gap-2">
          <Wifi className={`w-3 h-3 ${isWsConnected ? 'text-green-500' : 'text-yellow-500'}`} />
          <span>Binance Spot Stream</span>
        </div>
      </div>
    </div>
  );
}
