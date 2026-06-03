/**
 * server.js — AgentHTTP Server v1.0.0
 * 
 * LLM-backed HTTP agent that:
 * 1. Receives any HTTP request
 * 2. Parses intent (knowledge, dashboard, explore, agent, canvas)
 * 3. Synthesizes context from LLM Wiki + session memory + system state
 * 4. Renders a full multimedia HTML response (Canvas + Three.js + bzr-dial)
 * 
 * Usage: node server.js [port]
 */

const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const wiki = require('./wiki-loader');
const renderer = require('./renderer');

const PORT = parseInt(process.argv[2]) || 3002;

const app = express();

// ─── Middleware ─────────────────────────────────────────────────────

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow all origins for agent endpoints
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms) | ${req.ip}`);
  });
  next();
});

// ─── Session Memory ─────────────────────────────────────────────────

const sessions = new Map(); // ip → { turns: [], lastActive: timestamp }
const MAX_SESSION_TURNS = 50;

function getSession(ip) {
  if (!sessions.has(ip)) {
    sessions.set(ip, { turns: [], lastActive: Date.now() });
  }
  const s = sessions.get(ip);
  s.lastActive = Date.now();
  return s;
}

function addTurn(ip, role, content) {
  const s = getSession(ip);
  s.turns.push({ role, content, ts: Date.now() });
  if (s.turns.length > MAX_SESSION_TURNS) s.turns.shift();
}

// Cleanup old sessions (30min TTL)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [ip, s] of sessions) {
    if (s.lastActive < cutoff) sessions.delete(ip);
  }
}, 60_000);

// ─── System Metrics ─────────────────────────────────────────────────

function getMetrics() {
  const freemem = os.freemem();
  const totalmem = os.totalmem();
  return {
    uptime: process.uptime(),
    cpuCount: os.cpus().length,
    loadAvg: os.loadavg(),
    freemem,
    totalmem,
    usedmem: totalmem - freemem,
    memPercent: Math.round((totalmem - freemem) / totalmem * 100),
    nodeVersion: process.version,
    wikiPages: wiki.pages.size,
    activeSessions: sessions.size,
    domains: 20,
  };
}

// ─── Agent Core ─────────────────────────────────────────────────────

/**
 * The agent loop: classify intent → gather context → synthesize → render
 */
async function agentLoop(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const query = (req.query.q || req.query.query || req.body?.q || req.body?.query || '').trim();
  const path = req.path;

  // Classify intent from path + query
  const intent = classifyIntent(path, query);
  
  // Ensure wiki is loaded
  wiki.load();

  // Gather context
  const context = {
    intent,
    query,
    path,
    session: getSession(ip),
    metrics: getMetrics(),
    timestamp: new Date().toISOString(),
  };

  // Build wiki context if there's a query
  if (query) {
    context.wikiContext = wiki.buildContext(query, 3);
    context.searchResults = wiki.search(query, 5);
  }

  // Route to appropriate response generator
  return generateResponse(context, ip);
}

function classifyIntent(path, query) {
  if (path.startsWith('/knowledge/')) return 'knowledge';
  if (path === '/dashboard' || path === '/status') return 'dashboard';
  if (path === '/explore' || path === '/graph') return 'explore';
  if (path === '/agent' || path === '/ask' || path === '/chat') return 'agent';
  if (path === '/canvas' || path === '/art') return 'canvas';
  if (path === '/' || path === '/home') return 'home';
  // If path looks like an entity name
  if (path.length > 2 && !path.includes('.')) return 'knowledge';
  return 'agent'; // default
}

function generateResponse(context, ip) {
  const { intent, query, searchResults = [], wikiContext } = context;

  // Determine the specific entity being asked about
  let targetSlug = null;
  if (intent === 'knowledge') {
    // Extract slug from path: /knowledge/bizarre-lynx → bizarre-lynx
    const parts = context.path.split('/').filter(Boolean);
    targetSlug = parts[parts.length - 1];
    if (targetSlug === 'knowledge') targetSlug = null;
  }

  // Use search to find entity if we have a query but no target
  const entity = targetSlug ? wiki.get(targetSlug) : (searchResults[0] || null);

  // Add user turn to session
  if (query) addTurn(ip, 'user', query);

  switch (intent) {
    case 'knowledge': {
      if (entity) {
        const related = wiki.getRelated(entity.slug);
        const response = renderer.renderKnowledge({ page: entity, related, query });
        if (query) addTurn(ip, `agent`, `Showing knowledge page: ${entity.title}`);
        return response;
      }
      // Fallback: show search results as knowledge listing
      if (searchResults.length > 0) {
        return renderSearchResults(searchResults, query);
      }
      return renderNotFound(query);
    }

    case 'dashboard':
      return renderer.renderDashboard({ metrics: context.metrics });

    case 'explore':
      return renderer.renderExplore({ pages: wiki.getAll() });

    case 'agent': {
      const messages = [];
      if (query) {
        // Build a synthesized response from wiki context
        const reply = synthesizeReply(query, searchResults, wikiContext, context);
        messages.push({ role: 'user', content: query });
        messages.push({ role: 'agent', content: reply });
        addTurn(ip, 'agent', reply);
      }
      return renderer.renderAgent({ messages, query });
    }

    case 'canvas':
      return renderer.renderCanvas({ title: query || 'Canvas', prompt: query || 'AgentHTTP' });

    case 'home':
    default:
      return renderHome(context);
  }
}

/**
 * Synthesize a reply from wiki search results
 */
function synthesizeReply(query, results, wikiContext, context) {
  const { metrics } = context;
  
  if (results.length === 0) {
    return `I searched the knowledge base for "${query}" but didn't find any matching entities or concepts.\n\nTry asking about:\n• **Entities**: Ballademics, Bizarre Lynx, Czarui, Makeufamous, NeuroCanvas, Roachcoach\n• **Concepts**: AIEOS integration, media ingestion, PKM patterns, RAG architecture\n• **Operations**: domain portfolio, agent roster, the conglomerate group`;
  }

  const top = results[0];
  let reply = `## ${top.title}\n\n${top.summary}\n\n`;

  if (results.length > 1) {
    reply += `**Related:** ${results.slice(1, 4).map(r => `[${r.title}](/agent/knowledge/${r.slug})`).join(' · ')}\n\n`;
  }

  reply += `---\n_System: ${metrics.wikiPages} pages indexed · ${metrics.memPercent}% memory · ${metrics.uptime.toFixed(0)}s uptime_`;

  return reply;
}

/**
 * Render search results page
 */
function renderSearchResults(results, query) {
  const items = results.map(r => `
    <a href="/agent/knowledge/${r.slug}" class="block p-5 rounded-xl bg-surface/50 border border-white/10 hover:border-primary/40 hover:bg-primary/5 transition-all group">
      <div class="flex items-center gap-2 mb-1">
        <span class="text-[10px] uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full">${r.type}</span>
        <span class="text-[10px] text-muted">score: ${r.score}</span>
      </div>
      <div class="font-display font-bold text-lg text-white/90 group-hover:text-primary transition-colors">${r.title}</div>
      <div class="text-sm text-muted mt-1 line-clamp-2">${r.summary.substring(0, 150)}</div>
    </a>
  `).join('');

  const body = `
    <header class="border-b border-white/10 bg-bg/80 backdrop-blur-xl sticky top-0 z-50">
      <div class="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
        <a href="/agent/" class="flex items-center gap-2 group">
          <div class="w-7 h-7 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center">
            <span class="text-primary text-xs">✦</span>
          </div>
          <span class="font-display font-bold text-sm">AgentHTTP</span>
        </a>
      </div>
    </header>
    <section class="max-w-4xl mx-auto px-6 pt-12 pb-24">
      <h1 class="font-display text-3xl font-bold mb-2">Results for "${query}"</h1>
      <p class="text-muted mb-8">${results.length} matches found</p>
      <div class="space-y-4">${items}</div>
    </section>`;

  return renderer.baseShell({ title: `Search: ${query}`, body });
}

/**
 * Render not found page
 */
function renderNotFound(query) {
  const body = `
    <div class="min-h-screen flex items-center justify-center">
      <div class="text-center">
        <div class="text-6xl mb-6">🔍</div>
        <h1 class="font-display text-3xl font-bold mb-4">Not Found</h1>
        <p class="text-muted mb-8">No knowledge page matches "${query}"</p>
        <div class="flex gap-4 justify-center">
          <a href="/agent/explore" class="px-5 py-2 bg-primary/20 border border-primary/30 rounded-lg text-primary text-sm hover:bg-primary/30 transition-colors">Explore Graph</a>
          <a href="/agent/agent" class="px-5 py-2 bg-surface border border-white/10 rounded-lg text-sm hover:border-white/20 transition-colors">Ask Agent</a>
        </div>
      </div>
    </div>`;

  return renderer.baseShell({ title: 'Not Found', body });
}

/**
 * Render home page
 */
function renderHome(context) {
  const entities = wiki.getByType('entities').slice(0, 8);
  const concepts = wiki.getByType('concepts').slice(0, 6);

  const entityCards = entities.map(e => `
    <a href="/agent/knowledge/${e.slug}" class="group p-5 rounded-xl bg-surface/50 border border-white/10 hover:border-primary/40 hover:bg-primary/5 transition-all">
      <div class="text-[10px] uppercase tracking-wider text-primary/60 mb-2">${e.type}</div>
      <div class="font-display font-bold text-lg text-white/90 group-hover:text-primary transition-colors mb-1">${e.title}</div>
      <div class="text-xs text-muted line-clamp-1">${e.summary.substring(0, 80)}</div>
    </a>
  `).join('');

  const conceptCards = concepts.map(c => `
    <a href="/agent/knowledge/${c.slug}" class="group p-4 rounded-lg bg-white/5 border border-white/5 hover:border-primary/30 transition-all">
      <div class="font-display font-medium text-sm text-white/80 group-hover:text-primary transition-colors">${c.title}</div>
    </a>
  `).join('');

  const body = `
    <canvas id="bg-canvas" class="fixed inset-0 w-full h-full pointer-events-none opacity-40" style="z-index:0"></canvas>
    <div class="relative z-10">
      <header class="border-b border-white/10 bg-bg/80 backdrop-blur-xl sticky top-0 z-50">
        <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center animate-glow">
              <span class="text-primary text-sm">✦</span>
            </div>
            <span class="font-display font-bold text-lg tracking-tight">AgentHTTP</span>
          </div>
          <nav class="flex items-center gap-6 text-sm text-muted">
            <a href="/agent/explore" class="hover:text-primary transition-colors">Explore</a>
            <a href="/agent/dashboard" class="hover:text-primary transition-colors">Dashboard</a>
            <a href="/agent/agent" class="hover:text-primary transition-colors">Agent</a>
          </nav>
        </div>
      </header>

      <!-- Hero -->
      <section class="max-w-6xl mx-auto px-6 pt-24 pb-16 text-center animate-fade-in">
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-8">
          <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
          LLM-Backed HTTP Agent
        </div>
        <h1 class="font-display text-5xl md:text-7xl font-bold tracking-tight mb-6 leading-tight">
          The Web That<br><span class="gradient-text">Thinks</span>
        </h1>
        <p class="text-xl text-muted max-w-2xl mx-auto mb-10 leading-relaxed">
          Every response is synthesized from the full knowledge base — ${context.metrics.wikiPages} wiki pages, live system data, and session memory — then rendered as an immersive multimedia experience.
        </p>
        <div class="flex gap-4 justify-center">
          <a href="/agent/agent" class="px-6 py-3 bg-primary text-bg font-medium rounded-xl hover:bg-primary/90 transition-colors">
            Talk to the Agent
          </a>
          <a href="/agent/explore" class="px-6 py-3 bg-surface border border-white/10 rounded-xl hover:border-primary/40 transition-colors">
            Explore Knowledge
          </a>
        </div>
      </section>

      <!-- Quick Ask -->
      <section class="max-w-2xl mx-auto px-6 pb-16">
        <form action="/agent/agent" method="get" class="glass rounded-2xl p-2 flex gap-2">
          <input name="q" type="text" placeholder="Ask about any entity, concept, or project..."
            class="flex-1 bg-transparent px-4 py-3 text-sm focus:outline-none placeholder-muted" />
          <button type="submit" class="px-5 py-2.5 bg-primary text-bg font-medium rounded-xl text-sm hover:bg-primary/90 transition-colors">
            Ask
          </button>
        </form>
        <div class="flex flex-wrap gap-2 mt-3 justify-center">
          ${['bizarre-lynx', 'ballademics', 'czarui', 'neurocanvas', 'the-conglomerate-group'].map(s => {
            const p = wiki.get(s);
            return `<a href="/agent/knowledge/${s}" class="text-xs text-muted hover:text-primary transition-colors px-2 py-1 rounded bg-white/5 hover:bg-white/10">${p ? p.title : s}</a>`;
          }).join('')}
        </div>
      </section>

      <!-- Entities Grid -->
      <section class="max-w-6xl mx-auto px-6 pb-12">
        <h2 class="font-display text-2xl font-bold mb-6">${entities.length} Knowledge Entities</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          ${entityCards}
        </div>
      </section>

      <!-- Concepts -->
      <section class="max-w-6xl mx-auto px-6 pb-24">
        <h2 class="font-display text-2xl font-bold mb-6">${concepts.length} Concepts</h2>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          ${conceptCards}
        </div>
      </section>
    </div>`;

  const scripts = `
    // Subtle particle field on home
    (function() {
      const canvas = document.getElementById('bg-canvas');
      if (!canvas) return;
      const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.z = 30;
      const positions = new Float32Array(1000 * 3);
      for (let i = 0; i < 3000; i++) positions[i] = (Math.random() - 0.5) * 60;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({ color: 0x2bee8c, size: 0.08, transparent: true, opacity: 0.4 });
      const points = new THREE.Points(geo, mat);
      scene.add(points);
      function animate() {
        requestAnimationFrame(animate);
        points.rotation.y += 0.0003;
        renderer.render(scene, camera);
      }
      animate();
      window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      });
    })();
  `;

  return renderer.baseShell({ title: 'AgentHTTP — The Web That Thinks', body, scripts, styles: '' });
}

// ─── Routes ─────────────────────────────────────────────────────────

// Home + Agent paths
app.get('/', async (req, res) => res.send(await agentLoop(req)));
app.get('/agent', async (req, res) => res.send(await agentLoop(req)));
app.get('/agent/:slug', async (req, res) => res.send(await agentLoop(req)));
app.get('/agent/:slug/:sub', async (req, res) => res.send(await agentLoop(req)));
app.post('/agent', async (req, res) => res.send(await agentLoop(req)));
app.post('/agent/:slug', async (req, res) => res.send(await agentLoop(req)));

// Direct knowledge access
app.get('/knowledge/:slug', async (req, res) => {
  req.path = `/knowledge/${req.params.slug}`;
  res.send(await agentLoop(req));
});

// Dashboard
app.get('/dashboard', async (req, res) => {
  req.path = '/dashboard';
  res.send(await agentLoop(req));
});

// Explore
app.get('/explore', async (req, res) => {
  req.path = '/explore';
  res.send(await agentLoop(req));
});

// Canvas
app.get('/canvas', (req, res) => {
  const q = req.query.q || req.query.prompt || '';
  res.send(renderer.renderCanvas({ title: q || 'Canvas', prompt: q || 'AgentHTTP' }));
});

// Health check (JSON, not HTML)
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'agenthttp', uptime: process.uptime(), wiki: wiki.pages.size }));

// ─── Start ──────────────────────────────────────────────────────────

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  AgentHTTP v1.0.0 — LLM-Backed HTTP Agent`);
  console.log(`  Listening on port ${PORT}`);
  console.log(`  Wiki pages: ${wiki.pages.size}`);
  console.log(`  Node.js: ${process.version}`);
  console.log(`${'═'.repeat(50)}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[AgentHTTP] Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[AgentHTTP] Interrupted.');
  server.close(() => process.exit(0));
});

// Error handling
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[AgentHTTP] Port ${PORT} already in use`);
  } else {
    console.error('[AgentHTTP] Server error:', err);
  }
});

module.exports = app;
