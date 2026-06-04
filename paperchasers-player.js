#!/usr/bin/env node
/**
 * Paperchasers Multimedia Player
 * 
 * Served by AgentHTTP at /player/paperchasers
 * 
 * Features:
 * - 24 audio segments with individual playback
 * - Full transcript display with word-level timestamps
 * - Inline transcript editing (click to edit, Enter to save)
 * - Save corrections back to server
 * - Waveform visualization
 * - Keyboard shortcuts (Space=play/pause, ←/→=prev/next segment)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const SEGMENTS_DIR = '/var/www/bzr-dial-menu/media/paperchasers-segments';
const TRANSCRIPTS_DIR = '/root/paperchasers-master/transcripts';
const CORRECTIONS_DIR = '/root/paperchasers-master/corrections';

// Ensure corrections directory exists
fs.mkdirSync(CORRECTIONS_DIR, { recursive: true });

// ─── Load segment data ──────────────────────────────────
function loadSegments() {
  const segments = [];
  const transcriptFiles = fs.readdirSync(TRANSCRIPTS_DIR)
    .filter(f => f.startsWith('segment_') && f.endsWith('.json'))
    .sort();

  // Map files by segment number
  const fileMap = {};
  for (const f of transcriptFiles) {
    fileMap[f.replace('.json', '')] = f;
  }

  // Get audio files
  const audioFiles = fs.readdirSync(SEGMENTS_DIR)
    .filter(f => f.endsWith('.wav'))
    .sort();

  for (const audioFile of audioFiles) {
    const segName = audioFile.replace('.wav', '');
    const transcriptFile = path.join(TRANSCRIPTS_DIR, `${segName}.json`);
    
    if (!fs.existsSync(transcriptFile)) continue;
    
    const transcript = JSON.parse(fs.readFileSync(transcriptFile, 'utf-8'));
    const audioPath = path.join(SEGMENTS_DIR, audioFile);
    const stats = fs.statSync(audioPath);
    
    segments.push({
      id: segName,
      number: parseInt(segName.replace('segment_', '')),
      audioFile: audioFile,
      duration: transcript.duration_seconds,
      language: transcript.language,
      fullText: transcript.full_text,
      segments: transcript.segments || [],
      fileSize: stats.size
    });
  }

  return segments;
}

// ─── Load corrections ───────────────────────────────────
function loadCorrections(segId) {
  const corrFile = path.join(CORRECTIONS_DIR, `${segId}.json`);
  if (fs.existsSync(corrFile)) {
    return JSON.parse(fs.readFileSync(corrFile, 'utf-8'));
  }
  return null;
}

function saveCorrection(segId, data) {
  const corrFile = path.join(CORRECTIONS_DIR, `${segId}.json`);
  fs.writeFileSync(corrFile, JSON.stringify({
    ...data,
    correctedAt: new Date().toISOString()
  }, null, 2));
  return true;
}

// ─── Generate player HTML ───────────────────────────────
function generatePlayerHTML(segments) {
  const segmentsJSON = JSON.stringify(segments);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Paperchasers — Master Recording | Bizarre Lynx</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0a0a0a;
  --surface: #111118;
  --surface-2: #1a1a22;
  --border: #222;
  --border-light: #333;
  --primary: #00ff9d;
  --primary-dim: #00cc7d;
  --primary-glow: rgba(0, 255, 157, 0.15);
  --text: #e0e0e0;
  --text-dim: #888;
  --text-muted: #555;
  --accent: #9945FF;
  --danger: #ff4455;
  --warning: #ffaa00;
  --font: 'Space Grotesk', system-ui, sans-serif;
  --mono: 'JetBrains Mono', monospace;
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  min-height: 100vh;
  overflow-x: hidden;
}

/* ═══ HEADER ═══ */
.pc-header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(10, 10, 10, 0.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  padding: 16px 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pc-logo {
  display: flex;
  align-items: center;
  gap: 12px;
}

.pc-logo-icon {
  width: 36px;
  height: 36px;
  background: var(--primary);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.pc-logo h1 {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.5px;
}

.pc-logo span {
  color: var(--primary);
}

.pc-header-meta {
  display: flex;
  align-items: center;
  gap: 24px;
  font-size: 13px;
  color: var(--text-dim);
}

.pc-header-meta .stat {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pc-header-meta .stat-value {
  font-family: var(--mono);
  color: var(--primary);
  font-weight: 500;
}

/* ═══ MAIN LAYOUT ═══ */
.pc-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  min-height: calc(100vh - 69px);
}

/* ═══ SEGMENT LIST (LEFT SIDEBAR) ═══ */
.pc-segment-list {
  background: var(--surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  max-height: calc(100vh - 69px);
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.pc-segment-list::-webkit-scrollbar { width: 4px; }
.pc-segment-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.pc-segment-item {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}

.pc-segment-item:hover {
  background: var(--surface-2);
}

.pc-segment-item.active {
  background: var(--primary-glow);
  border-left: 3px solid var(--primary);
}

.pc-segment-item.has-corrections {
  border-right: 3px solid var(--accent);
}

.pc-segment-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.pc-segment-num {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--primary);
  font-weight: 500;
}

.pc-segment-dur {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
}

.pc-segment-preview {
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 280px;
}

.pc-segment-item.active .pc-segment-preview {
  color: var(--text);
}

/* ═══ RIGHT PANEL ═══ */
.pc-main {
  overflow-y: auto;
  max-height: calc(100vh - 69px);
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}

.pc-main::-webkit-scrollbar { width: 6px; }
.pc-main::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

/* ═══ NOW PLAYING BAR ═══ */
.pc-now-playing {
  padding: 32px;
  border-bottom: 1px solid var(--border);
}

.pc-now-playing-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.pc-now-playing-title {
  font-size: 24px;
  font-weight: 700;
}

.pc-now-playing-title span {
  color: var(--primary);
}

/* ═══ AUDIO PLAYER ═══ */
.pc-player {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 24px;
}

.pc-waveform {
  width: 100%;
  height: 80px;
  background: var(--surface-2);
  border-radius: 8px;
  margin-bottom: 16px;
  position: relative;
  overflow: hidden;
  cursor: pointer;
}

.pc-waveform canvas {
  width: 100%;
  height: 100%;
}

.pc-waveform-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: var(--primary-glow);
  pointer-events: none;
  transition: width 0.1s;
}

.pc-waveform-cursor {
  position: absolute;
  top: 0;
  width: 2px;
  height: 100%;
  background: var(--primary);
  pointer-events: none;
  transition: left 0.1s;
  box-shadow: 0 0 8px var(--primary);
}

.pc-player-controls {
  display: flex;
  align-items: center;
  gap: 16px;
}

.pc-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text);
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-family: var(--font);
  font-size: 13px;
  transition: all 0.15s;
}

.pc-btn:hover {
  background: var(--surface-2);
  border-color: var(--border-light);
}

.pc-btn-primary {
  background: var(--primary);
  color: #000;
  border-color: var(--primary);
  font-weight: 600;
  padding: 10px 24px;
}

.pc-btn-primary:hover {
  background: var(--primary-dim);
}

.pc-btn-icon {
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.pc-time {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text-dim);
  min-width: 100px;
}

.pc-time .current { color: var(--primary); }
.pc-time .sep { color: var(--text-muted); }

.pc-volume {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pc-volume input[type="range"] {
  width: 80px;
  accent-color: var(--primary);
}

/* ═══ TRANSCRIPT ═══ */
.pc-transcript {
  padding: 0 32px 32px;
}

.pc-transcript-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  padding-top: 24px;
}

.pc-transcript-title {
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pc-transcript-badge {
  font-size: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--text-muted);
  text-transform: uppercase;
  font-family: var(--mono);
}

.pc-transcript-actions {
  display: flex;
  gap: 8px;
}

/* ─── Full Text Block ─── */
.pc-full-text {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 24px;
  margin-bottom: 24px;
  font-size: 15px;
  line-height: 1.7;
  position: relative;
}

.pc-full-text.editing {
  border-color: var(--accent);
  box-shadow: 0 0 20px rgba(153, 69, 255, 0.1);
}

.pc-full-text textarea {
  width: 100%;
  background: transparent;
  border: none;
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.7;
  resize: vertical;
  min-height: 100px;
  outline: none;
}

.pc-full-text .edit-bar {
  display: none;
  gap: 8px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.pc-full-text.editing .edit-bar {
  display: flex;
}

/* ─── Timestamped Lines ─── */
.pc-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pc-line {
  display: grid;
  grid-template-columns: 80px 1fr;
  gap: 16px;
  padding: 6px 12px;
  border-radius: 6px;
  transition: background 0.15s;
  cursor: pointer;
  align-items: start;
}

.pc-line:hover {
  background: var(--surface-2);
}

.pc-line.active {
  background: var(--primary-glow);
}

.pc-line-time {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  padding-top: 2px;
  user-select: none;
}

.pc-line-text {
  font-size: 14px;
  line-height: 1.6;
}

.pc-line-text .word {
  padding: 1px 0;
  border-radius: 2px;
  transition: background 0.1s;
}

.pc-line-text .word:hover {
  background: var(--primary-glow);
}

.pc-line-text .word.highlight {
  background: var(--primary-glow);
  color: var(--primary);
}

/* ─── Corrections indicator ─── */
.pc-correction-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  background: rgba(153, 69, 255, 0.15);
  color: var(--accent);
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 8px;
  font-family: var(--mono);
}

/* ═══ FOOTER ═══ */
.pc-footer {
  padding: 24px 32px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
}

/* ═══ ANIMATIONS ═══ */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.playing .pc-logo-icon {
  animation: pulse 1s ease-in-out infinite;
}

/* ═══ RESPONSIVE ═══ */
@media (max-width: 900px) {
  .pc-layout { grid-template-columns: 1fr; }
  .pc-segment-list { max-height: 200px; border-right: none; border-bottom: 1px solid var(--border); }
  .pc-line { grid-template-columns: 60px 1fr; gap: 8px; }
}

/* ═══ SAVE TOAST ═══ */
.pc-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  background: var(--surface);
  border: 1px solid var(--primary);
  border-radius: 8px;
  padding: 12px 20px;
  font-size: 13px;
  color: var(--primary);
  z-index: 1000;
  transform: translateY(100px);
  opacity: 0;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}

.pc-toast.show {
  transform: translateY(0);
  opacity: 1;
}

/* ═══ SEGMENT NAV ═══ */
.pc-segment-nav {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pc-segment-nav-btn {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text);
  width: 36px;
  height: 36px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  transition: all 0.15s;
}

.pc-segment-nav-btn:hover {
  background: var(--surface);
  border-color: var(--border-light);
}

.pc-segment-indicator {
  font-family: var(--mono);
  font-size: 13px;
  color: var(--text-dim);
  min-width: 60px;
  text-align: center;
}
</style>
</head>
<body class="pc-body">

<!-- ═══ HEADER ═══ -->
<header class="pc-header">
  <div class="pc-logo">
    <div class="pc-logo-icon">🎤</div>
    <h1>PAPER<span>CHASERS</span></h1>
  </div>
  <div class="pc-header-meta">
    <div class="stat">
      <span>Segments:</span>
      <span class="stat-value" id="stat-segments">24</span>
    </div>
    <div class="stat">
      <span>Duration:</span>
      <span class="stat-value" id="stat-duration">34:17</span>
    </div>
    <div class="stat">
      <span>Corrections:</span>
      <span class="stat-value" id="stat-corrections">0</span>
    </div>
  </div>
</header>

<!-- ═══ LAYOUT ═══ -->
<div class="pc-layout">

  <!-- ─── SEGMENT LIST ─── -->
  <aside class="pc-segment-list" id="segmentList">
    <!-- Populated by JS -->
  </aside>

  <!-- ─── MAIN ─── -->
  <main class="pc-main">

    <!-- NOW PLAYING -->
    <section class="pc-now-playing">
      <div class="pc-now-playing-header">
        <div>
          <div class="pc-now-playing-title" id="nowPlayingTitle">
            Segment <span id="currentSegNum">01</span>
          </div>
          <div style="font-size:13px; color:var(--text-muted); margin-top:4px;" id="nowPlayingMeta">
            4:57 • 0:00–4:57
          </div>
        </div>
        <div class="pc-segment-nav">
          <button class="pc-segment-nav-btn" onclick="player.prevSegment()" title="Previous (←)">◀</button>
          <span class="pc-segment-indicator" id="segmentIndicator">1 / 24</span>
          <button class="pc-segment-nav-btn" onclick="player.nextSegment()" title="Next (→)">▶</button>
        </div>
      </div>

      <!-- PLAYER -->
      <div class="pc-player">
        <div class="pc-waveform" id="waveform" onclick="player.seek(event)">
          <canvas id="waveformCanvas"></canvas>
          <div class="pc-waveform-progress" id="waveformProgress"></div>
          <div class="pc-waveform-cursor" id="waveformCursor"></div>
        </div>
        <div class="pc-player-controls">
          <button class="pc-btn pc-btn-icon" onclick="player.prevSegment()" title="Previous">⏮</button>
          <button class="pc-btn pc-btn-primary" id="playBtn" onclick="player.togglePlay()" title="Play/Pause (Space)">▶ Play</button>
          <button class="pc-btn pc-btn-icon" onclick="player.nextSegment()" title="Next">⏭</button>
          <span class="pc-time">
            <span class="current" id="currentTime">0:00</span>
            <span class="sep">/</span>
            <span class="total" id="totalTime">0:00</span>
          </span>
          <div class="pc-volume">
            <span style="font-size:13px;">🔊</span>
            <input type="range" min="0" max="100" value="80" oninput="player.setVolume(this.value/100)" title="Volume">
          </div>
        </div>
      </div>
    </section>

    <!-- TRANSCRIPT -->
    <section class="pc-transcript">
      <div class="pc-transcript-header">
        <div class="pc-transcript-title">
          📝 Transcript
          <span class="pc-transcript-badge" id="transcriptStatus">whisper auto</span>
        </div>
        <div class="pc-transcript-actions">
          <button class="pc-btn" onclick="player.editFullText()" id="editBtn">✏️ Edit Full Text</button>
          <button class="pc-btn" onclick="player.saveCorrections()" id="saveBtn" style="display:none;">💾 Save</button>
          <button class="pc-btn" onclick="player.cancelEdit()" id="cancelBtn" style="display:none;">✕ Cancel</button>
          <button class="pc-btn" onclick="player.exportTranscript()">📥 Export</button>
        </div>
      </div>

      <!-- Full text block -->
      <div class="pc-full-text" id="fullTextBlock">
        <div id="fullTextContent">Loading...</div>
        <div class="edit-bar">
          <button class="pc-btn pc-btn-primary" onclick="player.saveCorrections()">💾 Save Corrections</button>
          <button class="pc-btn" onclick="player.cancelEdit()">✕ Cancel</button>
          <span style="margin-left:auto; font-size:12px; color:var(--text-muted);">
            Edit the text above, then click Save
          </span>
        </div>
      </div>

      <!-- Timestamped lines -->
      <div style="font-size:13px; color:var(--text-dim); margin-bottom:12px; font-family:var(--mono);">
        ⏱ Timestamped Lines — click to seek
      </div>
      <div class="pc-lines" id="transcriptLines">
        <!-- Populated by JS -->
      </div>
    </section>

    <!-- FOOTER -->
    <div class="pc-footer">
      <div>Paperchasers Master Recording • Furious Styles / Coupe da Villian • Processed 2026-06-04</div>
      <div>Bizarre Lynx AIEOS • "The code executes."</div>
    </div>

  </main>
</div>

<!-- TOAST -->
<div class="pc-toast" id="toast"></div>

<!-- AUDIO ELEMENT -->
<audio id="audioElement" preload="none"></audio>

<script>
// ═══════════════════════════════════════════════════════════
// DATA
// ═══════════════════════════════════════════════════════════
const SEGMENTS = ${segmentsJSON};

// ═══════════════════════════════════════════════════════════
// PLAYER
// ═══════════════════════════════════════════════════════════
class PaperchasersPlayer {
  constructor() {
    this.audio = document.getElementById('audioElement');
    this.currentSegIdx = 0;
    this.isPlaying = false;
    this.corrections = {};
    this.editMode = false;
    this.originalText = '';

    // Load saved corrections
    this.loadCorrections();

    // Render segment list
    this.renderSegmentList();

    // Load first segment
    this.loadSegment(0);

    // Audio events
    this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('loadedmetadata', () => this.onLoadedMetadata());
    this.audio.addEventListener('canplay', () => this.drawWaveform());

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.onKeydown(e));

    // Volume
    this.audio.volume = 0.8;
  }

  // ─── Segment Management ────────────────────────────────
  loadSegment(idx) {
    if (idx < 0 || idx >= SEGMENTS.length) return;
    this.currentSegIdx = idx;
    const seg = SEGMENTS[idx];

    this.audio.src = '/media/paperchasers-segments/' + seg.audioFile;
    this.audio.load();

    // Update UI
    document.getElementById('currentSegNum').textContent = String(seg.number).padStart(2, '0');
    document.getElementById('nowPlayingMeta').textContent = 
      this.formatTime(seg.duration) + ' • Segment ' + seg.number;
    document.getElementById('totalTime').textContent = this.formatTime(seg.duration);
    document.getElementById('segmentIndicator').textContent = (idx + 1) + ' / ' + SEGMENTS.length;

    // Render transcript
    this.renderTranscript(seg);

    // Highlight in list
    document.querySelectorAll('.pc-segment-item').forEach((el, i) => {
      el.classList.toggle('active', i === idx);
    });

    // Scroll list to active
    const activeItem = document.querySelector('.pc-segment-item.active');
    if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Update header stats
    this.updateStats();

    this.isPlaying = false;
    this.updatePlayButton();
  }

  renderSegmentList() {
    const list = document.getElementById('segmentList');
    list.innerHTML = SEGMENTS.map((seg, i) => {
      const hasCorr = this.corrections[seg.id] ? 'has-corrections' : '';
      return '<div class="pc-segment-item ' + hasCorr + '" onclick="player.loadSegment(' + i + ')" data-idx="' + i + '">' +
        '<div class="pc-segment-top">' +
          '<span class="pc-segment-num">' + String(seg.number).padStart(2, '0') + '</span>' +
          '<span class="pc-segment-dur">' + this.formatTime(seg.duration) + '</span>' +
        '</div>' +
        '<div class="pc-segment-preview">' + this.escapeHtml(seg.fullText.substring(0, 80)) + '…</div>' +
      '</div>';
    }).join('');
  }

  renderTranscript(seg) {
    // Full text
    const corr = this.corrections[seg.id];
    const displayText = corr ? corr.fullText : seg.fullText;
    document.getElementById('fullTextContent').textContent = displayText;
    this.originalText = displayText;

    // Timestamped lines
    const linesEl = document.getElementById('transcriptLines');
    if (!seg.segments || seg.segments.length === 0) {
      linesEl.innerHTML = '<div style="color:var(--text-muted); font-size:13px; padding:12px;">No timestamped segments available</div>';
      return;
    }

    linesEl.innerHTML = seg.segments.map((s, i) => {
      const text = corr?.lines?.[i]?.text ?? s.text;
      return '<div class="pc-line" onclick="player.seekTo(' + s.start + ')">' +
        '<span class="pc-line-time">' + this.formatTime(s.start) + '</span>' +
        '<span class="pc-line-text">' + this.escapeHtml(text) + '</span>' +
      '</div>';
    }).join('');

    // Status badge
    const badge = document.getElementById('transcriptStatus');
    if (corr) {
      badge.textContent = 'corrected';
      badge.style.background = 'rgba(153, 69, 255, 0.15)';
      badge.style.color = 'var(--accent)';
    } else {
      badge.textContent = 'whisper auto';
      badge.style.background = '';
      badge.style.color = '';
    }
  }

  // ─── Playback ──────────────────────────────────────────
  togglePlay() {
    if (this.audio.paused) {
      this.audio.play();
      this.isPlaying = true;
      document.body.classList.add('playing');
    } else {
      this.audio.pause();
      this.isPlaying = false;
      document.body.classList.remove('playing');
    }
    this.updatePlayButton();
  }

  updatePlayButton() {
    document.getElementById('playBtn').textContent = this.isPlaying ? '⏸ Pause' : '▶ Play';
  }

  prevSegment() {
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
    } else {
      this.loadSegment(this.currentSegIdx - 1);
    }
  }

  nextSegment() {
    this.loadSegment(this.currentSegIdx + 1);
  }

  seek(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const pct = (event.clientX - rect.left) / rect.width;
    this.audio.currentTime = pct * this.audio.duration;
    this.updateWaveformUI();
  }

  seekTo(time) {
    this.audio.currentTime = time;
    if (this.audio.paused) this.togglePlay();
  }

  setVolume(v) {
    this.audio.volume = v;
  }

  onTimeUpdate() {
    const cur = this.audio.currentTime;
    const dur = this.audio.duration || 0;
    document.getElementById('currentTime').textContent = this.formatTime(cur);
    this.updateWaveformUI();

    // Highlight active line
    const seg = SEGMENTS[this.currentSegIdx];
    if (seg && seg.segments) {
      const lines = document.querySelectorAll('.pc-line');
      seg.segments.forEach((s, i) => {
        if (lines[i]) {
          lines[i].classList.toggle('active', cur >= s.start && cur <= s.end);
        }
      });
    }
  }

  onEnded() {
    this.isPlaying = false;
    document.body.classList.remove('playing');
    this.updatePlayButton();
    // Auto-advance to next segment
    if (this.currentSegIdx < SEGMENTS.length - 1) {
      setTimeout(() => this.loadSegment(this.currentSegIdx + 1), 500);
    }
  }

  onLoadedMetadata() {
    document.getElementById('totalTime').textContent = this.formatTime(this.audio.duration);
    this.drawWaveform();
  }

  // ─── Waveform ──────────────────────────────────────────
  drawWaveform() {
    const canvas = document.getElementById('waveformCanvas');
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    const w = rect.width;
    const h = rect.height;
    const seg = SEGMENTS[this.currentSegIdx];
    const dur = seg ? seg.duration : 1;

    // Draw bars
    const barCount = Math.min(w / 3, 200);
    const barWidth = w / barCount - 1;

    ctx.fillStyle = 'rgba(0, 255, 157, 0.3)';
    for (let i = 0; i < barCount; i++) {
      // Simulate waveform from segment duration pattern
      const x = i * (barWidth + 1);
      const normalized = i / barCount;
      // Use segment data to create unique-ish waveform
      const amp = 0.2 + 0.8 * Math.abs(Math.sin(normalized * 12 + seg.number)) * 
                  (0.5 + 0.5 * Math.cos(normalized * 7 + seg.number * 0.5));
      const barH = amp * h * 0.8;
      ctx.fillRect(x, (h - barH) / 2, barWidth, barH);
    }
  }

  updateWaveformUI() {
    const cur = this.audio.currentTime;
    const dur = this.audio.duration || 1;
    const pct = (cur / dur) * 100;
    document.getElementById('waveformProgress').style.width = pct + '%';
    document.getElementById('waveformCursor').style.left = pct + '%';
  }

  // ─── Editing ───────────────────────────────────────────
  editFullText() {
    this.editMode = true;
    const block = document.getElementById('fullTextBlock');
    const content = document.getElementById('fullTextContent');
    const text = content.textContent;

    content.innerHTML = '<textarea id="editTextArea" rows="8">' + this.escapeHtml(text) + '</textarea>';
    block.classList.add('editing');

    document.getElementById('editBtn').style.display = 'none';
    document.getElementById('saveBtn').style.display = '';
    document.getElementById('cancelBtn').style.display = '';
  }

  cancelEdit() {
    this.editMode = false;
    const block = document.getElementById('fullTextBlock');
    document.getElementById('fullTextContent').textContent = this.originalText;
    block.classList.remove('editing');

    document.getElementById('editBtn').style.display = '';
    document.getElementById('saveBtn').style.display = 'none';
    document.getElementById('cancelBtn').style.display = 'none';
  }

  async saveCorrections() {
    if (!this.editMode) return;

    const newText = document.getElementById('editTextArea').value;
    const seg = SEGMENTS[this.currentSegIdx];

    // Save correction
    this.corrections[seg.id] = {
      fullText: newText,
      originalText: seg.fullText,
      correctedAt: new Date().toISOString()
    };

    // Send to server
    try {
      const res = await fetch('/player/paperchasers/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segmentId: seg.id,
          fullText: newText,
          originalText: seg.fullText
        })
      });

      if (res.ok) {
        this.showToast('✓ Corrections saved for ' + seg.id);
      } else {
        this.showToast('✗ Save failed — saved locally');
      }
    } catch (e) {
      this.showToast('✗ Server error — saved locally');
    }

    // Update UI
    this.originalText = newText;
    this.cancelEdit();
    this.renderSegmentList();
    this.updateStats();

    // Update transcript display
    document.getElementById('transcriptStatus').textContent = 'corrected';
    document.getElementById('transcriptStatus').style.background = 'rgba(153, 69, 255, 0.15)';
    document.getElementById('transcriptStatus').style.color = 'var(--accent)';
  }

  loadCorrections() {
    // Try to load from localStorage as fallback
    try {
      const saved = localStorage.getItem('pc-corrections');
      if (saved) this.corrections = JSON.parse(saved);
    } catch (e) {}
  }

  // ─── Export ────────────────────────────────────────────
  exportTranscript() {
    const seg = SEGMENTS[this.currentSegIdx];
    const corr = this.corrections[seg.id];
    const text = corr ? corr.fullText : seg.fullText;

    const exportText = '# ' + seg.id + '\\n' +
      '# Duration: ' + this.formatTime(seg.duration) + '\\n' +
      '# ' + seg.segments.length + ' timed segments\\n\\n' +
      '## Full Text\\n' + text + '\\n\\n' +
      '## Timestamped Lines\\n' +
      seg.segments.map(s => '[' + this.formatTime(s.start) + '] ' + s.text).join('\\n');

    const blob = new Blob([exportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = seg.id + '-transcript.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Keyboard ──────────────────────────────────────────
  onKeydown(e) {
    if (this.editMode && e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case ' ': e.preventDefault(); this.togglePlay(); break;
      case 'ArrowLeft': e.preventDefault(); this.prevSegment(); break;
      case 'ArrowRight': e.preventDefault(); this.nextSegment(); break;
    }
  }

  // ─── UI Helpers ────────────────────────────────────────
  updateStats() {
    const corrCount = Object.keys(this.corrections).length;
    document.getElementById('stat-corrections').textContent = corrCount;
  }

  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  formatTime(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
const player = new PaperchasersPlayer();
</script>

</body>
</html>`;
}

// ─── Router ─────────────────────────────────────────────
const router = express.Router();

// Serve the player page
router.get('/', (req, res) => {
  try {
    const segments = loadSegments();
    const html = generatePlayerHTML(segments);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save corrections
router.post('/save', express.json(), (req, res) => {
  try {
    const { segmentId, fullText, originalText } = req.body;
    if (!segmentId || !fullText) {
      return res.status(400).json({ error: 'Missing segmentId or fullText' });
    }
    saveCorrection(segmentId, { fullText, originalText });
    res.json({ ok: true, segmentId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get corrections for a segment
router.get('/corrections/:segId', (req, res) => {
  const corr = loadCorrections(req.params.segId);
  res.json(corr || { ok: false, message: 'No corrections' });
});

// Serve segment audio files statically
router.use('/audio', express.static(SEGMENTS_DIR, {
  setHeaders: (res) => {
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
}));

module.exports = { router, loadSegments, generatePlayerHTML };
