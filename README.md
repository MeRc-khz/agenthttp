# AgentHTTP — LLM-Backed HTTP Agent Server v1.0.0

## What It Is
An HTTP server that is itself an AI agent. Every request enters an agent loop
that synthesizes context from the LLM Wiki, MCP tools, session memory, and
real-time data — then renders the response as a rich HTML multimedia experience
using Canvas 2D and Three.js WebGL.

## Architecture

```
Client Request (any HTTP method, any path)
        │
        ▼
   Express Router
        │
        ▼
   Agent Loop
    ├─ Intent Parser  → classify request type (query, command, browse, explore)
    ├─ Context Engine → pull from LLM Wiki, tools, session memory
    ├─ LLM Synthesis  → generate structured response plan
    └─ Renderer       → HTML + Canvas + Three.js page

Ports:
  3002 — AgentHTTP server (Node.js/Express)
  Nginx proxies /agent/* → 3002
```

## Response Types

All responses are full self-contained HTML pages with embedded media:

1. **knowledge** — Wiki entity/concept lookup → rendered as immersive article with 3D scene
2. **dashboard** → System status, live data visualization with Canvas
3. **explore** → 3D knowledge graph of wiki entities (Three.js force graph)
4. **agent** → Conversational agent with typed input, multimedia responses
5. **canvas** → Pure Canvas 2D art/experience generated from the request

## Context Sources

- `/root/llm-wiki/` — Markdown knowledge base (26+ pages)
- `native-mcp` — MCP tool integrations
- Session memory — per-IP conversation history (in-memory, 100 turns)
- System state — server metrics, time, active services

## File Structure

```
/root/agenthttp/
  server.js          — Main Express server + agent loop
  wiki-loader.js     — LLM Wiki index and retrieval
  renderer.js        — HTML/Canvas/WebGL template engine
  agent.js           — LLM synthesis orchestrator
  templates/
    base.html        — Base HTML shell with Three.js, Canvas, bzr-dial
    knowledge.html   — Entity/concept page template
    dashboard.html   — System dashboard template
    explore.html     — 3D knowledge graph template
    agent.html       — Conversational agent UI template
    canvas.html      — Pure canvas experience template
  public/
    agenthttp.css    — Styles
    agenthttp.js     — Client-side interactivity
```

## Nginx Integration

Nginx location block proxies `/agent/` path to port 3002.
All other paths served by existing configs unchanged.
