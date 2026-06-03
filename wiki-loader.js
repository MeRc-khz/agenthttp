/**
 * wiki-loader.js — LLM Wiki Index & Retrieval Engine
 * 
 * Reads /root/llm-wiki/ markdown files, builds an in-memory index
 * with full-text search, entity relationships, and context extraction.
 */

const fs = require('fs');
const path = require('path');

const WIKI_ROOT = '/root/llm-wiki';

class WikiLoader {
  constructor() {
    this.pages = new Map();      // slug → { title, type, content, links, tags }
    this.index = new Map();      // word → Set<slug>
    this.loaded = false;
  }

  /**
   * Load and index all wiki pages
   */
  load() {
    if (this.loaded) return;
    console.log('[WikiLoader] Loading LLM Wiki...');

    const dirs = ['entities', 'concepts', 'comparisons', 'queries', 'raw/transcripts', 'raw/articles'];
    
    for (const dir of dirs) {
      const dirPath = path.join(WIKI_ROOT, dir);
      if (!fs.existsSync(dirPath)) continue;
      
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const slug = file.replace('.md', '');
        const type = dir.split('/')[0]; // entities, concepts, etc.
        const filePath = path.join(dirPath, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        
        const page = this._parsePage(slug, type, content);
        this.pages.set(slug, page);
        this._indexPage(slug, page);
      }
    }

    this.loaded = true;
    console.log(`[WikiLoader] Indexed ${this.pages.size} pages`);
  }

  /**
   * Parse a wiki page: extract title, links, tags, body
   */
  _parsePage(slug, type, content) {
    const lines = content.split('\n');
    let title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const links = [];
    const tags = [];
    const bodyLines = [];
    let inFrontmatter = false;

    for (const line of lines) {
      // Extract title from first # heading
      if (line.startsWith('# ') && title === slug) {
        title = line.replace('# ', '').trim();
        continue;
      }
      
      // Extract wiki-links [[entity-name]]
      const linkMatches = line.matchAll(/\[\[([^\]]+)\]\]/g);
      for (const m of linkMatches) {
        links.push(m[1]);
      }

      // Extract tags #tag
      const tagMatches = line.matchAll(/(?<!#)#([a-z][a-z0-9_-]+)/g);
      for (const m of tagMatches) {
        if (!tags.includes(m[1])) tags.push(m[1]);
      }

      bodyLines.push(line);
    }

    return {
      slug,
      type,
      title,
      content: bodyLines.join('\n'),
      links,
      tags,
      summary: bodyLines.filter(l => l.trim() && !l.startsWith('#')).slice(0, 3).join(' ').substring(0, 300)
    };
  }

  /**
   * Add page words to the full-text index
   */
  _indexPage(slug, page) {
    const text = `${page.title} ${page.content} ${page.tags.join(' ')}`.toLowerCase();
    const words = text.split(/\W+/).filter(w => w.length > 2);
    
    for (const word of words) {
      if (!this.index.has(word)) this.index.set(word, new Set());
      this.index.get(word).add(slug);
    }
  }

  /**
   * Search pages by query string. Returns ranked results.
   */
  search(query, limit = 5) {
    this.load();
    const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const scores = new Map();

    for (const word of words) {
      // Exact match
      if (this.index.has(word)) {
        for (const slug of this.index.get(word)) {
          scores.set(slug, (scores.get(slug) || 0) + 10);
        }
      }
      // Prefix match
      for (const [idxWord, slugs] of this.index) {
        if (idxWord.startsWith(word) || word.startsWith(idxWord)) {
          for (const slug of slugs) {
            scores.set(slug, (scores.get(slug) || 0) + 3);
          }
        }
      }
    }

    // Title match bonus
    for (const [slug, page] of this.pages) {
      const titleLower = page.title.toLowerCase();
      for (const word of words) {
        if (titleLower.includes(word)) {
          scores.set(slug, (scores.get(slug) || 0) + 20);
        }
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([slug, score]) => ({ ...this.pages.get(slug), score }));
  }

  /**
   * Get a single page by slug
   */
  get(slug) {
    this.load();
    return this.pages.get(slug) || null;
  }

  /**
   * Get all pages of a type
   */
  getByType(type) {
    this.load();
    return Array.from(this.pages.values()).filter(p => p.type === type);
  }

  /**
   * Get all pages (for knowledge graph)
   */
  getAll() {
    this.load();
    return Array.from(this.pages.values());
  }

  /**
   * Get related pages (linked from this page)
   */
  getRelated(slug) {
    this.load();
    const page = this.pages.get(slug);
    if (!page) return [];
    return page.links.map(l => this.pages.get(l)).filter(Boolean);
  }

  /**
   * Build context string for LLM from search results
   */
  buildContext(query, maxPages = 3) {
    const results = this.search(query, maxPages);
    if (results.length === 0) return '';
    
    return results.map(p => {
      return `## ${p.title} [${p.type}]\n${p.summary}`;
    }).join('\n\n---\n\n');
  }
}

module.exports = new WikiLoader();
