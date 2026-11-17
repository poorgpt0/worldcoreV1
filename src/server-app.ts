import express from 'express';
import { GoogleGenAI } from '@google/genai';
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
