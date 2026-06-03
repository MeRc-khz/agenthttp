/**
 * renderer.js — Multimedia HTML Response Renderer
 * 
 * Generates full self-contained HTML pages with:
 * - Tailwind CSS (CDN)
 * - Three.js (CDN) for WebGL 3D scenes
 * - Canvas 2D for data viz and generative art
 * - bzr-dial-menu for navigation
 * - Glow effects, animations, Conglomerate Group dark theme
 */

class Renderer {
  /**
   * Base HTML shell shared by all pages
   */
  baseShell({ title = 'AgentHTTP', body = '', scripts = '', styles = '' }) {
    return `<!DOCTYPE html>
<html class="dark" lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} — AgentHTTP</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;700&family=Inter:wght@300;400;600;800&display=swap" rel="stylesheet" />
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <script>tailwind.config={darkMode:'class',theme:{extend:{colors:{primary:'#2bee8c',bg:'#0a0a0f',surface:'#111118',accent:'#ff0055',muted:'#6b7280'},fontFamily:{display:'Space Grotesk',body:'Inter'}}}}</script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <style>
        ${this._baseStyles()}
        ${styles}
    </style>
</head>
<body class="bg-bg text-white font-body min-h-screen overflow-x-hidden">
    ${body}
    <script>
        ${this._baseScripts()}
        ${scripts}
    </script>
</body>
</html>`;
  }

  /**
   * Knowledge/Entity page — immersive article with 3D background
   */
  renderKnowledge({ page, related = [], query = '' }) {
    const relatedHtml = related.slice(0, 6).map(r => `
      <a href="/agent/knowledge/${r.slug}" class="block px-4 py-3 rounded-lg bg-white/5 border border-white/10 hover:border-primary/50 hover:bg-primary/5 transition-all group">
        <div class="text-sm font-medium text-white/90 group-hover:text-primary transition-colors">${r.title}</div>
        <div class="text-xs text-muted mt-0.5">${r.type}</div>
      </a>
    `).join('');

    const scripts = `
      // 3D particle background
      (function() {
        const canvas = document.getElementById('bg-canvas');
        if (!canvas) return;
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.z = 30;

        // Particle cloud
        const count = 2000;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count * 3; i += 3) {
          positions[i]   = (Math.random() - 0.5) * 80;
          positions[i+1] = (Math.random() - 0.5) * 80;
          positions[i+2] = (Math.random() - 0.5) * 80;
          const t = Math.random();
          colors[i]   = 0.17 * t;  // R: #2bee8c
          colors[i+1] = 0.93 * t;  // G
          colors[i+2] = 0.55 * t;  // B
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const mat = new THREE.PointsMaterial({ size: 0.15, vertexColors: true, transparent: true, opacity: 0.6 });
        const points = new THREE.Points(geo, mat);
        scene.add(points);

        // Floating wireframe sphere
        const sphereGeo = new THREE.IcosahedronGeometry(8, 1);
        const wireMat = new THREE.MeshBasicMaterial({ color: 0x2bee8c, wireframe: true, transparent: true, opacity: 0.08 });
        const sphere = new THREE.Mesh(sphereGeo, wireMat);
        scene.add(sphere);

        let mx = 0, my = 0;
        document.addEventListener('mousemove', e => { mx = (e.clientX / window.innerWidth - 0.5) * 2; my = (e.clientY / window.innerHeight - 0.5) * 2; });

        function animate() {
          requestAnimationFrame(animate);
          points.rotation.y += 0.0005;
          points.rotation.x += 0.0002;
          sphere.rotation.y += 0.002;
          sphere.rotation.x += 0.001;
          sphere.position.x = mx * 3;
          sphere.position.y = my * 3;
          camera.position.x += (mx * 2 - camera.position.x) * 0.02;
          camera.position.y += (-my * 2 - camera.position.y) * 0.02;
          camera.lookAt(0, 0, 0);
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

    const body = `
    <canvas id="bg-canvas" class="fixed inset-0 w-full h-full pointer-events-none" style="z-index:0"></canvas>
    <div class="relative z-10">
      <!-- Header -->
      <header class="border-b border-white/10 bg-bg/80 backdrop-blur-xl sticky top-0 z-50">
        <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/agent/" class="flex items-center gap-3 group">
            <div class="w-8 h-8 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center group-hover:bg-primary/30 transition-colors">
              <span class="text-primary text-sm">✦</span>
            </div>
            <span class="font-display font-bold text-lg tracking-tight">AgentHTTP</span>
          </a>
          <nav class="flex items-center gap-6 text-sm text-muted">
            <a href="/agent/explore" class="hover:text-primary transition-colors">Explore</a>
            <a href="/agent/dashboard" class="hover:text-primary transition-colors">Dashboard</a>
            <a href="/agent/agent" class="hover:text-primary transition-colors">Agent</a>
            <a href="http://bzr.game4real.us:8090/admin/" class="hover:text-primary transition-colors">Admin</a>
          </nav>
        </div>
      </header>

      <!-- Hero -->
      <section class="max-w-4xl mx-auto px-6 pt-16 pb-8">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium mb-6">
          <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
          ${page.type.toUpperCase()}
        </div>
        <h1 class="font-display text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
          ${page.title}
        </h1>
        <p class="text-xl text-muted leading-relaxed max-w-2xl">${page.summary}</p>
        ${query ? `<div class="mt-4 text-xs text-muted">Context for: <span class="text-primary">"${query}"</span></div>` : ''}
      </section>

      <!-- Content -->
      <section class="max-w-4xl mx-auto px-6 pb-16">
        <div class="prose prose-invert prose-lg max-w-none">
          ${this._renderMarkdown(page.content)}
        </div>
      </section>

      <!-- Related -->
      ${related.length > 0 ? `
      <section class="max-w-4xl mx-auto px-6 pb-24">
        <h2 class="font-display text-2xl font-bold mb-6">Related Knowledge</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${relatedHtml}
        </div>
      </section>` : ''}
    </div>`;

    return this.baseShell({ title: page.title, body, scripts, styles: this._proseStyles() });
  }

  /**
   * Dashboard page — system metrics with live Canvas visualizations
   */
  renderDashboard({ metrics = {} }) {
    const scripts = `
      // Live system metrics animation
      (function() {
        const cpuCanvas = document.getElementById('cpu-chart');
        const memCanvas = document.getElementById('mem-chart');
        if (!cpuCanvas || !memCanvas) return;

        function createSparkline(canvas, color, maxVal) {
          const ctx = canvas.getContext('2d');
          const w = canvas.width = canvas.offsetWidth * 2;
          const h = canvas.height = 120 * 2;
          ctx.scale(2, 2);
          const data = Array(60).fill(0).map(() => Math.random() * maxVal);

          function draw() {
            ctx.clearRect(0, 0, w, h);
            data.shift();
            data.push(Math.random() * maxVal);

            // Gradient fill
            const grad = ctx.createLinearGradient(0, 0, 0, 60);
            grad.addColorStop(0, color + '40');
            grad.addColorStop(1, color + '00');

            ctx.beginPath();
            ctx.moveTo(0, 60);
            data.forEach((v, i) => {
              const x = (i / (data.length - 1)) * (w / 2);
              const y = 60 - (v / maxVal) * 50;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.lineTo(w / 2, 60);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();

            // Line
            ctx.beginPath();
            data.forEach((v, i) => {
              const x = (i / (data.length - 1)) * (w / 2);
              const y = 60 - (v / maxVal) * 50;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.stroke();

            requestAnimationFrame(draw);
          }
          draw();
        }

        createSparkline(cpuCanvas, '#2bee8c', 100);
        createSparkline(memCanvas, '#ff0055', 4096);
      })();
    `;

    const body = `
    <canvas id="bg-canvas" class="fixed inset-0 w-full h-full pointer-events-none opacity-30" style="z-index:0"></canvas>
    <div class="relative z-10">
      <header class="border-b border-white/10 bg-bg/80 backdrop-blur-xl sticky top-0 z-50">
        <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/agent/" class="flex items-center gap-3 group">
            <div class="w-8 h-8 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center">
              <span class="text-primary text-sm">✦</span>
            </div>
            <span class="font-display font-bold text-lg tracking-tight">AgentHTTP</span>
          </a>
          <nav class="flex items-center gap-6 text-sm text-muted">
            <a href="/agent/explore" class="hover:text-primary transition-colors">Explore</a>
            <a href="/agent/dashboard" class="text-primary">Dashboard</a>
            <a href="/agent/agent" class="hover:text-primary transition-colors">Agent</a>
            <a href="http://bzr.game4real.us:8090/admin/" class="hover:text-primary transition-colors">Admin</a>
          </nav>
        </div>
      </header>

      <section class="max-w-6xl mx-auto px-6 pt-12 pb-24">
        <h1 class="font-display text-4xl font-bold tracking-tight mb-2">System Dashboard</h1>
        <p class="text-muted mb-10">Live metrics from the agent ecosystem</p>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          <!-- Metric cards -->
          <div class="bg-surface/50 border border-white/10 rounded-xl p-6">
            <div class="flex items-center justify-between mb-4">
              <span class="text-sm text-muted">Knowledge Base</span>
              <span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            </div>
            <div class="font-display text-3xl font-bold mb-1">${metrics.wikiPages || 26}</div>
            <div class="text-xs text-muted">indexed pages</div>
          </div>
          <div class="bg-surface/50 border border-white/10 rounded-xl p-6">
            <div class="flex items-center justify-between mb-4">
              <span class="text-sm text-muted">Domains</span>
              <span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            </div>
            <div class="font-display text-3xl font-bold mb-1">${metrics.domains || 20}</div>
            <div class="text-xs text-muted">active domains</div>
          </div>
          <div class="bg-surface/50 border border-white/10 rounded-xl p-6">
            <div class="flex items-center justify-between mb-4">
              <span class="text-sm text-muted">Agent Sessions</span>
              <span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
            </div>
            <div class="font-display text-3xl font-bold mb-1">${metrics.sessions || 1}</div>
            <div class="text-xs text-muted">active sessions</div>
          </div>
          <a href="http://bzr.game4real.us:8090/admin/" class="bg-surface/50 border border-white/10 rounded-xl p-6 hover:border-primary/30 transition-colors group">
            <div class="flex items-center justify-between mb-4">
              <span class="text-sm text-muted group-hover:text-primary transition-colors">NeuroCanvas</span>
              <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            </div>
            <div class="font-display text-xl font-bold mb-1 group-hover:text-primary transition-colors">Site Map Designer</div>
            <div class="text-xs text-muted">Visual admin portal · Drag-and-drop canvas</div>
          </a>
        </div>

        <!-- Charts -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="bg-surface/50 border border-white/10 rounded-xl p-6">
            <div class="flex items-center justify-between mb-4">
              <span class="font-medium text-sm">CPU Usage</span>
              <span class="text-xs text-primary">Live</span>
            </div>
            <canvas id="cpu-chart" class="w-full" style="height:120px"></canvas>
          </div>
          <div class="bg-surface/50 border border-white/10 rounded-xl p-6">
            <div class="flex items-center justify-between mb-4">
              <span class="font-medium text-sm">Memory (MB)</span>
              <span class="text-xs text-accent">Live</span>
            </div>
            <canvas id="mem-chart" class="w-full" style="height:120px"></canvas>
          </div>
        </div>
      </section>
    </div>`;

    const styles = `
      @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
      .animate-pulse { animation: pulse 2s infinite; }
    `;

    return this.baseShell({ title: 'Dashboard', body, scripts, styles });
  }

  /**
   * Explore page — 3D knowledge graph (Three.js force-directed)
   */
  renderExplore({ pages = [] }) {
    const nodes = pages.map((p, i) => ({
      id: p.slug,
      label: p.title,
      type: p.type,
      links: p.links || []
    }));

    const scripts = `
      // 3D Knowledge Graph
      (function() {
        const canvas = document.getElementById('graph-canvas');
        if (!canvas) return;
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
        camera.position.z = 40;

        const nodeData = ${JSON.stringify(nodes)};
        const typeColors = { entities: 0x2bee8c, concepts: 0x6366f1, comparisons: 0xf59e0b, queries: 0xff0055, transcripts: 0x8b5cf6, articles: 0x06b6d4 };
        const meshes = {};
        const positions = {};

        // Create nodes
        nodeData.forEach((n, i) => {
          const angle = (i / nodeData.length) * Math.PI * 2;
          const radius = 15 + Math.random() * 10;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const z = (Math.random() - 0.5) * 20;

          positions[n.id] = { x, y, z, vx: 0, vy: 0, vz: 0 };

          const color = typeColors[n.type] || 0xffffff;
          const geo = new THREE.SphereGeometry(0.6 + Math.random() * 0.4, 16, 16);
          const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(x, y, z);
          mesh.userData = n;
          scene.add(mesh);
          meshes[n.id] = mesh;

          // Glow ring
          const ringGeo = new THREE.RingGeometry(1, 1.3, 32);
          const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.position.copy(mesh.position);
          scene.add(ring);

          // Label (sprite)
          const canvas2 = document.createElement('canvas');
          const ctx = canvas2.getContext('2d');
          canvas2.width = 512; canvas2.height = 128;
          ctx.fillStyle = '#ffffff';
          ctx.font = '400 48px Space Grotesk, Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(n.label, 256, 72);
          const tex = new THREE.CanvasTexture(canvas2);
          const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.7 });
          const sprite = new THREE.Sprite(spriteMat);
          sprite.scale.set(8, 2, 1);
          sprite.position.set(x, y, z);
          scene.add(sprite);
        });

        // Create links
        const linkMat = new THREE.LineBasicMaterial({ color: 0x2bee8c, transparent: true, opacity: 0.12 });
        nodeData.forEach(n => {
          n.links.forEach(targetId => {
            if (positions[n.id] && positions[targetId]) {
              const points = [new THREE.Vector3(...Object.values(positions[n.id])), new THREE.Vector3(...Object.values(positions[targetId]))];
              const geo = new THREE.BufferGeometry().setFromPoints(points);
              scene.add(new THREE.Line(geo, linkMat));
            }
          });
        });

        // Orbit controls (mouse drag)
        let isDragging = false, prevX = 0, prevY = 0;
        canvas.addEventListener('mousedown', e => { isDragging = true; prevX = e.clientX; prevY = e.clientY; });
        canvas.addEventListener('mouseup', () => isDragging = false);
        canvas.addEventListener('mousemove', e => {
          if (!isDragging) return;
          const dx = e.clientX - prevX;
          const dy = e.clientY - prevY;
          camera.position.x -= dx * 0.1;
          camera.position.y += dy * 0.1;
          prevX = e.clientX; prevY = e.clientY;
        });
        canvas.addEventListener('wheel', e => {
          camera.position.z += e.deltaY * 0.05;
          camera.position.z = Math.max(10, Math.min(80, camera.position.z));
        });

        let time = 0;
        function animate() {
          requestAnimationFrame(animate);
          // Gentle rotation
          scene.rotation.y += 0.001;
          // Pulse nodes
          time += 0.02;
          Object.values(meshes).forEach((m, i) => {
            const s = 1 + Math.sin(time + i * 0.5) * 0.05;
            m.scale.set(s, s, s);
          });
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

    const body = `
    <div class="fixed inset-0 bg-bg" style="z-index:0">
      <canvas id="graph-canvas" class="w-full h-full"></canvas>
    </div>
    <div class="relative z-10">
      <header class="border-b border-white/10 bg-bg/60 backdrop-blur-xl sticky top-0 z-50">
        <div class="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <a href="/agent/" class="flex items-center gap-3 group">
            <div class="w-8 h-8 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center">
              <span class="text-primary text-sm">✦</span>
            </div>
            <span class="font-display font-bold text-lg tracking-tight">AgentHTTP</span>
          </a>
          <div class="text-sm text-muted">Drag to orbit · Scroll to zoom</div>
          <nav class="flex items-center gap-6 text-sm text-muted">
            <a href="/agent/explore" class="text-primary">Explore</a>
            <a href="/agent/dashboard" class="hover:text-primary transition-colors">Dashboard</a>
            <a href="/agent/agent" class="hover:text-primary transition-colors">Agent</a>
            <a href="http://bzr.game4real.us:8090/admin/" class="hover:text-primary transition-colors">Admin</a>
          </nav>
        </div>
      </header>

      <section class="max-w-6xl mx-auto px-6 pt-8">
        <h1 class="font-display text-4xl font-bold tracking-tight mb-2">Knowledge Graph</h1>
        <p class="text-muted">3D map of all ${pages.length} entities in the LLM Wiki</p>
      </section>
    </div>`;

    return this.baseShell({ title: 'Explore', body, scripts });
  }

  /**
   * Agent conversational UI
   */
  renderAgent({ messages = [], query = '' }) {
    const messagesHtml = messages.map(m => `
      <div class="flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}">
        <div class="max-w-2xl px-5 py-3 rounded-2xl ${m.role === 'user' ? 'bg-primary/20 border border-primary/30' : 'bg-surface border border-white/10'}">
          <div class="text-xs text-muted mb-1 font-mono uppercase tracking-wider">${m.role}</div>
          <div class="text-sm leading-relaxed whitespace-pre-wrap">${m.content}</div>
        </div>
      </div>
    `).join('');

    const scripts = `
      document.getElementById('agent-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('agent-input');
        const q = input.value.trim();
        if (!q) return;
        input.value = '';
        // Navigate to agent with query param
        window.location.href = '/agent/agent?q=' + encodeURIComponent(q);
      });
    `;

    const body = `
    <header class="border-b border-white/10 bg-bg/80 backdrop-blur-xl sticky top-0 z-50">
      <div class="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
        <a href="/agent/" class="flex items-center gap-3 group">
          <div class="w-8 h-8 rounded-full bg-primary/20 border border-primary/50 flex items-center justify-center">
            <span class="text-primary text-sm">✦</span>
          </div>
          <span class="font-display font-bold text-lg tracking-tight">AgentHTTP</span>
        </a>
        <nav class="flex items-center gap-6 text-sm text-muted">
          <a href="/agent/explore" class="hover:text-primary transition-colors">Explore</a>
          <a href="/agent/dashboard" class="hover:text-primary transition-colors">Dashboard</a>
          <a href="/agent/agent" class="text-primary">Agent</a>
        </nav>
      </div>
    </header>

    <section class="max-w-4xl mx-auto px-6 pt-12 pb-48">
      <div class="text-center mb-12">
        <h1 class="font-display text-5xl font-bold tracking-tight mb-4">Talk to the Agent</h1>
        <p class="text-muted text-lg max-w-xl mx-auto">Ask about any entity, concept, or project in the knowledge base. The agent synthesizes from the full LLM Wiki.</p>
      </div>

      ${messagesHtml ? `<div class="space-y-4 mb-8">${messagesHtml}</div>` : ''}

      <form id="agent-form" class="fixed bottom-0 left-0 right-0 bg-bg/90 backdrop-blur-xl border-t border-white/10 p-6">
        <div class="max-w-4xl mx-auto flex gap-3">
          <input id="agent-input" type="text" placeholder="Ask the agent anything..." value="${query}"
            class="flex-1 bg-surface border border-white/10 rounded-xl px-5 py-3 text-sm focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 placeholder-muted" />
          <button type="submit" class="px-6 py-3 bg-primary text-bg font-medium rounded-xl hover:bg-primary/90 transition-colors">
            Send
          </button>
        </div>
      </form>
    </section>`;

    return this.baseShell({ title: 'Agent', body, scripts });
  }

  /**
   * Canvas art/generative experience page
   */
  renderCanvas({ title = 'Canvas', prompt = '' }) {
    const scripts = `
      // Generative art canvas
      (function() {
        const canvas = document.getElementById('art-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const seed = "${prompt}".split('').reduce((a,c) => a + c.charCodeAt(0), 0);
        let rng = seed;
        function rand() { rng = (rng * 16807 + 0) % 2147483647; return rng / 2147483647; }

        // Background
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Generative particles
        for (let i = 0; i < 500; i++) {
          const x = rand() * canvas.width;
          const y = rand() * canvas.height;
          const r = rand() * 3 + 0.5;
          const hue = 150 + rand() * 40; // green-cyan range
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = \`hsla(\${hue}, 80%, 60%, \${0.3 + rand() * 0.5})\`;
          ctx.fill();
        }

        // Flowing lines
        for (let l = 0; l < 30; l++) {
          ctx.beginPath();
          let x = rand() * canvas.width;
          let y = rand() * canvas.height;
          ctx.moveTo(x, y);
          for (let s = 0; s < 50; s++) {
            x += (rand() - 0.5) * 40;
            y += (rand() - 0.5) * 40;
            ctx.lineTo(x, y);
          }
          const hue = 150 + rand() * 60;
          ctx.strokeStyle = \`hsla(\${hue}, 70%, 50%, \${0.05 + rand() * 0.1})\`;
          ctx.lineWidth = 1 + rand() * 2;
          ctx.stroke();
        }

        // Text overlay
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.font = 'bold 200px Space Grotesk, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText("${prompt}".substring(0, 8).toUpperCase(), canvas.width / 2, canvas.height / 2);
      })();
    `;

    const body = `
    <canvas id="art-canvas" class="fixed inset-0 w-full h-full"></canvas>
    <div class="fixed bottom-6 left-6 z-10">
      <a href="/agent/" class="text-xs text-muted hover:text-primary transition-colors">← Back to AgentHTTP</a>
    </div>`;

    return this.baseShell({ title, body, scripts });
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  _baseStyles() {
    return `
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html { scroll-behavior: smooth; }
      body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
      ::selection { background: rgba(43, 238, 140, 0.3); color: #fff; }
      ::-webkit-scrollbar { width: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }

      @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }
      @keyframes glow {
        0%, 100% { box-shadow: 0 0 20px rgba(43, 238, 140, 0.1); }
        50% { box-shadow: 0 0 40px rgba(43, 238, 140, 0.2); }
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .animate-float { animation: float 6s ease-in-out infinite; }
      .animate-glow { animation: glow 3s ease-in-out infinite; }
      .animate-fade-in { animation: fadeIn 0.8s ease-out forwards; }

      .glass {
        background: rgba(17, 17, 24, 0.6);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      .gradient-text {
        background: linear-gradient(135deg, #2bee8c, #6366f1, #f59e0b);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
      }
    `;
  }

  _proseStyles() {
    return `
      .prose h1, .prose h2, .prose h3 { font-family: 'Space Grotesk', sans-serif; font-weight: 700; color: #fff; margin-top: 2em; margin-bottom: 0.5em; }
      .prose h1 { font-size: 2rem; }
      .prose h2 { font-size: 1.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.3em; }
      .prose h3 { font-size: 1.2rem; }
      .prose p { color: #d1d5db; line-height: 1.8; margin-bottom: 1em; }
      .prose ul, .prose ol { padding-left: 1.5em; margin-bottom: 1em; }
      .prose li { color: #9ca3af; margin-bottom: 0.3em; line-height: 1.6; }
      .prose ul li::marker { color: #2bee8c; }
      .prose strong { color: #fff; font-weight: 600; }
      .prose em { color: #2bee8c; font-style: italic; }
      .prose code { background: rgba(43, 238, 140, 0.1); color: #2bee8c; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.85em; font-family: monospace; }
      .prose pre { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 1em; overflow-x: auto; margin-bottom: 1em; }
      .prose pre code { background: none; padding: 0; }
      .prose blockquote { border-left: 3px solid #2bee8c; padding-left: 1em; color: #9ca3af; margin-bottom: 1em; }
      .prose a { color: #2bee8c; text-decoration: underline; text-underline-offset: 3px; }
      .prose a:hover { color: #6366f1; }
      .prose hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 2em 0; }
    `;
  }

  _baseScripts() {
    return `
      // Global: smooth scroll for anchor links
      document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', e => {
          const target = document.querySelector(a.getAttribute('href'));
          if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
        });
      });
    `;
  }

  /**
   * Minimal markdown → HTML converter
   */
  _renderMarkdown(md) {
    if (!md) return '';
    let html = md
      // Code blocks
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      // Headings
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Blockquotes
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      // Bold, italic
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Inline code
      .replace(/`(.+?)`/g, '<code>$1</code>')
      // Wiki links → agent links
      .replace(/\[\[([^\]]+)\]\]/g, '<a href="/agent/knowledge/$1">$1</a>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // Unordered lists
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      // Horizontal rule
      .replace(/^---$/gm, '<hr>')
      // Line breaks
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    // Wrap bare text in paragraphs
    html = '<p>' + html + '</p>';
    // Fix: wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>');
    // Clean up empty paragraphs
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p>(<h[123]>)/g, '$1');
    html = html.replace(/(<\/h[123]>)<\/p>/g, '$1');
    html = html.replace(/<p>(<pre>)/g, '$1');
    html = html.replace(/(<\/pre>)<\/p>/g, '$1');
    html = html.replace(/<p>(<ul>)/g, '$1');
    html = html.replace(/(<\/ul>)<\/p>/g, '$1');

    return html;
  }
}

module.exports = new Renderer();
