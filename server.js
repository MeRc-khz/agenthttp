/**
 * AgentHTTP v2 — GraphQL API Server
 * 
 * The intelligent backend for NeuroCanvas.
 * 
 * Pipeline:
 * 1. NeuroCanvas sends HTML documents via GraphQL mutations
 * 2. Agent ingests → parses → indexes content
 * 3. Agent researches → enriches HTML with findings
 * 4. Agent validates against design.html (project design system)
 * 5. Agent returns validated, enriched HTML
 * 
 * Queries: projects, pages, documents, research status
 * Mutations: ingest, research, validate, createProject, createPage
 * Subscriptions: research progress, validation results
 * 
 * Wiki: reads /root/llm-wiki/ (entities, concepts, raw articles)
 * Design System: auto-generated design.html per project
 */

const express = require('express');
const { graphqlHTTP } = require('express-graphql');
const { buildSchema } = require('graphql');
const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

// ═══════════════════════════════════════════════════════════
// WIKI LOADER (enhanced from v1)
// ═══════════════════════════════════════════════════════════
const WIKI_ROOT = '/root/llm-wiki';

class WikiEngine {
  constructor() {
    this.pages = new Map();
    this.index = new Map();
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;
    const dirs = ['entities', 'concepts', 'comparisons', 'queries', 'raw/transcripts', 'raw/articles'];
    for (const dir of dirs) {
      const dirPath = path.join(WIKI_ROOT, dir);
      if (!fs.existsSync(dirPath)) continue;
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const slug = file.replace('.md', '');
        const type = dir.split('/')[0];
        const content = fs.readFileSync(path.join(dirPath, file), 'utf-8');
        const page = this._parse(slug, type, content);
        this.pages.set(slug, page);
        this._index(slug, page);
      }
    }
    this.loaded = true;
    console.log(`[WikiEngine] ${this.pages.size} pages indexed`);
  }

  _parse(slug, type, content) {
    const lines = content.split('\n');
    let title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const links = [], tags = [], bodyLines = [];
    for (const line of lines) {
      if (line.startsWith('# ') && title === slug) { title = line.replace('# ', '').trim(); continue; }
      for (const m of line.matchAll(/\[\[([^\]]+)\]\]/g)) links.push(m[1]);
      for (const m of line.matchAll(/(?<!#)#([a-z][a-z0-9_-]+)/g)) if (!tags.includes(m[1])) tags.push(m[1]);
      bodyLines.push(line);
    }
    return { slug, type, title, content: bodyLines.join('\n'), links, tags,
      summary: bodyLines.filter(l => l.trim() && !l.startsWith('#')).slice(0, 3).join(' ').substring(0, 300) };
  }

  _index(slug, page) {
    const text = `${page.title} ${page.content} ${page.tags.join(' ')}`.toLowerCase();
    for (const word of text.split(/\W+/).filter(w => w.length > 2)) {
      if (!this.index.has(word)) this.index.set(word, new Set());
      this.index.get(word).add(slug);
    }
  }

  search(query, limit = 8) {
    this.load();
    const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const scores = new Map();
    for (const word of words) {
      if (this.index.has(word)) for (const s of this.index.get(word)) scores.set(s, (scores.get(s) || 0) + 10);
      for (const [iw, slugs] of this.index) {
        if (iw.startsWith(word) || word.startsWith(iw)) for (const s of slugs) scores.set(s, (scores.get(s) || 0) + 3);
      }
    }
    for (const [slug, page] of this.pages) {
      const tl = page.title.toLowerCase();
      for (const word of words) if (tl.includes(word)) scores.set(slug, (scores.get(slug) || 0) + 20);
    }
    return Array.from(scores.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit)
      .map(([slug, score]) => ({ ...this.pages.get(slug), score }));
  }

  get(slug) { this.load(); return this.pages.get(slug) || null; }
  getAll() { this.load(); return Array.from(this.pages.values()); }
  getRelated(slug) {
    this.load();
    const page = this.pages.get(slug);
    if (!page) return [];
    return page.links.map(l => this.pages.get(l)).filter(Boolean);
  }
  buildContext(query, maxPages = 3) {
    const results = this.search(query, maxPages);
    return results.map(p => `## ${p.title} [${p.type}]\n${p.summary}`).join('\n\n---\n\n');
  }
}

const wiki = new WikiEngine();

// ═══════════════════════════════════════════════════════════
// AGENT LOOP — Ingest, Research, Update, Validate
// ═══════════════════════════════════════════════════════════

class AgentLoop {
  constructor() {
    this.jobs = new Map(); // jobId → { status, progress, result }
  }

  // ─── Ingest ───────────────────────────────────────────
  async ingest(projectId, pageId, html) {
    const jobId = uuid();
    this.jobs.set(jobId, { status: 'running', progress: 0, stage: 'parsing' });

    try {
      // 1. Parse HTML into structured content
      this.jobs.get(jobId).progress = 20;
      const parsed = this._parseHTML(html);

      // 2. Extract entities and concepts from content
      this.jobs.get(jobId).progress = 40;
      this.jobs.get(jobId).stage = 'extracting';
      const extracted = this._extractEntities(parsed);

      // 3. Cross-reference with wiki
      this.jobs.get(jobId).progress = 60;
      this.jobs.get(jobId).stage = 'cross-referencing';
      const crossRefs = this._crossReference(extracted);

      // 4. Store enriched document
      this.jobs.get(jobId).progress = 80;
      this.jobs.get(jobId).stage = 'storing';
      const enriched = {
        jobId, projectId, pageId,
        parsed, extracted, crossRefs,
        wordCount: parsed.text.split(/\s+/).length,
        entityCount: extracted.entities.length,
        linkCount: crossRefs.length,
        ingestedAt: new Date().toISOString()
      };

      this.jobs.get(jobId).status = 'complete';
      this.jobs.get(jobId).progress = 100;
      this.jobs.get(jobId).result = enriched;

      return enriched;
    } catch (err) {
      this.jobs.get(jobId).status = 'error';
      this.jobs.get(jobId).error = err.message;
      throw err;
    }
  }

  _parseHTML(html) {
    // Extract text, headings, links, media from HTML
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const headings = [];
    const links = [];
    const media = [];

    // Headings
    for (const m of html.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi)) {
      headings.push({ level: parseInt(m[1]), text: m[2].replace(/<[^>]+>/g, '').trim() });
    }

    // Links
    for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi)) {
      links.push({ href: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() });
    }

    // Media
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) media.push({ type: 'image', src: m[1] });
    for (const m of html.matchAll(/<audio[^>]+src=["']([^"']+)["']/gi)) media.push({ type: 'audio', src: m[1] });
    for (const m of html.matchAll(/<video[^>]+src=["']([^"']+)["']/gi)) media.push({ type: 'video', src: m[1] });
    for (const m of html.matchAll(/data-(audio|video|image)=["']([^"']+)["']/gi)) media.push({ type: m[1], src: m[2] });

    // Tables
    const tables = [];
    for (const m of html.matchAll(/<table[^>]*>(.*?)<\/table>/gis)) {
      const rows = [];
      for (const rm of m[1].matchAll(/<tr[^>]*>(.*?)<\/tr>/gis)) {
        const cells = [];
        for (const cm of rm[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/gis)) {
          cells.push(cm[1].replace(/<[^>]+>/g, '').trim());
        }
        if (cells.length) rows.push(cells);
      }
      if (rows.length) tables.push(rows);
    }

    return { text, headings, links, media, tables, raw: html };
  }

  _extractEntities(parsed) {
    const entities = [];
    const concepts = [];
    const text = parsed.text;

    // Extract capitalized phrases as potential entities
    const entityMatches = text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g);
    for (const m of entityMatches) {
      if (m[1].length > 3 && !entities.find(e => e.name === m[1])) {
        entities.push({ name: m[1], mentions: 1, type: 'extracted' });
      }
    }

    // Extract hashtags
    const tagMatches = text.matchAll(/#([a-zA-Z][a-zA-Z0-9_-]+)/g);
    for (const m of tagMatches) {
      if (!concepts.find(c => c.tag === m[1])) {
        concepts.push({ tag: m[1], count: 1 });
      }
    }

    // Match headings against wiki
    const wikiMatches = [];
    for (const h of parsed.headings) {
      const results = wiki.search(h.text, 3);
      if (results.length > 0) {
        wikiMatches.push({ heading: h.text, matches: results.map(r => ({ slug: r.slug, title: r.title, score: r.score })) });
      }
    }

    return { entities, concepts, wikiMatches };
  }

  _crossReference(extracted) {
    const refs = [];
    for (const match of extracted.wikiMatches) {
      for (const m of match.matches) {
        if (m.score > 15) {
          refs.push({
            sourceHeading: match.heading,
            wikiSlug: m.slug,
            wikiTitle: m.title,
            confidence: m.score > 30 ? 'high' : 'medium'
          });
        }
      }
    }
    return refs;
  }

  // ─── Research ─────────────────────────────────────────
  async research(projectId, pageId, query) {
    const jobId = uuid();
    this.jobs.set(jobId, { status: 'running', progress: 0, stage: 'searching' });

    try {
      // 1. Search wiki
      this.jobs.get(jobId).progress = 30;
      const wikiResults = wiki.search(query, 10);

      // 2. Build research context
      this.jobs.get(jobId).progress = 50;
      this.jobs.get(jobId).stage = 'synthesizing';
      const context = wiki.buildContext(query, 5);

      // 3. Find related entities
      this.jobs.get(jobId).progress = 70;
      const relatedEntities = [];
      for (const r of wikiResults.slice(0, 3)) {
        const related = wiki.getRelated(r.slug);
        for (const rel of related) {
          if (!relatedEntities.find(e => e.slug === rel.slug)) {
            relatedEntities.push({ slug: rel.slug, title: rel.title, type: rel.type });
          }
        }
      }

      // 4. Generate research findings
      this.jobs.get(jobId).progress = 90;
      this.jobs.get(jobId).stage = 'findings';
      const findings = {
        query,
        wikiResults: wikiResults.map(r => ({ slug: r.slug, title: r.title, summary: r.summary, score: r.score })),
        relatedEntities,
        context,
        suggestions: this._generateSuggestions(query, wikiResults),
        researchedAt: new Date().toISOString()
      };

      this.jobs.get(jobId).status = 'complete';
      this.jobs.get(jobId).progress = 100;
      this.jobs.get(jobId).result = findings;

      return findings;
    } catch (err) {
      this.jobs.get(jobId).status = 'error';
      this.jobs.get(jobId).error = err.message;
      throw err;
    }
  }

  _generateSuggestions(query, results) {
    const suggestions = [];
    if (results.length > 0) {
      suggestions.push(`Found ${results.length} related wiki pages`);
      const types = [...new Set(results.map(r => r.type))];
      if (types.length > 1) suggestions.push(`Spans ${types.length} knowledge categories`);
    }
    const relatedTags = new Set();
    for (const r of results) r.tags.forEach(t => relatedTags.add(t));
    if (relatedTags.size > 0) {
      suggestions.push(`Related topics: ${[...relatedTags].slice(0, 5).join(', ')}`);
    }
    return suggestions;
  }

  // ─── Update HTML ──────────────────────────────────────
  async updateHTML(projectId, pageId, html, findings) {
    const jobId = uuid();
    this.jobs.set(jobId, { status: 'running', progress: 0, stage: 'updating' });

    try {
      let updated = html;

      // 1. Add research annotations as data attributes
      this.jobs.get(jobId).progress = 30;
      if (findings.wikiResults) {
        for (const r of findings.wikiResults) {
          // Link mentions of wiki entities to their pages
          const regex = new RegExp(`\\b(${this._escapeRegex(r.title)})\\b`, 'gi');
          if (!updated.includes(`data-wiki="${r.slug}"`)) {
            updated = updated.replace(regex, `<span class="nc-wiki-link" data-wiki="${r.slug}" title="${r.summary.substring(0, 100)}">$1</span>`);
          }
        }
      }

      // 2. Add related content suggestions panel
      this.jobs.get(jobId).progress = 60;
      this.jobs.get(jobId).stage = 'annotating';
      if (findings.relatedEntities && findings.relatedEntities.length > 0) {
        const panelHTML = this._buildRelatedPanel(findings.relatedEntities);
        // Insert before closing body tag or append
        if (updated.includes('</body>')) {
          updated = updated.replace('</body>', `${panelHTML}</body>`);
        } else {
          updated += panelHTML;
        }
      }

      // 3. Add research metadata
      this.jobs.get(jobId).progress = 80;
      const metaTag = `<meta name="nc-research" content="${new Date().toISOString()}" data-findings="${findings.wikiResults?.length || 0}" />`;
      if (updated.includes('<head>')) {
        updated = updated.replace('<head>', `<head>${metaTag}`);
      } else if (updated.includes('<html')) {
        updated = updated.replace('<html', `<html${metaTag}`);
      }

      this.jobs.get(jobId).status = 'complete';
      this.jobs.get(jobId).progress = 100;
      this.jobs.get(jobId).result = { html: updated, changes: findings.wikiResults?.length || 0 };

      return { html: updated, changes: findings.wikiResults?.length || 0 };
    } catch (err) {
      this.jobs.get(jobId).status = 'error';
      this.jobs.get(jobId).error = err.message;
      throw err;
    }
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _buildRelatedPanel(entities) {
    const items = entities.slice(0, 6).map(e =>
      `<a href="/agent/knowledge/${e.slug}" class="nc-related-item" data-slug="${e.slug}">
        <span class="nc-related-type">${e.type}</span>
        <span class="nc-related-title">${e.title}</span>
      </a>`
    ).join('');

    return `
<div class="nc-related-panel" id="nc-related-panel">
  <div class="nc-related-header">
    <span class="nc-related-icon">◈</span>
    <span>Related Knowledge</span>
    <button class="nc-related-close" onclick="document.getElementById('nc-related-panel').remove()">×</button>
  </div>
  <div class="nc-related-list">${items}</div>
</div>
<style>
.nc-related-panel{position:fixed;bottom:24px;right:24px;width:320px;background:#111;border:1px solid #333;border-radius:12px;padding:16px;z-index:9999;box-shadow:0 8px 32px #00000088;font-family:'Space Grotesk',sans-serif}
.nc-related-header{display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:13px;font-weight:600;color:#2bee8c}
.nc-related-close{margin-left:auto;background:none;border:none;color:#666;cursor:pointer;font-size:16px}
.nc-related-item{display:flex;align-items:center;gap:8px;padding:8px;border-radius:6px;text-decoration:none;color:#ccc;font-size:12px;transition:background .15s}
.nc-related-item:hover{background:#1a1a1a}
.nc-related-type{font-size:9px;text-transform:uppercase;background:#1c2721;color:#2bee8c;padding:2px 6px;border-radius:4px}
</style>`;
  }

  // ─── Validate ─────────────────────────────────────────
  async validate(projectId, pageId, html, designHTML) {
    const jobId = uuid();
    this.jobs.set(jobId, { status: 'running', progress: 0, stage: 'validating' });

    try {
      const issues = [];
      const warnings = [];
      const passed = [];

      // 1. Parse design system
      this.jobs.get(jobId).progress = 20;
      const design = this._parseDesign(designHTML);

      // 2. Check color usage
      this.jobs.get(jobId).progress = 40;
      this.jobs.get(jobId).stage = 'checking-colors';
      const colors = this._extractColors(html);
      for (const color of colors) {
        if (!design.colors.includes(color) && !this._isNeutral(color)) {
          warnings.push({ type: 'color', message: `Color ${color} not in design system`, value: color, suggestion: this._findClosestColor(color, design.colors) });
        }
      }
      if (colors.length === 0 || design.colors.every(c => colors.includes(c))) {
        passed.push({ type: 'colors', message: 'Color palette matches design system' });
      }

      // 3. Check typography
      this.jobs.get(jobId).progress = 60;
      this.jobs.get(jobId).stage = 'checking-typography';
      const fonts = this._extractFonts(html);
      for (const font of fonts) {
        if (!design.fonts.some(f => font.toLowerCase().includes(f.toLowerCase()))) {
          warnings.push({ type: 'font', message: `Font "${font}" not in design system`, value: font, suggestion: design.fonts[0] });
        }
      }

      // 4. Check heading hierarchy
      this.jobs.get(jobId).progress = 80;
      this.jobs.get(jobId).stage = 'checking-structure';
      const headings = html.matchAll(/<h([1-6])[^>]*>/gi);
      let prevLevel = 0;
      for (const h of headings) {
        const level = parseInt(h[1]);
        if (level > prevLevel + 1 && prevLevel > 0) {
          issues.push({ type: 'hierarchy', message: `Heading level h${level} follows h${prevLevel} — skip level`, value: `h${prevLevel} → h${level}` });
        }
        prevLevel = level;
      }

      // 5. Check for required elements
      if (design.requiredElements) {
        for (const el of design.requiredElements) {
          if (!html.includes(el.tag)) {
            issues.push({ type: 'required', message: `Missing required element: <${el.tag}>`, value: el.tag });
          }
        }
      }

      // 6. Check accessibility
      const imgs = html.matchAll(/<img[^>]*>/gi);
      for (const img of imgs) {
        if (!img[0].includes('alt=')) {
          warnings.push({ type: 'a11y', message: 'Image missing alt text', value: img[0].substring(0, 60) });
        }
      }

      // 7. Content freshness
      const researchMeta = html.match(/data-findings="(\d+)"/);
      if (researchMeta && parseInt(researchMeta[1]) > 0) {
        passed.push({ type: 'research', message: `${researchMeta[1]} research findings integrated` });
      }

      const result = {
        jobId, projectId, pageId,
        valid: issues.length === 0,
        score: Math.max(0, 100 - issues.length * 15 - warnings.length * 5),
        issues, warnings, passed,
        design: { colors: design.colors.length, fonts: design.fonts.length },
        validatedAt: new Date().toISOString()
      };

      this.jobs.get(jobId).status = 'complete';
      this.jobs.get(jobId).progress = 100;
      this.jobs.get(jobId).result = result;

      return result;
    } catch (err) {
      this.jobs.get(jobId).status = 'error';
      this.jobs.get(jobId).error = err.message;
      throw err;
    }
  }

  _parseDesign(html) {
    const colors = [];
    const fonts = [];
    const requiredElements = [];

    // Extract CSS variables
    for (const m of html.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))/g)) {
      if (m[1].includes('color') || m[1].includes('primary') || m[1].includes('secondary') || m[1].includes('accent') || m[1].includes('surface') || m[1].includes('bg')) {
        colors.push(m[2]);
      }
    }

    // Extract font families
    for (const m of html.matchAll(/font-family:\s*([^;]+)/g)) {
      const font = m[1].replace(/['"]/g, '').split(',')[0].trim();
      if (!fonts.includes(font)) fonts.push(font);
    }

    // Extract required elements from comments
    for (const m of html.matchAll(/<!--\s*required:\s*(\w+)/g)) {
      requiredElements.push({ tag: m[1] });
    }

    // Defaults if not found
    if (colors.length === 0) colors.push('#2bee8c', '#0a0a0a', '#111118', '#ffffff', '#6b7280');
    if (fonts.length === 0) fonts.push('Space Grotesk', 'Inter', 'system-ui');

    return { colors: [...new Set(colors)], fonts: [...new Set(fonts)], requiredElements };
  }

  _extractColors(html) {
    const colors = new Set();
    for (const m of html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) colors.add(m[0].toLowerCase());
    for (const m of html.matchAll(/rgb[a]?\([^)]+\)/g)) colors.add(m[0]);
    return [...colors];
  }

  _extractFonts(html) {
    const fonts = new Set();
    for (const m of html.matchAll(/font-family:\s*([^;]+)/g)) {
      fonts.add(m[1].replace(/['"]/g, '').split(',')[0].trim());
    }
    return [...fonts];
  }

  _isNeutral(color) {
    const neutrals = ['#000', '#fff', '#000000', '#ffffff', '#111', '#222', '#333', '#444', '#555', '#666', '#777', '#888', '#999', '#aaa', '#bbb', '#ccc', '#ddd', '#eee', '#f5f5f5', '#fafafa'];
    return neutrals.some(n => color.toLowerCase().includes(n)) || color.includes('rgb(0') || color.includes('rgb(255') || color.includes('rgba(0') || color.includes('rgba(255');
  }

  _findClosestColor(color, palette) {
    if (palette.length === 0) return '#2bee8c';
    // Simple: return first palette color
    return palette[0];
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }
}

const agent = new AgentLoop();

// ═══════════════════════════════════════════════════════════
// DATA STORE (projects, pages, documents)
// ═══════════════════════════════════════════════════════════
const DATA_DIR = '/root/neurocanvas-v2/data';
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadStore() {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'store.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { projects: {}, documents: {}, designs: {} };
  }
}

function saveStore(store) {
  fs.writeFileSync(path.join(DATA_DIR, 'store.json'), JSON.stringify(store, null, 2));
}

// ═══════════════════════════════════════════════════════════
// DESIGN SYSTEM GENERATOR
// ═══════════════════════════════════════════════════════════
function generateDesignHTML(projectName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Design System — ${projectName}</title>
<style>
/* ═══ Design System: ${projectName} ═══ */
:root {
  /* Colors */
  --nc-primary: #2bee8c;
  --nc-primary-dark: #1fa863;
  --nc-secondary: #4A7040;
  --nc-accent: #ff0055;
  --nc-bg: #0a0a0a;
  --nc-surface: #111118;
  --nc-surface-border: #222;
  --nc-text: #e0e0e0;
  --nc-text-muted: #6b7280;
  --nc-text-heading: #ffffff;

  /* Typography */
  --nc-font-display: 'Space Grotesk', system-ui, sans-serif;
  --nc-font-body: 'Inter', system-ui, sans-serif;
  --nc-font-mono: 'JetBrains Mono', monospace;

  /* Spacing */
  --nc-space-xs: 4px;
  --nc-space-sm: 8px;
  --nc-space-md: 16px;
  --nc-space-lg: 24px;
  --nc-space-xl: 48px;

  /* Radius */
  --nc-radius-sm: 4px;
  --nc-radius-md: 8px;
  --nc-radius-lg: 12px;
  --nc-radius-xl: 16px;

  /* Shadows */
  --nc-shadow-sm: 0 1px 3px #00000044;
  --nc-shadow-md: 0 4px 12px #00000066;
  --nc-shadow-lg: 0 8px 32px #00000088;
}

/* Base */
.nc-page { font-family: var(--nc-font-body); color: var(--nc-text); background: var(--nc-bg); line-height: 1.6; }
.nc-page h1, .nc-page h2, .nc-page h3 { font-family: var(--nc-font-display); color: var(--nc-text-heading); font-weight: 700; }
.nc-page h1 { font-size: 2.5rem; margin-bottom: var(--nc-space-lg); }
.nc-page h2 { font-size: 1.75rem; margin-bottom: var(--nc-space-md); }
.nc-page h3 { font-size: 1.25rem; margin-bottom: var(--nc-space-sm); }
.nc-page p { margin-bottom: var(--nc-space-md); }
.nc-page a { color: var(--nc-primary); text-decoration: none; }
.nc-page a:hover { text-decoration: underline; }

/* Wiki links */
.nc-wiki-link { color: var(--nc-primary); border-bottom: 1px dashed var(--nc-primary); cursor: pointer; }

/* Media */
.nc-page img { max-width: 100%; border-radius: var(--nc-radius-md); }
.nc-page audio { width: 100%; border-radius: var(--nc-radius-md); }
.nc-page video { max-width: 100%; border-radius: var(--nc-radius-md); }

/* Tables */
.nc-page table { width: 100%; border-collapse: collapse; margin-bottom: var(--nc-space-md); }
.nc-page th { background: var(--nc-surface); color: var(--nc-primary); padding: var(--nc-space-sm) var(--nc-space-md); text-align: left; font-weight: 600; border: 1px solid var(--nc-surface-border); }
.nc-page td { padding: var(--nc-space-sm) var(--nc-space-md); border: 1px solid var(--nc-surface-border); }

/* Related panel */
.nc-related-panel { position: fixed; bottom: 24px; right: 24px; width: 320px; background: var(--nc-surface); border: 1px solid var(--nc-surface-border); border-radius: var(--nc-radius-lg); padding: var(--nc-space-md); z-index: 9999; box-shadow: var(--nc-shadow-lg); font-family: var(--nc-font-display); }
</style>
</head>
<body>
<!-- required: header -->
<!-- required: main -->
<!-- required: footer -->
<div class="nc-design-notes">
  <h1>Design System: ${projectName}</h1>
  <p>This document defines the visual language for all pages in this project.</p>
  <p>When pages are validated, they are checked against these design tokens.</p>
</div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════
// GRAPHQL SCHEMA
// ═══════════════════════════════════════════════════════════

const schema = buildSchema(`
  type Project {
    id: ID!
    name: String!
    description: String
    pages: [Page!]!
    design: Design
    createdAt: String!
    updatedAt: String!
  }

  type Page {
    id: ID!
    projectId: ID!
    title: String!
    html: String!
    width: Int
    height: Int
    x: Int
    y: Int
    ingested: IngestResult
    validation: ValidationResult
    createdAt: String!
    updatedAt: String!
  }

  type Design {
    id: ID!
    projectId: ID!
    html: String!
    colors: [String!]!
    fonts: [String!]!
  }

  type IngestResult {
    jobId: String!
    wordCount: Int!
    entityCount: Int!
    linkCount: Int!
    crossRefs: [CrossRef!]!
    ingestedAt: String!
  }

  type CrossRef {
    sourceHeading: String!
    wikiSlug: String!
    wikiTitle: String!
    confidence: String!
  }

  type ResearchResult {
    query: String!
    wikiResults: [WikiResult!]!
    relatedEntities: [EntityRef!]!
    suggestions: [String!]!
    researchedAt: String!
  }

  type WikiResult {
    slug: String!
    title: String!
    summary: String!
    score: Int!
  }

  type EntityRef {
    slug: String!
    title: String!
    type: String!
  }

  type ValidationResult {
    jobId: String!
    valid: Boolean!
    score: Int!
    issues: [ValidationIssue!]!
    warnings: [ValidationWarning!]!
    passed: [ValidationPassed!]!
    validatedAt: String!
  }

  type ValidationIssue {
    type: String!
    message: String!
    value: String
  }

  type ValidationWarning {
    type: String!
    message: String!
    value: String
    suggestion: String
  }

  type ValidationPassed {
    type: String!
    message: String!
  }

  type JobStatus {
    jobId: String!
    status: String!
    progress: Int!
    stage: String
    result: String
    error: String
  }

  type Query {
    projects: [Project!]!
    project(id: ID!): Project
    page(projectId: ID!, pageId: ID!): Page
    job(jobId: String!): JobStatus
    searchWiki(query: String!, limit: Int): [WikiResult!]!
    wikiPage(slug: String!): WikiResult
  }

  type Mutation {
    createProject(name: String!, description: String): Project!
    updateProject(id: ID!, name: String, description: String): Project!
    deleteProject(id: ID!): Boolean!

    createPage(projectId: ID!, title: String, html: String, width: Int, height: Int, x: Int, y: Int): Page!
    updatePage(projectId: ID!, pageId: ID!, title: String, html: String, width: Int, height: Int, x: Int, y: Int): Page!
    deletePage(projectId: ID!, pageId: ID!): Boolean!

    ingest(projectId: ID!, pageId: ID!, html: String!): IngestResult!
    research(projectId: ID!, pageId: ID!, query: String!): ResearchResult!
    updateHTML(projectId: ID!, pageId: ID!, html: String!, findingsJson: String!): UpdateResult!
    validate(projectId: ID!, pageId: ID!, html: String!, designHtml: String!): ValidationResult!

    fullPipeline(projectId: ID!, pageId: ID!, html: String!, query: String!): PipelineResult!
  }

  type UpdateResult {
    html: String!
    changes: Int!
  }

  type PipelineResult {
    ingest: IngestResult!
    research: ResearchResult!
    updated: UpdateResult!
    validation: ValidationResult!
    finalHtml: String!
  }
`);

// ═══════════════════════════════════════════════════════════
// GRAPHQL RESOLVERS
// ═══════════════════════════════════════════════════════════

const store = loadStore();

function getProject(id) {
  return store.projects[id] || null;
}

function saveProject(p) {
  store.projects[p.id] = p;
  saveStore(store);
  return p;
}

const root = {
  // ─── Queries ──────────────────────────────────────────
  projects: () => Object.values(store.projects)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(p => ({ ...p, pages: Object.values(p.pages || {}) })),

  project: ({ id }) => {
    const p = getProject(id);
    if (!p) return null;
    return { ...p, pages: Object.values(p.pages || {}) };
  },

  page: ({ projectId, pageId }) => {
    const p = getProject(projectId);
    return p?.pages?.[pageId] || null;
  },

  job: ({ jobId }) => agent.getJob(jobId),

  searchWiki: ({ query, limit }) => wiki.search(query, limit || 8),

  wikiPage: ({ slug }) => wiki.get(slug),

  // ─── Mutations ────────────────────────────────────────
  createProject: ({ name, description }) => {
    const project = {
      id: uuid(), name: name || 'Untitled', description: description || '',
      pages: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    store.designs[project.id] = {
      id: uuid(), projectId: project.id,
      html: generateDesignHTML(name || 'Untitled'),
      colors: ['#2bee8c', '#0a0a0a', '#111118', '#ffffff', '#6b7280'],
      fonts: ['Space Grotesk', 'Inter', 'system-ui']
    };
    saveProject(project);
    return { ...project, pages: [] };
  },

  updateProject: ({ id, name, description }) => {
    const p = getProject(id);
    if (!p) throw new Error('Project not found');
    if (name) p.name = name;
    if (description) p.description = description;
    p.updatedAt = new Date().toISOString();
    saveProject(p);
    return { ...p, pages: Object.values(p.pages || {}) };
  },

  deleteProject: ({ id }) => {
    delete store.projects[id];
    delete store.designs[id];
    saveStore(store);
    return true;
  },

  createPage: ({ projectId, title, html, width, height, x, y }) => {
    const p = getProject(projectId);
    if (!p) throw new Error('Project not found');
    const page = {
      id: uuid(), projectId, title: title || 'Untitled',
      html: html || '<div class="nc-page"><h1>New Page</h1></div>',
      width: width || 800, height: height || 600,
      x: x || 0, y: y || 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    p.pages[page.id] = page;
    p.updatedAt = new Date().toISOString();
    saveProject(p);
    return page;
  },

  updatePage: ({ projectId, pageId, title, html, width, height, x, y }) => {
    const p = getProject(projectId);
    if (!p) throw new Error('Project not found');
    const page = p.pages[pageId];
    if (!page) throw new Error('Page not found');
    if (title) page.title = title;
    if (html) page.html = html;
    if (width) page.width = width;
    if (height) page.height = height;
    if (x !== undefined) page.x = x;
    if (y !== undefined) page.y = y;
    page.updatedAt = new Date().toISOString();
    p.updatedAt = new Date().toISOString();
    saveProject(p);
    return page;
  },

  deletePage: ({ projectId, pageId }) => {
    const p = getProject(projectId);
    if (!p) throw new Error('Project not found');
    delete p.pages[pageId];
    p.updatedAt = new Date().toISOString();
    saveProject(p);
    return true;
  },

  // ─── Agent Pipeline ───────────────────────────────────
  ingest: async ({ projectId, pageId, html }) => {
    const result = await agent.ingest(projectId, pageId, html);
    // Store result on page
    const p = getProject(projectId);
    if (p?.pages?.[pageId]) {
      p.pages[pageId].ingested = result;
      saveProject(p);
    }
    return result;
  },

  research: ({ projectId, pageId, query }) => {
    return agent.research(projectId, pageId, query);
  },

  updateHTML: async ({ projectId, pageId, html, findingsJson }) => {
    const findings = JSON.parse(findingsJson);
    const result = await agent.updateHTML(projectId, pageId, html, findings);
    // Update page with enriched HTML
    const p = getProject(projectId);
    if (p?.pages?.[pageId]) {
      p.pages[pageId].html = result.html;
      p.pages[pageId].updatedAt = new Date().toISOString();
      saveProject(p);
    }
    return result;
  },

  validate: ({ projectId, pageId, html, designHtml }) => {
    const result = agent.validate(projectId, pageId, html, designHtml);
    // Store validation result
    const p = getProject(projectId);
    if (p?.pages?.[pageId]) {
      p.pages[pageId].validation = result;
      saveProject(p);
    }
    return result;
  },

  fullPipeline: async ({ projectId, pageId, html, query }) => {
    // Run the complete pipeline: ingest → research → update → validate
    const ingestResult = await agent.ingest(projectId, pageId, html);
    const researchResult = await agent.research(projectId, pageId, query);
    const updateResult = await agent.updateHTML(projectId, pageId, html, researchResult);
    const designHtml = store.designs[projectId]?.html || generateDesignHTML('Default');
    const validationResult = await agent.validate(projectId, pageId, updateResult.html, designHtml);

    // Update page
    const p = getProject(projectId);
    if (p?.pages?.[pageId]) {
      p.pages[pageId].html = updateResult.html;
      p.pages[pageId].ingested = ingestResult;
      p.pages[pageId].validation = validationResult;
      p.pages[pageId].updatedAt = new Date().toISOString();
      saveProject(p);
    }

    return {
      ingest: ingestResult,
      research: researchResult,
      updated: updateResult,
      validation: validationResult,
      finalHtml: updateResult.html
    };
  }
};

// ═══════════════════════════════════════════════════════════
// EXPRESS SERVER
// ═══════════════════════════════════════════════════════════

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

// GraphQL endpoint
app.use('/graphql', graphqlHTTP({
  schema,
  rootValue: root,
  graphiql: true,  // Enable GraphiQL IDE for testing
  customFormatErrorFn: (err) => ({ message: err.message, locations: err.locations })
}));

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'agenthttp-v2', wiki: wiki.pages.size, graphql: true });
});

// Load wiki on startup
wiki.load();

const PORT = process.env.AGENTHTTP_PORT || 3002;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  AgentHTTP v2 — GraphQL API Server`);
  console.log(`  Port: ${PORT}`);
  console.log(`  GraphQL: http://localhost:${PORT}/graphql`);
  console.log(`  Wiki: ${wiki.pages.size} pages indexed`);
  console.log(`${'═'.repeat(60)}\n`);
});

module.exports = app;
