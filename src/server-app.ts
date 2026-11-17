import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config({ quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Lazy server-side Gemini Client so startup never logs stderr warnings or fails if key is injected later
let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || 'MISSING_API_KEY',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Gemini Flash Latest Generate Content API
app.post('/api/gemini/generate', async (req, res) => {
  try {
    const { prompt, contents } = req.body;
    const inputContents = contents || prompt || 'Explain how AI works in a few words';
    const ai = getAiClient();

    let response;
    let usedModel = 'gemini-flash-latest';
    try {
      response = await ai.models.generateContent({
        model: 'gemini-flash-latest',
        contents: inputContents,
      });
    } catch (err) {
      const errMsg = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message) : '';
      const errStatus = err && typeof err === 'object' && 'status' in err ? (err as { status?: unknown }).status : 0;
      if (errMsg.includes('503') || errMsg.includes('high demand') || errStatus === 503) {
        usedModel = 'gemini-2.5-flash';
        response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: inputContents,
        });
      } else {
        throw err;
      }
    }

    res.json({
      text: response.text,
      model: usedModel,
      status: 'success',
    });
  } catch (error) {
    const errMsg = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message) : 'Failed to generate content with Gemini';
    console.error('Gemini API Error:', error);
    res.status(500).json({
      error: errMsg,
      status: 'error',
    });
  }
});

// AI NFT Concept & Lore Generation with gemini-flash-latest
app.post('/api/gemini/generate-nft', async (req, res) => {
  try {
    const { prompt } = req.body;
    const userPrompt = prompt || 'A cyberpunk golden ape in a neon city, highly detailed, 4k';
    const ai = getAiClient();

    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: `You are the chief art curator at BinancePH NFT Studio.
Based on the theme: "${userPrompt}", create a 1-of-1 NFT title, rich cyberpunk lore (under 80 words), aesthetic color palette (array of 3 hex color strings), and 3 rarity traits.
Respond in JSON format with keys:
"title": string,
"lore": string,
"rarity": "Common" | "Rare" | "Epic" | "Legendary",
"colors": string[],
"traits": Array<{ trait_type: string, value: string }>`,
      config: {
        responseMimeType: 'application/json',
      },
    });

    let data = {
      title: 'Neon BNB Sentinel',
      lore: 'Synthesized on the Base ledger, safeguarding the digital heritage of Manila’s Web3 pioneers.',
      rarity: 'Legendary',
      colors: ['#F3BA2F', '#0B0E11', '#00F0FF'],
      traits: [
        { trait_type: 'Origin', value: 'BinancePH Studio' },
        { trait_type: 'Aesthetic', value: 'Cyberpunk' },
        { trait_type: 'Algorithm', value: 'Gemini Flash' },
      ],
    };

    try {
      if (response.text) {
        data = JSON.parse(response.text);
      }
    } catch (e) {
      console.warn('Failed to parse NFT response json, using defaults', e);
    }

    res.json({
      success: true,
      metadata: data,
      prompt: userPrompt,
    });
  } catch (error) {
    const errMsg = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message) : 'Failed to generate NFT metadata';
    console.error('NFT Lore Generation Error:', error);
    res.status(500).json({
      success: false,
      error: errMsg,
    });
  }
});

interface RebalanceHoldingInput {
  symbol: string;
  name?: string;
  quantity: number;
  priceUsdt: number;
  valueUsdt: number;
  currentPct: number;
}

interface RebalanceTargetInput {
  symbol: string;
  targetPct: number;
  priceUsdt: number;
}

// AI Portfolio Rebalance Simulation Endpoint (gemini-4-hydrogen structured JSON)
app.post('/api/gemini/rebalance', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MISSING_API_KEY') {
      return res.status(500).json({
        success: false,
        error: 'GEMINI_API_KEY is not configured in server secrets. Add it to simulate AI rebalancing.',
      });
    }

    const { holdings, targetAllocation, totalValueUsdt, phpRate = 58.45 } = req.body as {
      holdings?: RebalanceHoldingInput[];
      targetAllocation?: RebalanceTargetInput[];
      totalValueUsdt?: number;
      phpRate?: number;
    };

    if (!Array.isArray(holdings) || holdings.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Current portfolio holdings are required.',
      });
    }

    if (!Array.isArray(targetAllocation) || targetAllocation.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Target allocation weights are required.',
      });
    }

    if (typeof totalValueUsdt !== 'number' || !Number.isFinite(totalValueUsdt) || totalValueUsdt <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Total portfolio valuation must be greater than 0 to compute rebalance trades.',
      });
    }

    const targetSum = targetAllocation.reduce((acc, item) => acc + (Number(item.targetPct) || 0), 0);
    if (Math.abs(targetSum - 100) > 0.5) {
      return res.status(400).json({
        success: false,
        error: `Target allocation percentages must sum to 100% (currently ${targetSum.toFixed(2)}%).`,
      });
    }

    const sanitizedHoldings = holdings.map((h) => ({
      symbol: String(h.symbol || '').toUpperCase().trim(),
      name: String(h.name || h.symbol || '').trim(),
      quantity: Number(h.quantity) || 0,
      priceUsdt: Number(h.priceUsdt) || 0,
      valueUsdt: Number(h.valueUsdt) || 0,
      currentPct: Number(h.currentPct) || 0,
    }));

    const sanitizedTargets = targetAllocation.map((t) => ({
      symbol: String(t.symbol || '').toUpperCase().trim(),
      targetPct: Number(t.targetPct) || 0,
      priceUsdt: Number(t.priceUsdt) || 0,
    }));

    const safePhpRate = typeof phpRate === 'number' && phpRate > 0 ? phpRate : 58.45;

    const ai = getAiClient();
    const prompt = `Analyze this simulated crypto portfolio and calculate the exact rebalance trade steps to reach the target allocation.

Portfolio Total Value: $${totalValueUsdt.toFixed(2)} USDT (₱${(totalValueUsdt * safePhpRate).toFixed(2)} PHP at ₱${safePhpRate.toFixed(2)}/USDT)

Current Holdings:
${JSON.stringify(sanitizedHoldings, null, 2)}

Target Allocation (% must total 100%):
${JSON.stringify(sanitizedTargets, null, 2)}

Calculation rules:
1. Include every symbol that appears in EITHER Current Holdings (with non-zero quantity) OR Target Allocation (with non-zero targetPct).
2. For each symbol, compute targetValueUsdt = totalValueUsdt * (targetPct / 100).
3. Compute diffUsdt = targetValueUsdt - currentValueUsdt.
   - If diffUsdt < -1 (overweight), action is "SELL", notionalUsdt = abs(diffUsdt), quantityDelta = priceUsdt > 0 ? notionalUsdt / priceUsdt : 0.
   - If diffUsdt > 1 (underweight), action is "BUY", notionalUsdt = diffUsdt, quantityDelta = priceUsdt > 0 ? notionalUsdt / priceUsdt : 0.
   - If abs(diffUsdt) <= 1, action is "HOLD", notionalUsdt = 0, quantityDelta = 0.
4. targetQuantity = priceUsdt > 0 ? targetValueUsdt / priceUsdt : 0.
5. Order the steps sequentially starting with SELL trades first (to free up USDT liquidity), then BUY trades, then any HOLD entries, numbering stepNumber starting at 1.
6. Set estimatedTotalTurnoverUsdt equal to the sum of notionalUsdt across all SELL and BUY steps (or one-way traded notional clearly stated). Let estimatedTotalTurnoverUsdt be the total sum of all executed BUY + SELL notionalUsdt, and estimatedFeeUsdt = estimatedTotalTurnoverUsdt * 0.001 (0.1% simulated spot trading fee).`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a quantitative portfolio rebalance calculator for a simulated cryptocurrency trading terminal. Perform exact arithmetic based on the provided live prices and portfolio weights. Output strictly valid JSON matching the requested schema. Frame all insights strictly as a simulated strategy calculation, never as real financial advice.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            strategySummary: {
              type: Type.STRING,
              description: 'Concise 2-3 sentence summary of the portfolio drift and simulated rebalance strategy.',
            },
            executionOrderNote: {
              type: Type.STRING,
              description: 'Brief 1-sentence note explaining why sells are sequenced before buys and noting simulation status.',
            },
            estimatedTotalTurnoverUsdt: {
              type: Type.NUMBER,
              description: 'Total USDT notional volume across all BUY and SELL trade steps.',
            },
            estimatedFeeUsdt: {
              type: Type.NUMBER,
              description: 'Simulated 0.1% spot trading fee in USDT on total trade volume.',
            },
            steps: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  stepNumber: { type: Type.INTEGER },
                  action: {
                    type: Type.STRING,
                    description: 'Must be SELL, BUY, or HOLD',
                  },
                  symbol: { type: Type.STRING },
                  quantityDelta: { type: Type.NUMBER },
                  notionalUsdt: { type: Type.NUMBER },
                  currentPct: { type: Type.NUMBER },
                  targetPct: { type: Type.NUMBER },
                  targetQuantity: { type: Type.NUMBER },
                  rationale: { type: Type.STRING },
                },
                required: [
                  'stepNumber',
                  'action',
                  'symbol',
                  'quantityDelta',
                  'notionalUsdt',
                  'currentPct',
                  'targetPct',
                  'targetQuantity',
                  'rationale',
                ],
              },
            },
          },
          required: [
            'strategySummary',
            'executionOrderNote',
            'estimatedTotalTurnoverUsdt',
            'estimatedFeeUsdt',
            'steps',
          ],
        },
      },
    });

    if (!response.text) {
      return res.status(502).json({
        success: false,
        error: 'Gemini returned an empty response while calculating rebalance steps.',
      });
    }

    const plan = JSON.parse(response.text);

    res.json({
      success: true,
      model: 'gemini-4-hydrogen',
      plan,
    });
  } catch (error) {
    const errMsg =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message)
        : 'Failed to calculate AI rebalance strategy with Gemini';
    const rawStatus =
      error && typeof error === 'object' && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : 500;
    const statusCode = rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
    console.error('Gemini Rebalance Error:', error);
    res.status(statusCode).json({
      success: false,
      error: errMsg,
    });
  }
});

// Binance REST API Proxy Endpoints with caching
let tickerCache: { data: unknown; timestamp: number } | null = null;
const CACHE_TTL = 1500;

app.get('/api/binance/ticker/24hr', async (_req, res) => {
  try {
    const now = Date.now();
    if (tickerCache && now - tickerCache.timestamp < CACHE_TTL) {
      return res.json(tickerCache.data);
    }
    const response = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.statusText}`);
    }
    const data = await response.json();
    tickerCache = { data, timestamp: now };
    res.json(data);
  } catch (error) {
    const errMsg = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message) : 'Failed to fetch Binance tickers';
    console.error('Binance ticker proxy error:', error);
    if (tickerCache) {
      return res.json(tickerCache.data);
    }
    res.status(500).json({ error: errMsg });
  }
});

app.get('/api/binance/klines', async (req, res) => {
  try {
    const { symbol = 'BTCUSDT', interval = '1m', limit = '100' } = req.query;
    const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(String(symbol))}&interval=${encodeURIComponent(String(interval))}&limit=${encodeURIComponent(String(limit))}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Binance klines error: ${response.statusText}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    const errMsg = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message) : 'Failed to fetch Binance klines';
    console.error('Binance klines proxy error:', error);
    res.status(500).json({ error: errMsg });
  }
});

app.get('/api/binance/depth', async (req, res) => {
  try {
    const { symbol = 'BTCUSDT', limit = '10' } = req.query;
    const url = `https://api.binance.com/api/v3/depth?symbol=${encodeURIComponent(String(symbol))}&limit=${encodeURIComponent(String(limit))}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Binance depth error: ${response.statusText}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    const errMsg = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message) : 'Failed to fetch Binance depth';
    console.error('Binance depth proxy error:', error);
    res.status(500).json({ error: errMsg });
  }
});

app.get('/api/binance/trades', async (req, res) => {
  try {
    const { symbol = 'BTCUSDT', limit = '20' } = req.query;
    const url = `https://api.binance.com/api/v3/trades?symbol=${encodeURIComponent(String(symbol))}&limit=${encodeURIComponent(String(limit))}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Binance trades error: ${response.statusText}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    const errMsg = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message) : 'Failed to fetch Binance trades';
    console.error('Binance trades proxy error:', error);
    res.status(500).json({ error: errMsg });
  }
});

// CoinGecko Demo API Proxy Endpoints with caching & rate-limit resilience
const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const cgCache = new Map<string, { data: unknown; timestamp: number }>();

function getCoinGeckoHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'binanceph-coingecko-proxy',
  };
  const apiKey = process.env.CG_API_KEY;
  if (apiKey && apiKey !== 'MY_COINGECKO_DEMO_API_KEY') {
    headers['x-cg-demo-api-key'] = apiKey;
  }
  return headers;
}

async function fetchCoinGeckoCached(pathWithQuery: string, ttlMs: number): Promise<unknown> {
  const now = Date.now();
  const cached = cgCache.get(pathWithQuery);
  if (cached && now - cached.timestamp < ttlMs) {
    return cached.data;
  }

  try {
    const response = await fetch(`${COINGECKO_BASE_URL}${pathWithQuery}`, {
      headers: getCoinGeckoHeaders(),
    });
    if (!response.ok) {
      throw new Error(`CoinGecko API ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    cgCache.set(pathWithQuery, { data, timestamp: now });
    return data;
  } catch (error) {
    if (cached) {
      return cached.data;
    }
    throw error;
  }
}

app.get('/api/coingecko/markets', async (req, res) => {
  try {
    const vsCurrency = String(req.query.vs_currency || 'usd');
    const perPage = String(req.query.per_page || '100');
    const page = String(req.query.page || '1');
    const sparkline = String(req.query.sparkline || 'true');
    const qs = `/coins/markets?vs_currency=${encodeURIComponent(vsCurrency)}&order=market_cap_desc&per_page=${encodeURIComponent(perPage)}&page=${encodeURIComponent(page)}&sparkline=${encodeURIComponent(sparkline)}&price_change_percentage=24h,7d`;
    const data = await fetchCoinGeckoCached(qs, 45_000);
    res.json(data);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Failed to fetch CoinGecko markets';
    console.warn('CoinGecko markets proxy notice:', errMsg);
    res.status(502).json({ error: errMsg });
  }
});

app.get('/api/coingecko/simple-price', async (req, res) => {
  try {
    const ids = String(req.query.ids || 'bitcoin,ethereum,tether');
    const vsCurrencies = String(req.query.vs_currencies || 'usd,php');
    const qs = `/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=${encodeURIComponent(vsCurrencies)}&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true&include_last_updated_at=true`;
    const data = await fetchCoinGeckoCached(qs, 30_000);
    res.json(data);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Failed to fetch CoinGecko simple price';
    console.warn('CoinGecko simple-price proxy notice:', errMsg);
    res.status(502).json({ error: errMsg });
  }
});

app.get('/api/coingecko/market-chart/:id', async (req, res) => {
  try {
    const coinId = String(req.params.id || 'bitcoin').replace(/[^a-z0-9-]/gi, '');
    const vsCurrency = String(req.query.vs_currency || 'usd');
    const days = String(req.query.days || '30');
    const interval = req.query.interval ? `&interval=${encodeURIComponent(String(req.query.interval))}` : '';
    const qs = `/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=${encodeURIComponent(vsCurrency)}&days=${encodeURIComponent(days)}${interval}`;
    const data = await fetchCoinGeckoCached(qs, 300_000);
    res.json(data);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Failed to fetch CoinGecko market chart';
    console.warn('CoinGecko market-chart proxy notice:', errMsg);
    res.status(502).json({ error: errMsg });
  }
});

app.get('/api/coingecko/search', async (req, res) => {
  try {
    const query = String(req.query.query || '').trim();
    if (!query) {
      return res.json({ coins: [] });
    }
    const qs = `/search?query=${encodeURIComponent(query)}`;
    const data = await fetchCoinGeckoCached(qs, 600_000);
    res.json(data);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Failed to search CoinGecko';
    console.warn('CoinGecko search proxy notice:', errMsg);
    res.status(502).json({ error: errMsg });
  }
});

app.get('/api/coingecko/trending', async (_req, res) => {
  try {
    const data = await fetchCoinGeckoCached('/search/trending', 300_000);
    res.json(data);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Failed to fetch CoinGecko trending';
    console.warn('CoinGecko trending proxy notice:', errMsg);
    res.status(502).json({ error: errMsg });
  }
});

// ACME challenge handler for SSL certificate verification
app.get('/.well-known/acme-challenge/:token', (req, res) => {
  res.status(200).send(req.params.token);
});

// Health check endpoints for Cloud Run
app.all(['/healthz', '/_health'], (_req, res) => {
  res.status(200).send('OK');
});

app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    appUrl: process.env.APP_URL || `http://localhost:${PORT}`,
    timestamp: new Date().toISOString(),
  });
});

// Respond 200 OK to all HEAD requests (Cloud Run TCP/HTTP health probes)
app.head('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.status(200).end();
});

async function startServer() {
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, 'dist'),
    path.resolve(__dirname, 'dist'),
    path.resolve(__dirname, '..', 'dist'),
    path.resolve(cwd),
  ];
  const distPath = candidates.find((d) => fs.existsSync(path.join(d, 'index.html'))) || path.resolve(cwd, 'dist');
  const indexPath = path.join(distPath, 'index.html');

  if (fs.existsSync(indexPath)) {
    // Production Mode: Serve built static assets
    app.use(express.static(distPath));

    app.use((req, res, next) => {
      if (req.path.startsWith('/api') || req.path === '/healthz' || req.path === '/_health' || req.path.startsWith('/.well-known')) {
        return next();
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        return res.sendFile(indexPath);
      }
      next();
    });

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server listening on http://0.0.0.0:${PORT}`);
    });

    server.on('error', (err) => {
      console.error('Server listen error:', err);
    });

    process.on('SIGTERM', () => {
      server.close(() => process.exit(0));
    });
    process.on('SIGINT', () => {
      server.close(() => process.exit(0));
    });
  } else {
    // Development Mode: Mount Vite middlewares for HMR / instant dev
    try {
      const vitePkg = 'vite';
      const { createServer } = await import(vitePkg);
      const vite = await createServer({
        server: { middlewareMode: true, hmr: false },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.error('Failed to initialize Vite middleware:', err);
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server listening on http://0.0.0.0:${PORT}`);
    });

    server.on('error', (err) => {
      console.error('Server listen error:', err);
    });

    process.on('SIGTERM', () => {
      server.close(() => process.exit(0));
    });
    process.on('SIGINT', () => {
      server.close(() => process.exit(0));
    });
  }
}

startServer();
