// Morning Paint v0.5.1
// jfk | Infinite canvas painting journal. Morning pages, but with brushes.

import { useState, useRef, useCallback, useEffect } from 'react'

// ─── TOKENS (Apple-minimal) ───
const C = {
  bg: '#F5F5F7',
  canvas: '#FFFFFF',
  text: '#1D1D1F',
  dim: '#86868B',
  accent: '#0071E3',
  toolbar: 'rgba(255,255,255,0.72)',
  paletteBg: 'rgba(30,30,30,0.88)',
  paletteBorder: 'rgba(255,255,255,0.08)',
  active: 'rgba(0,113,227,0.10)',
  sep: 'rgba(0,0,0,0.06)',
}
const SYS = "system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', sans-serif"
const MONO = "'SF Mono', 'Menlo', 'Courier New', monospace"

// ─── PRESSURE CURVE ───
// Non-linear mapping: soft start, fast ramp mid-range, plateau at top
// Tuned for Apple Pencil (4096 levels) natural hand dynamics
const PRESSURE_CURVE = [
  { in: 0.0, out: 0.0 },
  { in: 0.1, out: 0.2 },
  { in: 0.3, out: 0.42 },
  { in: 0.5, out: 0.62 },
  { in: 0.75, out: 0.86 },
  { in: 1.0, out: 1.0 },
]

function mapPressure(raw) {
  for (let i = 0; i < PRESSURE_CURVE.length - 1; i++) {
    const a = PRESSURE_CURVE[i]
    const b = PRESSURE_CURVE[i + 1]
    if (raw >= a.in && raw <= b.in) {
      const t = (raw - a.in) / (b.in - a.in)
      return a.out + t * (b.out - a.out)
    }
  }
  return raw
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

// ─── KUBELKA-MUNK COLOR MIXING ───
// Realistic pigment mixing: blue + yellow = green (not gray)
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) }
}

function rgbToKS(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255
  return {
    r: (1 - R) * (1 - R) / (2 * R + 0.001),
    g: (1 - G) * (1 - G) / (2 * G + 0.001),
    b: (1 - B) * (1 - B) / (2 * B + 0.001),
  }
}

function ksToRgb(kr, kg, kb) {
  return {
    r: Math.max(0, Math.min(255, (1 + kr - Math.sqrt(kr * kr + 2 * kr)) * 255)),
    g: Math.max(0, Math.min(255, (1 + kg - Math.sqrt(kg * kg + 2 * kg)) * 255)),
    b: Math.max(0, Math.min(255, (1 + kb - Math.sqrt(kb * kb + 2 * kb)) * 255)),
  }
}

function mixPigments(c1, c2, ratio) {
  const ks1 = rgbToKS(c1.r, c1.g, c1.b)
  const ks2 = rgbToKS(c2.r, c2.g, c2.b)
  return ksToRgb(
    ks1.r * ratio + ks2.r * (1 - ratio),
    ks1.g * ratio + ks2.g * (1 - ratio),
    ks1.b * ratio + ks2.b * (1 - ratio),
  )
}

// ─── CATMULL-ROM SPLINE ───
// Centripetal variant: smooth curves without loops/cusps
function catmullRomSegment(p0, p1, p2, p3, segments) {
  const result = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const t2 = t * t
    const t3 = t2 * t
    result.push({
      x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      pressure: 0.5 * ((2 * p1.pressure) + (-p0.pressure + p2.pressure) * t + (2 * p0.pressure - 5 * p1.pressure + 4 * p2.pressure - p3.pressure) * t2 + (-p0.pressure + 3 * p1.pressure - 3 * p2.pressure + p3.pressure) * t3),
    })
  }
  return result
}

// ─── PAPER GRAIN TEXTURE ───
// Procedural height map for charcoal/pastel interaction
// Pre-computed Float32Array for fast per-pixel lookup (no getImageData per sample)
const GRAIN_SIZE = 256
let _grainData = null

function getGrainData() {
  if (_grainData) return _grainData
  _grainData = new Float32Array(GRAIN_SIZE * GRAIN_SIZE)
  for (let i = 0; i < GRAIN_SIZE * GRAIN_SIZE; i++) {
    _grainData[i] = Math.random() * 0.4 + 0.3
  }
  return _grainData
}

function sampleGrain(wx, wy) {
  const data = getGrainData()
  const gx = ((Math.floor(wx) % GRAIN_SIZE) + GRAIN_SIZE) % GRAIN_SIZE
  const gy = ((Math.floor(wy) % GRAIN_SIZE) + GRAIN_SIZE) % GRAIN_SIZE
  return data[gy * GRAIN_SIZE + gx]
}

// ─── COLORING PAGE GALLERY ───
const COLORING_PAGES = [
  { id: 'calligraphy-yong', label: 'Yong Grid', cat: 'Calligraphy', src: '/calligraphy/yong-grid.svg', thumb: '永' },
  { id: 'calligraphy-basics', label: 'Basics Grid', cat: 'Calligraphy', src: '/calligraphy/basics-grid.svg', thumb: '書' },
  { id: 'calligraphy-radicals', label: 'Radicals Grid', cat: 'Calligraphy', src: '/calligraphy/radicals-grid.svg', thumb: '一丨' },
  { id: 'mandala-simple-1', label: 'Simple Mandala', cat: 'Mandala', src: '/coloring-pages/mandala-simple-1.jpg' },
  { id: 'mandala-simple-2', label: 'Flower Mandala', cat: 'Mandala', src: '/coloring-pages/mandala-simple-2.jpg' },
  { id: 'mandala-1', label: 'Mandala I', cat: 'Mandala', src: '/coloring-pages/mandala-1.jpg' },
  { id: 'mandala-2', label: 'Mandala II', cat: 'Mandala', src: '/coloring-pages/mandala-2.jpg' },
  { id: 'mandala-3', label: 'Mandala III', cat: 'Mandala', src: '/coloring-pages/mandala-3.jpg' },
  { id: 'mandala-geometric', label: 'Geometric', cat: 'Mandala', src: '/coloring-pages/mandala-geometric.jpg' },
  { id: 'mandala-complex', label: 'Complex', cat: 'Mandala', src: '/coloring-pages/mandala-complex.jpg' },
  { id: 'mayan-chaak', label: 'Chaak', cat: 'Mayan', src: '/coloring-pages/mayan-chaak.jpg' },
  { id: 'mayan-kinich', label: 'Kinich Ahau', cat: 'Mayan', src: '/coloring-pages/mayan-kinich-ahau.jpg' },
  { id: 'mayan-itzamna', label: 'Itzamna', cat: 'Mayan', src: '/coloring-pages/mayan-itzamna.jpg' },
  { id: 'mayan-balam', label: 'Balam', cat: 'Mayan', src: '/coloring-pages/mayan-balam.jpg' },
  { id: 'mayan-ruins', label: 'Ruins', cat: 'Mayan', src: '/coloring-pages/mayan-ruins.jpg' },
  { id: 'glyph-pop', label: 'Pop', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-pop.png' },
  { id: 'glyph-wo', label: "Wo'", cat: 'Glyph', src: '/coloring-pages/mayan-glyph-wo.png' },
  { id: 'glyph-sip', label: 'Sip', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-sip.png' },
  { id: 'glyph-sotz', label: "Sotz'", cat: 'Glyph', src: '/coloring-pages/mayan-glyph-sotz.png' },
  { id: 'glyph-sek', label: 'Sek', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-sek.png' },
  { id: 'glyph-xul', label: 'Xul', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-xul.png' },
  { id: 'glyph-yaxkin', label: "Yaxk'in", cat: 'Glyph', src: '/coloring-pages/mayan-glyph-yaxkin.png' },
  { id: 'glyph-mol', label: 'Mol', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-mol.png' },
  { id: 'glyph-chen', label: "Ch'en", cat: 'Glyph', src: '/coloring-pages/mayan-glyph-chen.png' },
  { id: 'glyph-yax', label: 'Yax', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-yax.png' },
  { id: 'glyph-sak', label: 'Sak', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-sak.png' },
  { id: 'glyph-kej', label: 'Kej', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-kej.png' },
  { id: 'glyph-mak', label: 'Mak', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-mak.png' },
  { id: 'glyph-kankin', label: "K'ank'in", cat: 'Glyph', src: '/coloring-pages/mayan-glyph-kankin.png' },
  { id: 'glyph-muwan', label: 'Muwan', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-muwan.png' },
  { id: 'glyph-pax', label: 'Pax', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-pax.png' },
  { id: 'glyph-kayab', label: "K'ayab", cat: 'Glyph', src: '/coloring-pages/mayan-glyph-kayab.png' },
  { id: 'glyph-kumku', label: "Kumk'u", cat: 'Glyph', src: '/coloring-pages/mayan-glyph-kumku.png' },
  { id: 'glyph-wayeb', label: 'Wayeb', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-wayeb.png' },
  { id: 'glyph-1', label: 'Glyph I', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-1.png' },
  { id: 'glyph-2', label: 'Glyph II', cat: 'Glyph', src: '/coloring-pages/mayan-glyph-2.png' },
  { id: 'mayan-symbol', label: 'Symbol', cat: 'Glyph', src: '/coloring-pages/mayan-symbol.png' },
  { id: 'mayan-numbers', label: 'Numbers 0-19', cat: 'Glyph', src: '/coloring-pages/mayan-numbers.png' },
  { id: 'mayan-hunab-ku', label: 'Hunab Ku', cat: 'Glyph', src: '/coloring-pages/mayan-hunab-ku.png' },
  { id: 'zen-bamboo', label: 'Bamboo', cat: 'Zen', src: '/coloring-pages/zen-bamboo.png' },
  { id: 'zen-peace', label: 'Peace', cat: 'Zen', src: '/coloring-pages/zen-peace.jpg' },
  { id: 'zen-strength', label: 'Strength', cat: 'Zen', src: '/coloring-pages/zen-strength.jpg' },
  { id: 'zen-lotus', label: 'Lotus', cat: 'Zen', src: '/coloring-pages/zen-lotus.png' },
  { id: 'zen-bonsai', label: 'Bonsai', cat: 'Zen', src: '/coloring-pages/zen-bonsai.jpg' },
  { id: 'zen-crane', label: 'Crane', cat: 'Zen', src: '/coloring-pages/zen-crane.jpg' },
  { id: 'zen-great-wave', label: 'Great Wave', cat: 'Zen', src: '/coloring-pages/zen-great-wave.jpg' },
]

// ─── PAPER TEXTURES ───
const PAPERS = [
  { id: 'blank',    label: 'Blank',       bg: '#FFFFFF', grid: null },
  { id: 'dots',     label: 'Dot Grid',    bg: '#FFFFFF', grid: 'dots' },
  { id: 'lines',    label: 'Lined',       bg: '#FFFEF8', grid: 'lines' },
  { id: 'grid',     label: 'Grid',        bg: '#FFFFFF', grid: 'grid' },
  { id: 'warm',     label: 'Warm Cream',  bg: '#FDF8F0', grid: null },
  { id: 'cool',     label: 'Cool Grey',   bg: '#F0F2F5', grid: null },
  { id: 'kraft',    label: 'Kraft',       bg: '#D4C5A9', grid: null },
  { id: 'midnight', label: 'Midnight',    bg: '#1A1A2E', grid: null },
]

// ─── BRUSH DEFINITIONS ───
const BRUSHES = [
  { id: 'felt',         label: 'Felt Tip' },
  { id: 'watercolor',   label: 'Watercolor' },
  { id: 'watercolor2',  label: 'Watercolor V2' },
  { id: 'calligraphy',  label: 'Ink Brush' },
  { id: 'inkwash',      label: 'Ink Wash' },
  { id: 'pastel',       label: 'Soft Pastel' },
  { id: 'charcoal',     label: 'Charcoal' },
  { id: 'oil',          label: 'Oil Paint' },
  { id: 'smudge',       label: 'Smudge' },
  { id: 'eraser',       label: 'Eraser' },
  { id: 'fill',         label: 'Fill' },
]

const BRUSH_ICONS = {
  felt: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  ),
  watercolor: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
    </svg>
  ),
  watercolor2: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
      <circle cx="17.5" cy="17.5" r="2.2" fill="currentColor" stroke="none" opacity="0.6"/>
    </svg>
  ),
  calligraphy: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3c0 0-1 6-2 10s-3 7-3 8c0 .5.5 1 1 1h4c.5 0 1-.5 1-1 0-1-2-4-3-8S12 3 12 3z"/>
      <line x1="8" y1="22" x2="16" y2="22"/>
    </svg>
  ),
  inkwash: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="8" opacity="0.3" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="12" r="5" opacity="0.5" fill="currentColor" stroke="none"/>
      <circle cx="12" cy="12" r="2.5" opacity="0.8" fill="currentColor" stroke="none"/>
    </svg>
  ),
  pastel: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="2" width="8" height="4" rx="1"/>
      <path d="M8 6h8l-2 16H10L8 6z"/>
    </svg>
  ),
  charcoal: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 20l-2 2"/>
      <path d="M7.5 7.5L6 20l10.5-3L7.5 7.5z"/>
      <path d="M7.5 7.5L18 3l-1.5 14"/>
    </svg>
  ),
  oil: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 3H5"/>
      <path d="M12 3v7"/>
      <circle cx="12" cy="14" r="4"/>
      <path d="M12 18v3"/>
    </svg>
  ),
  smudge: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/>
      <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/>
      <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/>
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
    </svg>
  ),
  eraser: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
      <path d="M22 21H7"/>
      <path d="m5 11 9 9"/>
    </svg>
  ),
  fill: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0L19 11z"/>
      <path d="m5 2 5 5"/>
      <path d="M2 13h15"/>
      <path d="M22 20.3c0 .8-.7 1.7-1.5 1.7s-1.5-.9-1.5-1.7c0-.8 1.5-2.8 1.5-2.8s1.5 2 1.5 2.8z"/>
    </svg>
  ),
}

// Curated palette
const PALETTE = [
  '#1D1D1F', '#5C4033', '#8B6914', '#C87A5A', '#E8A07A',
  '#4A6670', '#6B8FA3', '#8EB8C8', '#A8C8B0', '#D4E0C8',
  '#C0392B', '#E67E22', '#F1C40F', '#27AE60', '#2980B9',
  '#8E44AD', '#E8A0B8', '#BDC3C7', '#7F8C8D', '#FFFFFF',
]

const PROMPTS = [
  'What does today feel like?',
  'Paint the first thing that comes to mind.',
  'Where is the tension?',
  'What color is this morning?',
  'Let your hand lead.',
  'Don\u2019t think. Just move.',
  'What would calm look like?',
  'Paint something you can\u2019t say.',
]

// ─── BRUSH ENGINES ───
function strokeFelt(ctx, from, to, color, size, pressure) {
  const w = size * 1.2 * (0.7 + pressure * 0.3)
  const h = size * 0.4 * (0.7 + pressure * 0.3)
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 0.3 + pressure * 0.1
  ctx.fillStyle = color
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const angle = Math.atan2(dy, dx)
  const steps = Math.max(Math.floor(dist / 2), 1)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = from.x + dx * t
    const y = from.y + dy * t
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle + Math.PI / 6)
    const r = h * 0.4
    ctx.beginPath()
    ctx.moveTo(-w / 2 + r, -h / 2)
    ctx.lineTo(w / 2 - r, -h / 2)
    ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
    ctx.lineTo(w / 2, h / 2 - r)
    ctx.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2)
    ctx.lineTo(-w / 2 + r, h / 2)
    ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r)
    ctx.lineTo(-w / 2, -h / 2 + r)
    ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
    ctx.fill()
    ctx.restore()
  }
  ctx.restore()
}

// Irregular blob path: organic watercolor puddle shapes
const BLOB_POINTS = 14
function blobPath(ctx, cx, cy, radius) {
  const step = (Math.PI * 2) / BLOB_POINTS
  const pts = []
  for (let i = 0; i < BLOB_POINTS; i++) {
    const a = i * step
    const r = radius * (0.55 + Math.random() * 0.65)
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
  }
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 0; i < BLOB_POINTS; i++) {
    const curr = pts[i]
    const next = pts[(i + 1) % BLOB_POINTS]
    const cpx = (curr.x + next.x) * 0.5 + (Math.random() - 0.5) * radius * 0.4
    const cpy = (curr.y + next.y) * 0.5 + (Math.random() - 0.5) * radius * 0.4
    ctx.quadraticCurveTo(cpx, cpy, next.x, next.y)
  }
  ctx.closePath()
}

function strokeWatercolor(ctx, from, to, color, size, pressure, velocity) {
  ctx.save()
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  const rgb = hexToRgb(color)
  const vel = velocity ?? 1.0

  if (dist < 0.2) { ctx.restore(); return }

  const speedFactor = Math.max(0.6, Math.min(1.0, 1.15 - vel * 0.4))
  const w = size * (0.9 + pressure * 0.5)
  const stepSize = Math.max(size * 0.14, 2.0)
  const steps = Math.max(Math.floor(dist / stepSize), 1)
  const jitter = w * 0.5
  const angle = Math.atan2(dy, dx)
  const perpX = -Math.sin(angle)
  const perpY = Math.cos(angle)

  // Buffer mode: paint at elevated alpha; entire stroke composited at ~18% on pen-up
  // This ensures uniform opacity per stroke with predictable darkening on overlap
  ctx.globalCompositeOperation = 'source-over'

  // Wash body: soft radial gradient blobs that fill in to near-solid in the buffer
  const washAlpha = (0.08 + pressure * 0.14) * speedFactor
  ctx.filter = 'blur(1.2px)'
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(1, Math.max(0, (i + (Math.random() - 0.5) * 0.8) / steps))
    const spread = (Math.random() - 0.5) * jitter
    const x = from.x + dx * t + perpX * spread + (Math.random() - 0.5) * jitter * 0.2
    const y = from.y + dy * t + perpY * spread + (Math.random() - 0.5) * jitter * 0.2
    const grain = sampleGrain(x, y)
    const grainMod = 0.85 + grain * 0.4

    const r = w * (0.9 + Math.random() * 0.5)
    const outerR = r * 1.6
    const a = washAlpha * grainMod

    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, outerR)
    g.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`)
    g.addColorStop(0.6, `rgba(${rgb.r},${rgb.g},${rgb.b},${a * 0.55})`)
    g.addColorStop(0.85, `rgba(${rgb.r},${rgb.g},${rgb.b},${a * 0.22})`)
    g.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    blobPath(ctx, x, y, outerR)
    ctx.fill()
  }
  ctx.filter = 'none'

  // Bloom puddles for organic spread
  if (dist > 4) {
    const bloomCount = Math.ceil(dist / (size * 1.1))
    for (let i = 0; i < bloomCount; i++) {
      const t = Math.min(1, Math.max(0, Math.random() + (Math.random() - 0.5) * 0.4))
      const spread = (Math.random() - 0.5) * w * 0.9
      const bx = from.x + dx * t + perpX * spread + (Math.random() - 0.5) * w * 0.25
      const by = from.y + dy * t + perpY * spread + (Math.random() - 0.5) * w * 0.25
      const grain = sampleGrain(bx, by)
      const br = w * (0.8 + Math.random() * 0.8)
      const a = (0.03 + pressure * 0.06) * (0.55 + grain * 0.45) * speedFactor
      const g = ctx.createRadialGradient(bx, by, br * 0.1, bx, by, br)
      g.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`)
      g.addColorStop(0.6, `rgba(${rgb.r},${rgb.g},${rgb.b},${a * 0.35})`)
      g.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      blobPath(ctx, bx, by, br)
      ctx.fill()
    }
  }

  // Edge accent — pigment pooling hint
  const edgeAlpha = (0.006 + pressure * 0.018) * speedFactor
  if (speedFactor > 0.75) {
    for (let i = 0; i <= steps; i += 4) {
      const t = Math.min(1, Math.max(0, (i + (Math.random() - 0.5) * 1.2) / steps))
      const spread = (Math.random() - 0.5) * jitter * 0.6
      const x = from.x + dx * t + perpX * spread + (Math.random() - 0.5) * jitter * 0.2
      const y = from.y + dy * t + perpY * spread + (Math.random() - 0.5) * jitter * 0.2
      const grain = sampleGrain(x, y)

      const r = w * (0.6 + Math.random() * 0.3)
      ctx.globalAlpha = edgeAlpha * (0.4 + grain * 0.9)
      ctx.strokeStyle = color
      ctx.lineWidth = Math.max(w * 0.05, 0.7)
      ctx.beginPath()
      blobPath(ctx, x, y, r)
      ctx.stroke()
    }
  }

  // Pigment granulation in paper valleys
  if (dist > 6 && pressure > 0.35) {
    const darkR = Math.max(0, rgb.r - 25)
    const darkG = Math.max(0, rgb.g - 25)
    const darkB = Math.max(0, rgb.b - 25)
    const spread = w * 0.6
    for (let i = 0; i < Math.ceil(dist / 4); i++) {
      const t = Math.random()
      const px = from.x + dx * t + (Math.random() - 0.5) * spread
      const py = from.y + dy * t + (Math.random() - 0.5) * spread
      const pGrain = sampleGrain(px, py)
      if (pGrain < 0.55) continue
      ctx.globalAlpha = (0.03 + pressure * 0.06) * pGrain * speedFactor
      ctx.fillStyle = `rgb(${darkR},${darkG},${darkB})`
      ctx.beginPath()
      ctx.arc(px, py, 0.4 + Math.random() * size * 0.04, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

// Watercolor wet edge: darken the boundary of a completed stroke
// Real watercolor pools pigment at edges as water evaporates
function paintWetEdge(tiles, path, color, size, opacity) {
  if (path.length < 3) return
  const rgb = hexToRgb(color)
  const edgeAlpha = 0.015
  const edgeWidth = size * 0.1

  // Walk both sides of the stroke path, painting thin dark lines offset from center
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1]
      const curr = path[i]
      const next = path[i + 1]

      const dx = next.x - prev.x
      const dy = next.y - prev.y
      const len = Math.sqrt(dx * dx + dy * dy) || 1
      const nx = -dy / len * side
      const ny = dx / len * side

      const r = size * 0.4 * (0.8 + (curr.pressure || 0.5) * 0.4)
      const ox = nx * (r + edgeWidth * 0.5)
      const oy = ny * (r + edgeWidth * 0.5)

      const from = { x: path[i - 1].x + ox, y: path[i - 1].y + oy }
      const to = { x: curr.x + ox, y: curr.y + oy }

      const pad = size * 3
      const minX = Math.min(from.x, to.x) - pad
      const maxX = Math.max(from.x, to.x) + pad
      const minY = Math.min(from.y, to.y) - pad
      const maxY = Math.max(from.y, to.y) + pad

      const tMinX = Math.floor(minX / TILE_SIZE)
      const tMaxX = Math.floor(maxX / TILE_SIZE)
      const tMinY = Math.floor(minY / TILE_SIZE)
      const tMaxY = Math.floor(maxY / TILE_SIZE)

      const opacityScale = (opacity ?? 100) / 100

      for (let tx = tMinX; tx <= tMaxX; tx++) {
        for (let ty = tMinY; ty <= tMaxY; ty++) {
          const key = `${tx},${ty}`
          const tile = ensureTile(tiles, key)
          const ctx = tile.getContext('2d')
          ctx.save()
          ctx.translate(-tx * TILE_SIZE, -ty * TILE_SIZE)
          if (opacityScale < 1) ctx.globalAlpha = opacityScale

          ctx.globalCompositeOperation = 'source-over'
          ctx.strokeStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},${edgeAlpha})`
          ctx.lineWidth = edgeWidth + Math.random() * edgeWidth * 0.5
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(from.x, from.y)
          ctx.lineTo(to.x, to.y)
          ctx.stroke()

          ctx.restore()
        }
      }
    }
  }
}


// Calligraphy: Zen/Chinese pointed brush
// Directional brush stamp with tapered feel. Width from pressure, velocity thins/elongates.
// Pressure controls both width AND opacity: light = grey wash, heavy = solid black.
// Dry brush = scattered dots at high speed. Ink bleed = rare soft edge dots.
function strokeCalligraphy(ctx, from, to, color, size, pressure, velocity) {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'

  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  // Skip micro-segments; they tend to create bead artifacts with stamped ellipses.
  if (dist < 0.12) { ctx.restore(); return }

  const vel = Math.max(0, Math.min(velocity ?? 0, 1))
  const pr = Math.max(0.0, Math.min(pressure ?? 0.5, 1))

  // Width: pressure is primary driver, velocity thins the stroke
  const velFactor = Math.max(0.35, 1 - vel * 0.6)
  const wBase = size * (0.04 + pr * 0.96)
  const w = Math.max(size * 0.03, wBase * velFactor)
  const minMinor = Math.max(size * 0.06, w * 0.18)

  // Pressure→opacity: light touch = grey wash, full press = solid black
  // Coupled with pressure^0.6 curve so light strokes fade more aggressively
  const pressureAlpha = Math.pow(pr, 0.6)
  const speedAlpha = 1 - vel * 0.25
  ctx.globalAlpha = (0.2 + pressureAlpha * 0.8) * speedAlpha
  ctx.fillStyle = color

  // Directional stamping along the segment for a brush-like footprint
  const angle = Math.atan2(dy, dx)
  const step = Math.max(0.35, w * (0.35 - vel * 0.12))
  const steps = Math.max(1, Math.ceil(dist / step))
  const major = w * (1.1 + vel * 0.55)
  const minor = Math.max(minMinor, w)
  // Start at i=1 so adjacent segments don't double-stamp shared endpoints.
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const px = from.x + dx * t
    const py = from.y + dy * t
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.ellipse(0, 0, major * 0.5, minor * 0.5, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  // Subtle core line to reduce gaps between stamps
  ctx.save()
  ctx.globalAlpha *= 0.15
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(minMinor * 0.6, size * 0.02)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  ctx.restore()

  // Rare ink bleed at edges: slow + heavy strokes only
  if (vel < 0.06 && pr > 0.7 && w > 8 && Math.random() < 0.015) {
    const mx = (from.x + to.x) * 0.5
    const my = (from.y + to.y) * 0.5
    const angle = Math.random() * Math.PI * 2
    const bleedDist = w * 0.5 * (0.9 + Math.random() * 0.3)
    ctx.fillStyle = color
    ctx.globalAlpha = 0.06 + Math.random() * 0.06
    ctx.beginPath()
    ctx.arc(mx + Math.cos(angle) * bleedDist, my + Math.sin(angle) * bleedDist, 0.5 + Math.random() * 1, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

// Ink Wash: sumi-e diffusion brush
// Fat calligraphy-style stroke with soft, feathered edges.
// Pressure controls width + opacity like ink brush, but wider and softer.
// Soft halo around the core stroke gives the wet-ink-on-paper diffusion look.
function strokeInkWash(ctx, from, to, color, size, pressure, velocity) {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'

  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < 0.2) { ctx.restore(); return }

  const vel = velocity ?? 1.0
  const velFactor = Math.max(0.5, 1 - vel / 5000)

  // Monochrome: extract luminance from chosen color
  const rgb = hexToRgb(color)
  const lum = Math.round(rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114)

  // Core width: wider than ink brush, pressure-driven
  const coreW = size * (0.4 + pressure * 0.6) * velFactor * 2.5
  const segDist = dist
  const lineW = Math.max(coreW, segDist * 0.8, size * 0.3)

  // Pressure→opacity for core: softer than ink brush
  const pressureAlpha = Math.pow(pressure, 0.5)
  const coreAlpha = 0.15 + pressureAlpha * 0.55

  // Layer 1: Soft halo (wide, faint stroke underneath for diffusion edge)
  const haloW = lineW * 2.2
  ctx.globalAlpha = coreAlpha * 0.25
  ctx.strokeStyle = `rgb(${lum},${lum},${lum})`
  ctx.lineWidth = haloW
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()

  // Layer 2: Mid halo (tighter, slightly darker)
  ctx.globalAlpha = coreAlpha * 0.4
  ctx.lineWidth = lineW * 1.5
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()

  // Layer 3: Core stroke (solid center, like the ink brush)
  ctx.globalAlpha = coreAlpha
  ctx.lineWidth = lineW
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()

  // Ink granulation along the stroke path (subtle paper texture)
  if (dist > 3 && pressure > 0.25) {
    const spread = lineW * 0.6
    const grainCount = Math.ceil(dist / 4)
    const darkLum = Math.max(0, lum - 25)
    ctx.fillStyle = `rgb(${darkLum},${darkLum},${darkLum})`
    const angle = Math.atan2(dy, dx)
    const perpX = -Math.sin(angle)
    const perpY = Math.cos(angle)
    for (let i = 0; i < grainCount; i++) {
      const t = Math.random()
      const px = from.x + dx * t + perpX * (Math.random() - 0.5) * spread
      const py = from.y + dy * t + perpY * (Math.random() - 0.5) * spread
      const pGrain = sampleGrain(px, py)
      if (pGrain < 0.45) continue
      ctx.globalAlpha = (0.04 + pressure * 0.08) * pGrain
      ctx.beginPath()
      ctx.arc(px, py, 0.3 + Math.random() * size * 0.04, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}

// Charcoal: grainy texture with paper grain interaction
// Catches on peaks, skips valleys (like real charcoal on textured paper)
function strokeCharcoal(ctx, from, to, color, size, pressure) {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = color

  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const angle = Math.atan2(dy, dx)
  const perpX = -Math.sin(angle)
  const perpY = Math.cos(angle)
  const steps = Math.max(Math.floor(dist / 1.5), 1)
  const baseW = size * (0.3 + pressure * 0.7)
  const density = 0.35 + pressure * 0.45
  const grainCount = Math.max(4, Math.floor(baseW * 1.2))
  const pressureThreshold = 0.55 - pressure * 0.35

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const cx = from.x + dx * t
    const cy = from.y + dy * t

    for (let g = 0; g < grainCount; g++) {
      if (Math.random() > density) continue

      const spread = (Math.random() - 0.5) * baseW
      const along = (Math.random() - 0.5) * 3
      const px = cx + perpX * spread + (dx / dist) * along
      const py = cy + perpY * spread + (dy / dist) * along

      // Paper grain: charcoal deposits more on peaks, less in valleys
      const grain = sampleGrain(px, py)
      if (grain < pressureThreshold) continue

      const grainBoost = (grain - pressureThreshold) / (1 - pressureThreshold + 0.01)
      ctx.globalAlpha = (0.18 + Math.random() * 0.32 * pressure) * (0.6 + grainBoost * 0.4)

      const mw = 0.5 + Math.random() * 2.0
      const mh = 0.3 + Math.random() * 1.0
      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(angle + (Math.random() - 0.5) * 1.2)
      ctx.fillRect(-mw, -mh, mw * 2, mh * 2)
      ctx.restore()
    }
  }

  ctx.restore()
}

// Pastel: soft chalk with paper grain interaction
// Light pressure = only peaks catch pigment, heavy = fills valleys too
function strokePastel(ctx, from, to, color, size, pressure) {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const angle = Math.atan2(dy, dx)
  const steps = Math.max(Math.floor(dist / 2), 1)
  const perpX = -Math.sin(angle)
  const perpY = Math.cos(angle)
  const baseW = size * (0.4 + pressure * 0.8)
  const grainThreshold = 0.5 - pressure * 0.35

  ctx.fillStyle = color

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const cx = from.x + dx * t
    const cy = from.y + dy * t

    const marks = Math.floor(baseW * 0.8) + 3
    for (let m = 0; m < marks; m++) {
      const spread = (Math.random() - 0.5) * baseW
      const along = (Math.random() - 0.5) * size * 0.2
      const px = cx + perpX * spread + dx / dist * along
      const py = cy + perpY * spread + dy / dist * along

      if (Math.random() < 0.15) continue

      const grain = sampleGrain(px, py)
      if (grain < grainThreshold) continue

      const grainMod = (grain - grainThreshold) / (1 - grainThreshold + 0.01)
      ctx.globalAlpha = (0.18 + Math.random() * 0.22) * (0.7 + grainMod * 0.3)

      ctx.save()
      ctx.translate(px, py)
      ctx.rotate(angle + (Math.random() - 0.5) * 0.3)
      const markW = 1.5 + Math.random() * 2.5
      const markH = 0.6 + Math.random() * 1.0
      ctx.beginPath()
      ctx.ellipse(0, 0, markW, markH, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  if (dist > 3) {
    ctx.globalAlpha = 0.06
    for (let i = 0; i < 4; i++) {
      const t = Math.random()
      const edgeSide = Math.random() > 0.5 ? 1 : -1
      const edgeDist = baseW * 0.5 + Math.random() * baseW * 0.3
      const px = from.x + dx * t + perpX * edgeSide * edgeDist
      const py = from.y + dy * t + perpY * edgeSide * edgeDist
      ctx.beginPath()
      ctx.arc(px, py, 1 + Math.random() * 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

// Oil: streaky canvas pickup (one sample), bristle furrows, impasto
const OIL_BRISTLE_COUNT = 7

function strokeOil(ctx, from, to, color, size, pressure, velocity, sampleCtx) {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const angle = Math.atan2(dy, dx)
  const perpX = -Math.sin(angle)
  const perpY = Math.cos(angle)
  const vel = Math.min(velocity ?? 0.5, 1.0)
  const steps = Math.max(Math.floor(dist / 1.5), 1)
  const speedThin = 1.0 - vel * 0.25
  const w = size * 1.2 * (0.6 + pressure * 0.5) * speedThin
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
  const baseRgb = hexToRgb(color)
  const loadBase = (0.5 + pressure * 0.4) * (0.6 + (1.0 - vel) * 0.4)

  // Sample from real tiles (sampleCtx) for color pickup, paint to ctx (which may be buffer)
  const readCtx = sampleCtx || ctx
  const sampleR = Math.max(Math.round(w * 0.5), 3)
  const sampleDim = sampleR * 2
  const bristleColors = []
  let bodyRgb = baseRgb
  try {
    const sx = Math.round(from.x - sampleR)
    const sy = Math.round(from.y - sampleR)
    const imgData = readCtx.getImageData(sx, sy, sampleDim, sampleDim)
    const d = imgData.data

    // Each bristle samples at its actual perpendicular offset within the square
    for (let b = 0; b < OIL_BRISTLE_COUNT; b++) {
      const bristlePos = (b / (OIL_BRISTLE_COUNT - 1)) - 0.5
      const bWorldX = from.x + perpX * bristlePos * w * 0.75
      const bWorldY = from.y + perpY * bristlePos * w * 0.75
      const px = Math.max(0, Math.min(sampleDim - 1, Math.round(bWorldX - sx)))
      const py = Math.max(0, Math.min(sampleDim - 1, Math.round(bWorldY - sy)))
      const idx = (py * sampleDim + px) * 4
      if (d[idx + 3] > 10) {
        bristleColors.push({ r: d[idx], g: d[idx + 1], b: d[idx + 2], a: d[idx + 3] })
      } else {
        bristleColors.push(null)
      }
    }

    // Body color from center of square
    const cIdx = (sampleR * sampleDim + sampleR) * 4
    if (d[cIdx + 3] > 10) {
      const existing = { r: d[cIdx], g: d[cIdx + 1], b: d[cIdx + 2] }
      const pickupAmt = Math.min(d[cIdx + 3] / 255, 0.35) * pressure * 0.4
      const mixed = mixPigments(baseRgb, existing, 1.0 - pickupAmt)
      bodyRgb = { r: clamp(mixed.r), g: clamp(mixed.g), b: clamp(mixed.b) }
    }
  } catch (_) {
    for (let b = 0; b < OIL_BRISTLE_COUNT; b++) bristleColors.push(null)
  }

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const cx = from.x + dx * t
    const cy = from.y + dy * t

    // Paint body: opacity varies per step for organic feel
    const bodyAlpha = loadBase * (0.85 + Math.random() * 0.3)
    ctx.globalAlpha = bodyAlpha
    ctx.fillStyle = `rgb(${bodyRgb.r},${bodyRgb.g},${bodyRgb.b})`
    ctx.beginPath()
    ctx.ellipse(cx, cy, w * 0.5, w * 0.32, angle, 0, Math.PI * 2)
    ctx.fill()

    // Bristle tracks: fat streaks across the brush width
    for (let b = 0; b < OIL_BRISTLE_COUNT; b++) {
      // Fast strokes: bristles skip randomly (paint doesn't fill every track)
      if (vel > 0.5 && Math.random() < (vel - 0.5) * 0.5) continue

      const bristlePos = (b / (OIL_BRISTLE_COUNT - 1)) - 0.5
      // Fast strokes splay bristles wider
      const splayMul = 0.75 + vel * 0.25
      const offset = bristlePos * w * splayMul
      const wobble = (Math.random() - 0.5) * w * (0.06 + vel * 0.08)
      const bx = cx + perpX * (offset + wobble)
      const by = cy + perpY * (offset + wobble)

      // More tint variation at speed (less control = more color scatter)
      const tintRange = 15 + vel * 15
      const randRange = 20 + vel * 16
      const tintShift = (b % 3 - 1) * tintRange
      let bColor = {
        r: clamp(baseRgb.r + tintShift + (Math.random() - 0.5) * randRange),
        g: clamp(baseRgb.g + tintShift * 0.7 + (Math.random() - 0.5) * randRange * 0.7),
        b: clamp(baseRgb.b + tintShift * 0.5 + (Math.random() - 0.5) * randRange * 0.7),
      }

      const bs = bristleColors[b]
      if (bs) {
        const pickupAmt = Math.min(bs.a / 255, 0.5) * pressure * 0.45
        const mixed = mixPigments(bColor, bs, 1.0 - pickupAmt)
        bColor = { r: clamp(mixed.r), g: clamp(mixed.g), b: clamp(mixed.b) }
      }

      // Fat bristle streak (the main visible track)
      ctx.globalAlpha = 0.2 + pressure * 0.25 + Math.random() * 0.08
      ctx.fillStyle = `rgb(${bColor.r},${bColor.g},${bColor.b})`
      ctx.beginPath()
      const trackW = w * 0.12 + Math.random() * w * 0.06
      const trackH = w * 0.04 + Math.random() * w * 0.02
      ctx.ellipse(bx, by, trackW, trackH, angle + (Math.random() - 0.5) * 0.15, 0, Math.PI * 2)
      ctx.fill()

      // Thin dark groove between bristle tracks (subtle)
      if (b > 0 && b < OIL_BRISTLE_COUNT - 1 && Math.random() > 0.4) {
        ctx.globalAlpha = 0.025 + pressure * 0.02
        ctx.strokeStyle = `rgb(${clamp(bColor.r * 0.55)},${clamp(bColor.g * 0.55)},${clamp(bColor.b * 0.55)})`
        ctx.lineWidth = 0.6
        ctx.beginPath()
        ctx.moveTo(from.x + perpX * offset, from.y + perpY * offset)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }
    }
  }

  // Impasto: random thick paint blobs, NOT symmetric rails
  if (pressure > 0.35 && dist > 2) {
    const impStr = (pressure - 0.35) / 0.65
    const blobCount = Math.floor(1 + impStr * 3)
    for (let i = 0; i < blobCount; i++) {
      const t = Math.random()
      const bx = from.x + dx * t
      const by = from.y + dy * t
      // Random offset within the brush width, biased toward edges
      const side = (Math.random() - 0.5) * 2
      const edgeBias = side * Math.abs(side)
      const off = edgeBias * w * 0.35
      const px = bx + perpX * off + (Math.random() - 0.5) * w * 0.1
      const py = by + perpY * off + (Math.random() - 0.5) * w * 0.1

      // Light catch: slight tint toward white, not pure white
      const liftR = clamp(bodyRgb.r + (255 - bodyRgb.r) * (0.25 + Math.random() * 0.2))
      const liftG = clamp(bodyRgb.g + (255 - bodyRgb.g) * (0.25 + Math.random() * 0.2))
      const liftB = clamp(bodyRgb.b + (255 - bodyRgb.b) * (0.25 + Math.random() * 0.2))
      ctx.globalAlpha = 0.03 + impStr * 0.06 * Math.random()
      ctx.fillStyle = `rgb(${liftR},${liftG},${liftB})`
      ctx.beginPath()
      const blobW = w * (0.06 + Math.random() * 0.12)
      const blobH = w * (0.02 + Math.random() * 0.04)
      ctx.ellipse(px, py, blobW, blobH, angle + (Math.random() - 0.5) * 0.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Edge texture: sparse paint fragments at outer edge
  if (dist > 3 && Math.random() > 0.3) {
    const edgeSide = Math.random() > 0.5 ? 1 : -1
    const t = Math.random()
    const edgeDist = w * 0.38 + Math.random() * w * 0.18
    const px = from.x + dx * t + perpX * edgeSide * edgeDist
    const py = from.y + dy * t + perpY * edgeSide * edgeDist
    const grain = sampleGrain(px, py)
    if (grain > 0.4) {
      ctx.globalAlpha = 0.06 * grain * pressure
      ctx.fillStyle = `rgb(${bodyRgb.r},${bodyRgb.g},${bodyRgb.b})`
      ctx.beginPath()
      ctx.ellipse(px, py, 1.5 + Math.random() * 2, 0.5 + Math.random(), angle, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}

// Smudge: pick up existing canvas color and push it in stroke direction
function strokeSmudge(ctx, from, to, _color, size, pressure) {
  ctx.save()
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const r = size * 0.6 * (0.5 + pressure * 0.5)

  if (dist < 0.3) { ctx.restore(); return }

  // Sample a small area at the source (from) position
  const sampleR = Math.max(Math.round(r * 0.8), 2)
  let sr = 0, sg = 0, sb = 0, sa = 0, count = 0
  try {
    const imgData = ctx.getImageData(
      Math.round(from.x - sampleR), Math.round(from.y - sampleR),
      sampleR * 2, sampleR * 2
    )
    const d = imgData.data
    // Sample in a circular region
    for (let py = 0; py < sampleR * 2; py++) {
      for (let px = 0; px < sampleR * 2; px++) {
        const ddx = px - sampleR
        const ddy = py - sampleR
        if (ddx * ddx + ddy * ddy > sampleR * sampleR) continue
        const idx = (py * sampleR * 2 + px) * 4
        if (d[idx + 3] < 5) continue
        sr += d[idx]
        sg += d[idx + 1]
        sb += d[idx + 2]
        sa += d[idx + 3]
        count++
      }
    }
  } catch (_) { ctx.restore(); return }

  if (count < 3 || sa / count < 10) { ctx.restore(); return }

  sr = Math.round(sr / count)
  sg = Math.round(sg / count)
  sb = Math.round(sb / count)
  const avgAlpha = sa / count / 255

  // Paint the sampled color forward along the stroke with falloff
  ctx.globalCompositeOperation = 'source-over'
  const steps = Math.max(Math.floor(dist / 1.5), 1)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const falloff = 1.0 - t * 0.4
    const x = from.x + dx * t
    const y = from.y + dy * t

    ctx.globalAlpha = (0.25 + pressure * 0.35) * avgAlpha * falloff
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(${sr},${sg},${sb},1)`)
    grad.addColorStop(0.6, `rgba(${sr},${sg},${sb},0.6)`)
    grad.addColorStop(1, `rgba(${sr},${sg},${sb},0)`)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // Soften the source area slightly (partial erase to simulate paint being picked up)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.globalAlpha = 0.03 + pressure * 0.04
  const srcGrad = ctx.createRadialGradient(from.x, from.y, 0, from.x, from.y, r * 0.8)
  srcGrad.addColorStop(0, 'rgba(0,0,0,1)')
  srcGrad.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = srcGrad
  ctx.beginPath()
  ctx.arc(from.x, from.y, r * 0.8, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

function strokeEraser(ctx, from, to, _color, size, pressure) {
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.globalAlpha = 0.8 + pressure * 0.2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const steps = Math.max(Math.floor(dist / 2), 1)
  const r = size * 0.7

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = from.x + dx * t
    const y = from.y + dy * t
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

const STROKE_FN = {
  felt: strokeFelt,
  watercolor: strokeWatercolor,
  watercolor2: strokeWatercolor,
  calligraphy: strokeCalligraphy,
  inkwash: strokeInkWash,
  pastel: strokePastel,
  charcoal: strokeCharcoal,
  oil: strokeOil,
  smudge: strokeSmudge,
  eraser: strokeEraser,
}

// ─── FLOOD FILL (scanline, tile-aware, zero-alloc visited) ───
const FILL_COLOR_TOLERANCE = 60 // Base Euclidean RGB tolerance
const FILL_ALPHA_WEIGHT = 0.15  // reduce alpha banding in soft washes
const FILL_TRANSPARENT_ALPHA = 24
const FILL_TRANSPARENT_TOLERANCE_MULT = 2.2
const FILL_MAX_PIXELS = 800000  // hard cap to stay responsive

function floodFill(tiles, startX, startY, fillColor, opacityPct, tileSize) {
  const sx = Math.round(startX)
  const sy = Math.round(startY)

  // Parse fill color
  const fr = parseInt(fillColor.slice(1, 3), 16)
  const fg = parseInt(fillColor.slice(3, 5), 16)
  const fb = parseInt(fillColor.slice(5, 7), 16)
  const fa = Math.round((opacityPct / 100) * 255)

  // Tile imageData cache — lazy load, batch flush at end
  const cache = new Map()
  function tileData(wx, wy) {
    const tx = Math.floor(wx / tileSize)
    const ty = Math.floor(wy / tileSize)
    const key = `${tx},${ty}`
    let entry = cache.get(key)
    if (!entry) {
      const tile = ensureTile(tiles, key)
      const ctx = tile.getContext('2d')
      const id = ctx.getImageData(0, 0, tileSize, tileSize)
      entry = { ctx, data: id.data, id, ox: tx * tileSize, oy: ty * tileSize }
      cache.set(key, entry)
    }
    return entry
  }

  // Inline pixel index into a tile's data array
  function idx(entry, wx, wy) {
    return ((wy - entry.oy) * tileSize + (wx - entry.ox)) * 4
  }

  // Read seed color (3x3 average to reduce grain/banding)
  let sr = 0, sg = 0, sb = 0, sa = 0, sc = 0
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const e = tileData(sx + ox, sy + oy)
      const i = idx(e, sx + ox, sy + oy)
      sr += e.data[i]
      sg += e.data[i + 1]
      sb += e.data[i + 2]
      sa += e.data[i + 3]
      sc++
    }
  }
  sr = Math.round(sr / sc)
  sg = Math.round(sg / sc)
  sb = Math.round(sb / sc)
  sa = Math.round(sa / sc)

  const transparency = 1 - (sa / 255)
  const tol = FILL_COLOR_TOLERANCE * (1 + transparency * (FILL_TRANSPARENT_TOLERANCE_MULT - 1))
  const colorTolSq = tol * tol

  const seedAlphaNorm = sa / 255
  const srP = sr * seedAlphaNorm
  const sgP = sg * seedAlphaNorm
  const sbP = sb * seedAlphaNorm

  // Don't fill if seed is already the fill color
  {
    const dr = sr - fr
    const dg = sg - fg
    const db = sb - fb
    const da = sa - fa
    const dist = dr * dr + dg * dg + db * db + da * da * FILL_ALPHA_WEIGHT
    if (dist <= colorTolSq) return
  }

  // Match check — inline for speed (no array alloc)
  function match(wx, wy) {
    const e = tileData(wx, wy)
    const i = idx(e, wx, wy)
    const dr = e.data[i] - sr
    const dg = e.data[i + 1] - sg
    const db = e.data[i + 2] - sb
    const a = e.data[i + 3] / 255
    const pr = e.data[i] * a
    const pg = e.data[i + 1] * a
    const pb = e.data[i + 2] * a
    const pdr = pr - srP
    const pdg = pg - sgP
    const pdb = pb - sbP
    const colorDist = pdr * pdr + pdg * pdg + pdb * pdb
    if (sa < 8) {
      return e.data[i + 3] < FILL_TRANSPARENT_ALPHA && colorDist <= colorTolSq
    }
    const da = e.data[i + 3] - sa
    return (colorDist + da * da * FILL_ALPHA_WEIGHT) <= colorTolSq
  }

  // Write pixel — also serves as "visited" marker (pixel no longer matches seed)
  function paint(wx, wy) {
    const e = tileData(wx, wy)
    const i = idx(e, wx, wy)
    e.data[i] = fr; e.data[i + 1] = fg; e.data[i + 2] = fb; e.data[i + 3] = fa
  }

  const MAX_SPAN = 2000
  const minX = sx - MAX_SPAN, maxX = sx + MAX_SPAN
  const minY = sy - MAX_SPAN, maxY = sy + MAX_SPAN

  // Scanline stack: [x, y] pairs stored flat for speed
  const stack = new Int32Array(FILL_MAX_PIXELS * 2)
  stack[0] = sx; stack[1] = sy
  let sp = 2  // stack pointer
  let filled = 0

  // Seed must match
  if (!match(sx, sy)) return

  paint(sx, sy)
  filled++

  while (sp > 0 && filled < FILL_MAX_PIXELS) {
    sp -= 2
    const x = stack[sp], y = stack[sp + 1]

    // Scan left
    let left = x
    while (left - 1 >= minX && match(left - 1, y)) { left--; paint(left, y); filled++ }

    // Scan right
    let right = x
    while (right + 1 <= maxX && match(right + 1, y)) { right++; paint(right, y); filled++ }

    // Check rows above and below — push one seed per contiguous span
    for (const ny of [y - 1, y + 1]) {
      if (ny < minY || ny > maxY) continue
      let inSpan = false
      for (let cx = left; cx <= right; cx++) {
        if (match(cx, ny)) {
          if (!inSpan) {
            if (sp + 2 > stack.length || filled >= FILL_MAX_PIXELS) break
            stack[sp] = cx; stack[sp + 1] = ny; sp += 2
            inSpan = true
          }
        } else { inSpan = false }
      }
    }
  }

  // Flush
  cache.forEach(({ ctx, id }) => ctx.putImageData(id, 0, 0))
}

// ─── WATERCOLOR V2 (per-stroke low-res sim) ───
function ensureWc2Tile(simTiles, tx, ty) {
  const key = `${tx},${ty}`
  let tile = simTiles.get(key)
  if (!tile) {
    const w = WC2_TILE_SIZE
    const h = WC2_TILE_SIZE
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    const imageData = ctx.createImageData(w, h)
    tile = {
      tx, ty, key, w, h,
      water: new Float32Array(w * h),
      pigment: new Float32Array(w * h),
      water2: new Float32Array(w * h),
      pigment2: new Float32Array(w * h),
      canvas,
      ctx,
      imageData,
    }
    simTiles.set(key, tile)
  }
  return tile
}

function depositWatercolorSim(simTiles, from, to, size, pressure, velocity) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy) || 1
  const vel = Math.max(0, Math.min(velocity ?? 0, 1))
  const pr = Math.max(0.05, Math.min(pressure ?? 0.5, 1))

  const step = Math.max(size * 0.35, 4)
  const steps = Math.max(1, Math.ceil(dist / step))
  const radius = Math.max(1, size * (0.55 + pr * 0.75) * WC2_SCALE)
  const r2 = radius * radius
  const waterAmt = (0.08 + pr * 0.18) * (1 - vel * 0.5)
  const pigmentAmt = (0.06 + pr * 0.22) * (1 - vel * 0.4)

  const touched = new Set()
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const wx = from.x + dx * t
    const wy = from.y + dy * t
    const grain = sampleGrain(wx, wy)
    const grainMod = 0.75 + grain * 0.5

    const sx = Math.floor(wx * WC2_SCALE)
    const sy = Math.floor(wy * WC2_SCALE)
    const r = Math.ceil(radius)
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const d2 = ox * ox + oy * oy
        if (d2 > r2) continue
        const fall = 1 - Math.sqrt(d2) / radius
        const gx = sx + ox
        const gy = sy + oy
        const tx = Math.floor(gx / WC2_TILE_SIZE)
        const ty = Math.floor(gy / WC2_TILE_SIZE)
        const tile = ensureWc2Tile(simTiles, tx, ty)
        const lx = gx - tx * WC2_TILE_SIZE
        const ly = gy - ty * WC2_TILE_SIZE
        if (lx < 0 || lx >= tile.w || ly < 0 || ly >= tile.h) continue
        const idx = ly * tile.w + lx
        const wAdd = fall * waterAmt * grainMod
        const pAdd = fall * pigmentAmt * grainMod
        tile.water[idx] = Math.min(1, tile.water[idx] + wAdd)
        tile.pigment[idx] = Math.min(1, tile.pigment[idx] + pAdd)
        touched.add(tile.key)
      }
    }
  }
  return touched
}

function sampleSimField(simTiles, tx, ty, x, y, field) {
  let ntx = tx
  let nty = ty
  if (x < 0) { ntx = tx - 1; x += WC2_TILE_SIZE }
  else if (x >= WC2_TILE_SIZE) { ntx = tx + 1; x -= WC2_TILE_SIZE }
  if (y < 0) { nty = ty - 1; y += WC2_TILE_SIZE }
  else if (y >= WC2_TILE_SIZE) { nty = ty + 1; y -= WC2_TILE_SIZE }
  const nt = simTiles.get(`${ntx},${nty}`)
  if (!nt) return 0
  return nt[field][y * nt.w + x]
}

function stepWatercolorSim(simTiles, steps) {
  for (let s = 0; s < steps; s++) {
    simTiles.forEach((tile) => {
      const { w, h, tx, ty, water, pigment, water2, pigment2 } = tile
      const lastX = w - 1
      const lastY = h - 1

      // Interior
      for (let y = 1; y < lastY; y++) {
        let idx = y * w + 1
        for (let x = 1; x < lastX; x++, idx++) {
          const cW = water[idx]
          const cP = pigment[idx]
          const nW = water[idx - w]
          const sW = water[idx + w]
          const eW = water[idx + 1]
          const wW = water[idx - 1]
          const lapW = nW + sW + eW + wW - 4 * cW
          let nw = cW + WC2_WATER_DIFFUSE * lapW - WC2_EVAPORATION * cW
          if (nw < 0) nw = 0

          const nP = pigment[idx - w]
          const sP = pigment[idx + w]
          const eP = pigment[idx + 1]
          const wP = pigment[idx - 1]
          const lapP = nP + sP + eP + wP - 4 * cP
          let np = cP + WC2_PIGMENT_DIFFUSE * lapP
          if (np < 0) np = 0

          water2[idx] = nw
          pigment2[idx] = np
        }
      }

      // Edges
      for (let x = 0; x < w; x++) {
        for (const y of [0, lastY]) {
          const idx = y * w + x
          const cW = water[idx]
          const cP = pigment[idx]
          const nW = sampleSimField(simTiles, tx, ty, x, y - 1, 'water')
          const sW = sampleSimField(simTiles, tx, ty, x, y + 1, 'water')
          const eW = sampleSimField(simTiles, tx, ty, x + 1, y, 'water')
          const wW = sampleSimField(simTiles, tx, ty, x - 1, y, 'water')
          const lapW = nW + sW + eW + wW - 4 * cW
          let nw = cW + WC2_WATER_DIFFUSE * lapW - WC2_EVAPORATION * cW
          if (nw < 0) nw = 0

          const nP = sampleSimField(simTiles, tx, ty, x, y - 1, 'pigment')
          const sP = sampleSimField(simTiles, tx, ty, x, y + 1, 'pigment')
          const eP = sampleSimField(simTiles, tx, ty, x + 1, y, 'pigment')
          const wP = sampleSimField(simTiles, tx, ty, x - 1, y, 'pigment')
          const lapP = nP + sP + eP + wP - 4 * cP
          let np = cP + WC2_PIGMENT_DIFFUSE * lapP
          if (np < 0) np = 0

          water2[idx] = nw
          pigment2[idx] = np
        }
      }

      for (let y = 1; y < lastY; y++) {
        for (const x of [0, lastX]) {
          const idx = y * w + x
          const cW = water[idx]
          const cP = pigment[idx]
          const nW = sampleSimField(simTiles, tx, ty, x, y - 1, 'water')
          const sW = sampleSimField(simTiles, tx, ty, x, y + 1, 'water')
          const eW = sampleSimField(simTiles, tx, ty, x + 1, y, 'water')
          const wW = sampleSimField(simTiles, tx, ty, x - 1, y, 'water')
          const lapW = nW + sW + eW + wW - 4 * cW
          let nw = cW + WC2_WATER_DIFFUSE * lapW - WC2_EVAPORATION * cW
          if (nw < 0) nw = 0

          const nP = sampleSimField(simTiles, tx, ty, x, y - 1, 'pigment')
          const sP = sampleSimField(simTiles, tx, ty, x, y + 1, 'pigment')
          const eP = sampleSimField(simTiles, tx, ty, x + 1, y, 'pigment')
          const wP = sampleSimField(simTiles, tx, ty, x - 1, y, 'pigment')
          const lapP = nP + sP + eP + wP - 4 * cP
          let np = cP + WC2_PIGMENT_DIFFUSE * lapP
          if (np < 0) np = 0

          water2[idx] = nw
          pigment2[idx] = np
        }
      }
    })

    simTiles.forEach((tile) => {
      const tmpW = tile.water
      tile.water = tile.water2
      tile.water2 = tmpW
      const tmpP = tile.pigment
      tile.pigment = tile.pigment2
      tile.pigment2 = tmpP
    })
  }
}

function renderWatercolorSimTiles(simTiles, bufferTiles, color, keys) {
  const rgb = hexToRgb(color)
  const renderKeys = keys ? Array.from(keys) : Array.from(simTiles.keys())
  for (const key of renderKeys) {
    const tile = simTiles.get(key)
    if (!tile) continue
    const { w, h, pigment, water, ctx, imageData } = tile
    const data = imageData.data
    for (let i = 0; i < pigment.length; i++) {
      const p = pigment[i]
      const wv = water[i]
      const dry = 1 - Math.min(1, wv)
      let a = p * (0.35 + 0.65 * dry)
      if (a < 0.001) {
        data[i * 4 + 3] = 0
        continue
      }
      a = Math.min(1, Math.pow(a, 0.85))
      const di = i * 4
      data[di] = rgb.r
      data[di + 1] = rgb.g
      data[di + 2] = rgb.b
      data[di + 3] = Math.round(a * 255)
    }
    ctx.putImageData(imageData, 0, 0)

    const bufTile = ensureTile(bufferTiles, key)
    const bctx = bufTile.getContext('2d')
    bctx.save()
    bctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE)
    bctx.imageSmoothingEnabled = true
    bctx.imageSmoothingQuality = 'high'
    if (WC2_RENDER_BLUR > 0) bctx.filter = `blur(${WC2_RENDER_BLUR}px)`
    bctx.drawImage(tile.canvas, 0, 0, w, h, 0, 0, TILE_SIZE, TILE_SIZE)
    bctx.restore()
  }
}

// ─── INFINITE CANVAS SYSTEM ───
const TILE_SIZE = 2048
const WC_COMPOSITE_ALPHA = 0.22
const OIL_COMPOSITE_ALPHA = 0.88
const INK_COMPOSITE_ALPHA = 1.0
const INKWASH_COMPOSITE_ALPHA = 0.35
const WC2_COMPOSITE_ALPHA = 1.0
const WC2_SCALE = 0.2
const WC2_TILE_SIZE = Math.floor(TILE_SIZE * WC2_SCALE)
const WC2_STEPS = 5
const WC2_WATER_DIFFUSE = 0.24
const WC2_PIGMENT_DIFFUSE = 0.09
const WC2_EVAPORATION = 0.04
const WC2_RENDER_BLUR = 1.0
const WC2_PREVIEW_MS = 60
const MIN_ZOOM = 0.15
const MAX_ZOOM = 4
const TOOLBAR_HIDE_DELAY = 2500

function ensureTile(tiles, key) {
  if (tiles.has(key)) return tiles.get(key)
  const c = document.createElement('canvas')
  c.width = TILE_SIZE
  c.height = TILE_SIZE
  tiles.set(key, c)
  return c
}

function paintToTiles(tiles, from, to, brush, color, size, pressure, opacity, velocity) {
  const strokeFn = STROKE_FN[brush]
  if (!strokeFn) return

  const pad = size * 3
  const minX = Math.min(from.x, to.x) - pad
  const maxX = Math.max(from.x, to.x) + pad
  const minY = Math.min(from.y, to.y) - pad
  const maxY = Math.max(from.y, to.y) + pad

  const tMinX = Math.floor(minX / TILE_SIZE)
  const tMaxX = Math.floor(maxX / TILE_SIZE)
  const tMinY = Math.floor(minY / TILE_SIZE)
  const tMaxY = Math.floor(maxY / TILE_SIZE)

  const opacityScale = (opacity ?? 100) / 100

  for (let tx = tMinX; tx <= tMaxX; tx++) {
    for (let ty = tMinY; ty <= tMaxY; ty++) {
      const key = `${tx},${ty}`
      const tile = ensureTile(tiles, key)
      const ctx = tile.getContext('2d')
      ctx.save()
      ctx.translate(-tx * TILE_SIZE, -ty * TILE_SIZE)
      if (opacityScale < 1) ctx.globalAlpha = opacityScale
      strokeFn(ctx, from, to, color, size, pressure, velocity)
      ctx.restore()
    }
  }
}

// Paint to stroke buffer using given stroke function (composited at fixed alpha on pen-up)
function paintToBuffer(bufferTiles, from, to, color, size, pressure, velocity, strokeFn) {
  const fn = strokeFn || strokeWatercolor
  const pad = size * 3
  const minX = Math.min(from.x, to.x) - pad
  const maxX = Math.max(from.x, to.x) + pad
  const minY = Math.min(from.y, to.y) - pad
  const maxY = Math.max(from.y, to.y) + pad

  const tMinX = Math.floor(minX / TILE_SIZE)
  const tMaxX = Math.floor(maxX / TILE_SIZE)
  const tMinY = Math.floor(minY / TILE_SIZE)
  const tMaxY = Math.floor(maxY / TILE_SIZE)

  for (let tx = tMinX; tx <= tMaxX; tx++) {
    for (let ty = tMinY; ty <= tMaxY; ty++) {
      const key = `${tx},${ty}`
      const tile = ensureTile(bufferTiles, key)
      const ctx = tile.getContext('2d')
      ctx.save()
      ctx.translate(-tx * TILE_SIZE, -ty * TILE_SIZE)
      fn(ctx, from, to, color, size, pressure, velocity)
      ctx.restore()
    }
  }
}

// Paint oil to stroke buffer, sampling colors from real tiles for pickup/mixing
function paintOilToBuffer(bufferTiles, realTiles, from, to, color, size, pressure, velocity) {
  const pad = size * 3
  const minX = Math.min(from.x, to.x) - pad
  const maxX = Math.max(from.x, to.x) + pad
  const minY = Math.min(from.y, to.y) - pad
  const maxY = Math.max(from.y, to.y) + pad

  const tMinX = Math.floor(minX / TILE_SIZE)
  const tMaxX = Math.floor(maxX / TILE_SIZE)
  const tMinY = Math.floor(minY / TILE_SIZE)
  const tMaxY = Math.floor(maxY / TILE_SIZE)

  for (let tx = tMinX; tx <= tMaxX; tx++) {
    for (let ty = tMinY; ty <= tMaxY; ty++) {
      const key = `${tx},${ty}`
      const bufTile = ensureTile(bufferTiles, key)
      const bufCtx = bufTile.getContext('2d')
      const realTile = realTiles.get(key)
      const sampleCtx = realTile ? realTile.getContext('2d') : null
      bufCtx.save()
      bufCtx.translate(-tx * TILE_SIZE, -ty * TILE_SIZE)
      if (sampleCtx) {
        sampleCtx.save()
        sampleCtx.translate(-tx * TILE_SIZE, -ty * TILE_SIZE)
      }
      strokeOil(bufCtx, from, to, color, size, pressure, velocity, sampleCtx)
      bufCtx.restore()
      if (sampleCtx) sampleCtx.restore()
    }
  }
}

// Composite buffer tiles onto real tiles at a fixed alpha
function compositeBuffer(bufferTiles, destTiles, alpha) {
  bufferTiles.forEach((bufTile, key) => {
    const dest = ensureTile(destTiles, key)
    const ctx = dest.getContext('2d')
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.drawImage(bufTile, 0, 0)
    ctx.restore()
  })
}

// ─── PERSISTENCE (IndexedDB for tiles, localStorage for settings) ───
const DB_NAME = 'morning-paint'
const DB_VERSION = 1
const TILE_STORE = 'tiles'
const SAVE_DEBOUNCE_MS = 2000

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(TILE_STORE)) {
        db.createObjectStore(TILE_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function saveTilesToDB(tiles) {
  if (tiles.size === 0) return Promise.resolve()
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TILE_STORE, 'readwrite')
      const store = tx.objectStore(TILE_STORE)
      store.clear()
      let pending = tiles.size
      if (pending === 0) { resolve(); return }
      tiles.forEach((canvas, key) => {
        canvas.toBlob(blob => {
          store.put(blob, key)
          pending--
          if (pending === 0) resolve()
        }, 'image/png')
      })
      tx.onerror = () => reject(tx.error)
    })
  }).catch(() => {})
}

function loadTilesFromDB() {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TILE_STORE, 'readonly')
      const store = tx.objectStore(TILE_STORE)
      const req = store.openCursor()
      const tiles = new Map()
      let count = 0
      req.onsuccess = (e) => {
        const cursor = e.target.result
        if (!cursor) {
          if (count === 0) { resolve(null); return }
          resolve(tiles)
          return
        }
        count++
        const key = cursor.key
        const blob = cursor.value
        const img = new Image()
        const url = URL.createObjectURL(blob)
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = TILE_SIZE
          c.height = TILE_SIZE
          c.getContext('2d').drawImage(img, 0, 0)
          URL.revokeObjectURL(url)
          tiles.set(key, c)
          cursor.continue()
        }
        img.onerror = () => { URL.revokeObjectURL(url); cursor.continue() }
        img.src = url
      }
      req.onerror = () => reject(req.error)
    })
  }).catch(() => null)
}

function clearTilesDB() {
  return openDB().then(db => {
    const tx = db.transaction(TILE_STORE, 'readwrite')
    tx.objectStore(TILE_STORE).clear()
  }).catch(() => {})
}

function saveSettings(obj) {
  try { localStorage.setItem('mp-settings', JSON.stringify(obj)) } catch {}
}

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('mp-settings')) } catch { return null }
}

// ─── SAVE HELPERS ───
function exportPNG(tiles, paperBg, bgImage, bgImagePos, bgOpacityPct) {
  if (tiles.size === 0) return

  // Find bounding box of all tiles
  let minTX = Infinity, minTY = Infinity, maxTX = -Infinity, maxTY = -Infinity
  tiles.forEach((_tile, key) => {
    const [tx, ty] = key.split(',').map(Number)
    minTX = Math.min(minTX, tx)
    minTY = Math.min(minTY, ty)
    maxTX = Math.max(maxTX, tx)
    maxTY = Math.max(maxTY, ty)
  })

  const w = (maxTX - minTX + 1) * TILE_SIZE
  const h = (maxTY - minTY + 1) * TILE_SIZE

  // Cap at 8192 to avoid memory issues
  const scale = Math.min(1, 8192 / Math.max(w, h))
  const outW = Math.round(w * scale)
  const outH = Math.round(h * scale)

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')

  // Fill with paper background
  ctx.fillStyle = paperBg
  ctx.fillRect(0, 0, outW, outH)

  // Draw background image if present
  if (bgImage && bgImagePos) {
    ctx.save()
    ctx.scale(scale, scale)
    ctx.globalAlpha = (bgOpacityPct ?? 30) / 100
    const dx = bgImagePos.x - minTX * TILE_SIZE
    const dy = bgImagePos.y - minTY * TILE_SIZE
    ctx.drawImage(bgImage, dx, dy, bgImagePos.w, bgImagePos.h)
    ctx.restore()
  }

  // Draw all tiles
  ctx.save()
  ctx.scale(scale, scale)
  tiles.forEach((tile, key) => {
    const [tx, ty] = key.split(',').map(Number)
    const dx = (tx - minTX) * TILE_SIZE
    const dy = (ty - minTY) * TILE_SIZE
    ctx.drawImage(tile, dx, dy)
  })
  ctx.restore()

  // Trigger download
  const link = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  const time = new Date().toTimeString().slice(0, 5).replace(':', '')
  link.download = `morning-paint-${date}-${time}.png`
  link.href = out.toDataURL('image/png')
  link.click()
}

// ─── COMPONENT ───
export default function MorningPaint() {
  const canvasRef = useRef(null)
  const tilesRef = useRef(new Map())
  const containerRef = useRef(null)

  // Load persisted settings before any hooks that depend on them
  const savedRef = useRef(loadSettings())
  const saved = savedRef.current
  const initView = saved?.view || { ox: -500, oy: -500, zoom: 1 }
  const viewRef = useRef(initView)
  const [viewState, setViewState] = useState(initView)

  const drawingRef = useRef(false)
  const lastPosRef = useRef(null)
  const panRef = useRef({ active: false, startX: 0, startY: 0, startOx: 0, startOy: 0 })
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1, midX: 0, midY: 0 })
  const historyRef = useRef([])
  const rafRef = useRef(null)
  const lastPressureRef = useRef(0.5)
  const pointerTypeRef = useRef('mouse')

  // Adaptive EMA smoothing: fast strokes = minimal smoothing, slow = heavy
  const emaRef = useRef({ x: 0, y: 0, vx: 0, vy: 0, lastTime: 0 })
  const velocityRef = useRef(0)

  // Catmull-Rom: ring buffer of last 4 world-space points with pressure
  const splineBufferRef = useRef([])

  const smoothPoint = useCallback((raw, pressure) => {
    const ema = emaRef.current
    const now = performance.now()
    const dt = ema.lastTime ? (now - ema.lastTime) : 16

    if (!ema.lastTime) {
      ema.x = raw.x; ema.y = raw.y; ema.vx = 0; ema.vy = 0; ema.lastTime = now
      splineBufferRef.current = [{ x: raw.x, y: raw.y, pressure: pressure || 0.5 }]
      velocityRef.current = 0
      return raw
    }

    // Velocity (pixels per ms)
    const dx = raw.x - ema.x
    const dy = raw.y - ema.y
    const speed = Math.sqrt(dx * dx + dy * dy) / Math.max(dt, 1)
    velocityRef.current = velocityRef.current * 0.7 + speed * 0.3

    // Adaptive alpha: fast = near-raw, slow = heavy smoothing
    // Watercolor gets extra smoothing for that flowing, liquid feel
    const isWatercolor = brushRef.current === 'watercolor' || brushRef.current === 'watercolor2'
    const isPen = pointerTypeRef.current === 'pen'
    const minAlpha = isWatercolor ? 0.2 : (isPen ? 0.32 : 0.4)
    const maxAlpha = isWatercolor ? 0.7 : (isPen ? 0.82 : 0.9)
    const velocityThreshold = 3.0
    const alpha = minAlpha + Math.min(velocityRef.current / velocityThreshold, 1.0) * (maxAlpha - minAlpha)

    ema.x = alpha * raw.x + (1 - alpha) * ema.x
    ema.y = alpha * raw.y + (1 - alpha) * ema.y
    ema.lastTime = now

    const smoothed = { x: ema.x, y: ema.y }

    // Feed into Catmull-Rom buffer
    const buf = splineBufferRef.current
    buf.push({ x: smoothed.x, y: smoothed.y, pressure: pressure || 0.5 })
    if (buf.length > 6) buf.shift()

    return smoothed
  }, [])

  // Toolbar auto-hide
  const hideTimerRef = useRef(null)
  const [toolbarVisible, setToolbarVisible] = useState(true)
  const [toolbarLocked, setToolbarLocked] = useState(false)
  const [showLabels, setShowLabels] = useState(false)
  const toolbarHoveredRef = useRef(false)

  // Tool state (restored from localStorage on mount)
  const [brush, setBrush] = useState(saved?.brush || 'watercolor')
  const brushRef = useRef(saved?.brush || 'watercolor')
  const [color, setColor] = useState(saved?.color || '#1D1D1F')
  const [size, setSize] = useState(saved?.size || 8)
  const [opacity, setOpacity] = useState(saved?.opacity ?? 100)

  // Color mixer state
  const [showMixer, setShowMixer] = useState(false)
  const [mixColor1, setMixColor1] = useState('#2980B9')
  const [mixColor2, setMixColor2] = useState('#F1C40F')
  const [mixRatio, setMixRatio] = useState(50)

  // Background image layer (coloring pages, reference images)
  const bgImageRef = useRef(null)
  const bgImagePosRef = useRef({ x: 0, y: 0, w: 0, h: 0 })
  const bgFileRef = useRef(null)
  const [bgOpacity, setBgOpacity] = useState(30)
  const [hasBgImage, setHasBgImage] = useState(false)
  const [showGallery, setShowGallery] = useState(false)

  // Stroke buffer: paint to temp tile map, composite at fixed alpha on pen-up
  // Used by watercolor (transparent layering) and oil (consistent coverage)
  const strokeBufRef = useRef(null)
  const strokeBufBrushRef = useRef(null)
  const strokeSimRef = useRef(null)
  const wc2DirtyRef = useRef(new Set())
  const wc2LastPreviewRef = useRef(0)
  const wcPathRef = useRef([])

  // Two-finger rewind gesture
  const rewindRef = useRef({ lastAngle: null, cumulative: 0, undoFired: false })
  const undoRef = useRef(null)
  const [paper, setPaper] = useState(saved?.paper || 'dots')
  const [showPalette, setShowPalette] = useState(false)
  const [showPaperMenu, setShowPaperMenu] = useState(false)
  const [prompt] = useState(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)])
  const [promptVisible, setPromptVisible] = useState(true)
  const [strokes, setStrokes] = useState(0)
  const [canvasSize, setCanvasSize] = useState({ w: 1200, h: 800 })
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Track last brush before eraser for toggle-back
  const prevBrushRef = useRef('calligraphy')
  const saveTimerRef = useRef(null)
  const restoredRef = useRef(false)

  // Debounced auto-save: tiles to IndexedDB, settings to localStorage
  const persistNow = useCallback(() => {
    saveSettings({
      brush: brushRef.current,
      color, size, opacity, paper,
      view: viewRef.current,
    })
    saveTilesToDB(tilesRef.current)
  }, [color, size, opacity, paper])

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(persistNow, SAVE_DEBOUNCE_MS)
  }, [persistNow])

  // Restore tiles from IndexedDB on mount
  // Restore tiles from IndexedDB on mount (runs after first render)
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    loadTilesFromDB().then(restored => {
      if (!restored || restored.size === 0) return
      tilesRef.current = restored
      setStrokes(restored.size)
      setPromptVisible(false)
      // Trigger re-render which calls renderViewport via viewState effect
      setViewState(v => ({ ...v }))
    })
  }, [])

  // Save on page hide / beforeunload (catches SW updates, tab closes, iOS background)
  useEffect(() => {
    const onHide = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveSettings({
        brush: brushRef.current,
        color, size, opacity, paper,
        view: viewRef.current,
      })
      saveTilesToDB(tilesRef.current)
    }
    const onVisChange = () => { if (document.hidden) onHide() }
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onVisChange)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('visibilitychange', onVisChange)
      window.removeEventListener('pagehide', onHide)
    }
  }, [color, size, opacity, paper])

  const currentPaper = PAPERS.find(p => p.id === paper) || PAPERS[0]
  const CW = canvasSize.w
  const CH = canvasSize.h

  // Fade prompt
  useEffect(() => {
    if (!promptVisible) return
    const timer = setTimeout(() => setPromptVisible(false), 8000)
    return () => clearTimeout(timer)
  }, [promptVisible])

  // Measure container
  useEffect(() => {
    const measure = () => {
      const el = containerRef.current
      if (!el) return
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0) {
        const dpr = window.devicePixelRatio || 1
        setCanvasSize({ w: Math.round(w * dpr), h: Math.round(h * dpr) })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Set canvas dimensions
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = CW
    canvas.height = CH
    renderViewport()
  }, [CW, CH])

  // Track fullscreen changes
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])

  const screenToWorld = useCallback((sx, sy) => {
    const v = viewRef.current
    const dpr = window.devicePixelRatio || 1
    return {
      x: (sx * dpr) / v.zoom + v.ox,
      y: (sy * dpr) / v.zoom + v.oy,
    }
  }, [])

  // Render visible tiles
  const renderViewport = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const v = viewRef.current
    const w = canvas.width
    const h = canvas.height
    const p = PAPERS.find(pp => pp.id === paper) || PAPERS[0]

    ctx.fillStyle = p.bg
    ctx.fillRect(0, 0, w, h)

    // Draw grid pattern based on paper type
    const gridSpacing = 40
    const gridZoomed = gridSpacing * v.zoom

    if (p.grid && gridZoomed > 8) {
      ctx.save()
      const isDark = p.bg === '#1A1A2E'
      const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
      const startWX = Math.floor(v.ox / gridSpacing) * gridSpacing
      const startWY = Math.floor(v.oy / gridSpacing) * gridSpacing
      const endWX = v.ox + w / v.zoom
      const endWY = v.oy + h / v.zoom

      if (p.grid === 'dots') {
        ctx.fillStyle = gridColor
        for (let wx = startWX; wx <= endWX; wx += gridSpacing) {
          for (let wy = startWY; wy <= endWY; wy += gridSpacing) {
            const sx = (wx - v.ox) * v.zoom
            const sy = (wy - v.oy) * v.zoom
            ctx.beginPath()
            ctx.arc(sx, sy, 0.8, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      } else if (p.grid === 'lines') {
        ctx.strokeStyle = gridColor
        ctx.lineWidth = 0.5
        for (let wy = startWY; wy <= endWY; wy += gridSpacing) {
          const sy = (wy - v.oy) * v.zoom
          ctx.beginPath()
          ctx.moveTo(0, sy)
          ctx.lineTo(w, sy)
          ctx.stroke()
        }
      } else if (p.grid === 'grid') {
        ctx.strokeStyle = gridColor
        ctx.lineWidth = 0.5
        for (let wx = startWX; wx <= endWX; wx += gridSpacing) {
          const sx = (wx - v.ox) * v.zoom
          ctx.beginPath()
          ctx.moveTo(sx, 0)
          ctx.lineTo(sx, h)
          ctx.stroke()
        }
        for (let wy = startWY; wy <= endWY; wy += gridSpacing) {
          const sy = (wy - v.oy) * v.zoom
          ctx.beginPath()
          ctx.moveTo(0, sy)
          ctx.lineTo(w, sy)
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    // Draw background image (between paper and paint)
    if (bgImageRef.current) {
      ctx.save()
      const pos = bgImagePosRef.current
      const sx = (pos.x - v.ox) * v.zoom
      const sy = (pos.y - v.oy) * v.zoom
      const sw = pos.w * v.zoom
      const sh = pos.h * v.zoom
      ctx.globalAlpha = bgOpacity / 100
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bgImageRef.current, sx, sy, sw, sh)
      ctx.restore()
    }

    // Draw tiles
    const tiles = tilesRef.current
    const tMinX = Math.floor(v.ox / TILE_SIZE)
    const tMaxX = Math.floor((v.ox + w / v.zoom) / TILE_SIZE)
    const tMinY = Math.floor(v.oy / TILE_SIZE)
    const tMaxY = Math.floor((v.oy + h / v.zoom) / TILE_SIZE)

    ctx.save()
    for (let tx = tMinX; tx <= tMaxX; tx++) {
      for (let ty = tMinY; ty <= tMaxY; ty++) {
        const key = `${tx},${ty}`
        const tile = tiles.get(key)
        if (!tile) continue
        const sx = (tx * TILE_SIZE - v.ox) * v.zoom
        const sy = (ty * TILE_SIZE - v.oy) * v.zoom
        const sw = TILE_SIZE * v.zoom
        const sh = TILE_SIZE * v.zoom
        ctx.drawImage(tile, sx, sy, sw, sh)
      }
    }
    ctx.restore()

    // Live preview of stroke buffer (shown at target composite alpha)
    const sBuf = strokeBufRef.current
    if (sBuf && sBuf.size > 0) {
      const previewAlpha = strokeBufBrushRef.current === 'oil' ? OIL_COMPOSITE_ALPHA
        : strokeBufBrushRef.current === 'calligraphy' ? INK_COMPOSITE_ALPHA
          : strokeBufBrushRef.current === 'inkwash' ? INKWASH_COMPOSITE_ALPHA
            : strokeBufBrushRef.current === 'watercolor2' ? WC2_COMPOSITE_ALPHA
              : WC_COMPOSITE_ALPHA
      ctx.save()
      ctx.globalAlpha = previewAlpha
      sBuf.forEach((bufTile, key) => {
        const [tx, ty] = key.split(',').map(Number)
        const sx = (tx * TILE_SIZE - v.ox) * v.zoom
        const sy = (ty * TILE_SIZE - v.oy) * v.zoom
        const sw = TILE_SIZE * v.zoom
        const sh = TILE_SIZE * v.zoom
        ctx.drawImage(bufTile, sx, sy, sw, sh)
      })
      ctx.restore()
    }
  }, [paper, bgOpacity, hasBgImage])

  const scheduleRender = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      renderViewport()
    })
  }, [renderViewport])

  useEffect(() => {
    renderViewport()
  }, [viewState, renderViewport])

  // ─── TOOLBAR AUTO-HIDE ───
  const showToolbar = useCallback(() => {
    setToolbarVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = null
  }, [])

  const scheduleHideToolbar = useCallback(() => {
    if (toolbarLocked || toolbarHoveredRef.current) return
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (!toolbarHoveredRef.current && !toolbarLocked) setToolbarVisible(false)
    }, TOOLBAR_HIDE_DELAY)
  }, [toolbarLocked])

  // ─── POINTER HANDLERS ───
  const getScreenPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const getPointerPressure = useCallback((e, from, to) => {
    if (e.pointerType === 'pen' && e.pressure > 0) {
      const mapped = clamp01(Math.pow(mapPressure(e.pressure), 0.82))
      // Felt should be steadier (less jagged pressure wobble)
      const emaIn = brushRef.current === 'felt' ? 0.18 : 0.28
      let smoothed = lastPressureRef.current * (1 - emaIn) + mapped * emaIn
      const delta = smoothed - lastPressureRef.current
      const maxStep = brushRef.current === 'felt' ? 0.035 : 0.055
      if (Math.abs(delta) > maxStep) smoothed = lastPressureRef.current + Math.sign(delta) * maxStep
      lastPressureRef.current = smoothed
      return smoothed
    }
    if (!from || !to) return 0.2
    const dx = to.x - from.x
    const dy = to.y - from.y
    const speed = Math.sqrt(dx * dx + dy * dy)
    // Mouse/finger: thinner baseline with modest speed modulation
    const simulatedRaw = 0.22 - speed / 650
    const simulated = Math.max(0.08, Math.min(0.32, simulatedRaw))
    const smoothed = lastPressureRef.current * 0.84 + simulated * 0.16
    lastPressureRef.current = smoothed
    return smoothed
  }, [])

  const pointersRef = useRef(new Map())

  const startDraw = useCallback((e) => {
    e.preventDefault()
    if (!canvasRef.current) return
    pointerTypeRef.current = e.pointerType || 'mouse'

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersRef.current.size >= 2) {
      drawingRef.current = false
      const pts = Array.from(pointersRef.current.values())
      const dx = pts[0].x - pts[1].x
      const dy = pts[0].y - pts[1].y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const rect = canvasRef.current.getBoundingClientRect()
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top
      pinchRef.current = {
        active: true, startDist: dist,
        startZoom: viewRef.current.zoom, midX, midY,
        startOx: viewRef.current.ox, startOy: viewRef.current.oy,
      }
      rewindRef.current = { lastAngle: Math.atan2(dy, dx), cumulative: 0, undoFired: false }
      return
    }

    if (e.altKey) {
      const sp = getScreenPos(e)
      panRef.current = {
        active: true, startX: sp.x, startY: sp.y,
        startOx: viewRef.current.ox, startOy: viewRef.current.oy,
      }
      return
    }

    drawingRef.current = true
    if (e.pointerType === 'pen' && e.pressure > 0) {
      lastPressureRef.current = clamp01(Math.pow(mapPressure(e.pressure), 0.82))
    } else {
      lastPressureRef.current = 0.2
    }
    emaRef.current = { x: 0, y: 0, vx: 0, vy: 0, lastTime: 0 }
    splineBufferRef.current = []
    velocityRef.current = 0
    const sp = getScreenPos(e)
    const rawWp = screenToWorld(sp.x, sp.y)
    const wp = smoothPoint(rawWp, 0.5)
    lastPosRef.current = wp

    if (promptVisible) setPromptVisible(false)

    setToolbarVisible(false)
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }

    // Close menus
    setShowPalette(false)
    setShowPaperMenu(false)

    const snapshot = new Map()
    tilesRef.current.forEach((tile, key) => {
      const c = document.createElement('canvas')
      c.width = TILE_SIZE
      c.height = TILE_SIZE
      c.getContext('2d').drawImage(tile, 0, 0)
      snapshot.set(key, c)
    })
    historyRef.current.push(snapshot)
    if (historyRef.current.length > 100) historyRef.current.shift()

    // Fill tool: tap-to-fill, then bail out (no drag needed)
    if (brushRef.current === 'fill') {
      floodFill(tilesRef.current, Math.round(wp.x), Math.round(wp.y), color, opacity, TILE_SIZE)
      drawingRef.current = false
      setStrokes(s => s + 1)
      scheduleRender()
      showToolbar()
      scheduleHideToolbar()
      scheduleSave()
      return
    }

    // Reset watercolor path for wet edge tracking
    wcPathRef.current = []

    // Initialize stroke buffer for brushes that use buffered compositing
    const b = brushRef.current
    if (b === 'watercolor' || b === 'watercolor2' || b === 'oil' || b === 'calligraphy' || b === 'inkwash') {
      strokeBufRef.current = new Map()
      strokeBufBrushRef.current = b
      if (b === 'watercolor2') {
        strokeSimRef.current = new Map()
        wc2DirtyRef.current = new Set()
        wc2LastPreviewRef.current = 0
      }
    }

    // Don't paint a dot here. The first onDraw will paint from this position.
    // Painting from→from (same point) causes artifacts (angle=0, dist=1 fallback).
  }, [brush, color, size, screenToWorld, scheduleRender, promptVisible, getPointerPressure, smoothPoint])

  const onDraw = useCallback((e) => {
    e.preventDefault()
    pointerTypeRef.current = e.pointerType || pointerTypeRef.current

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    if (pinchRef.current.active && pointersRef.current.size >= 2) {
      const pts = Array.from(pointersRef.current.values())
      const dx = pts[0].x - pts[1].x
      const dy = pts[0].y - pts[1].y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const rect = canvasRef.current.getBoundingClientRect()
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top

      // Rewind gesture: track two-finger rotation
      const rw = rewindRef.current
      const angle = Math.atan2(dy, dx)
      if (rw.lastAngle !== null) {
        let delta = angle - rw.lastAngle
        if (delta > Math.PI) delta -= 2 * Math.PI
        if (delta < -Math.PI) delta += 2 * Math.PI
        rw.cumulative += delta
        // Counter-clockwise past ~120 degrees = undo
        if (rw.cumulative < -Math.PI * 0.67 && !rw.undoFired) {
          rw.undoFired = true
          if (undoRef.current) undoRef.current()
        }
      }
      rw.lastAngle = angle

      const p = pinchRef.current
      const dpr = window.devicePixelRatio || 1
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, p.startZoom * (dist / p.startDist)))
      const worldMidX = (p.midX * dpr) / p.startZoom + p.startOx
      const worldMidY = (p.midY * dpr) / p.startZoom + p.startOy
      viewRef.current = { ox: worldMidX - (midX * dpr) / newZoom, oy: worldMidY - (midY * dpr) / newZoom, zoom: newZoom }
      setViewState({ ...viewRef.current })
      return
    }

    if (panRef.current.active) {
      const sp = getScreenPos(e)
      const dpr = window.devicePixelRatio || 1
      viewRef.current.ox = panRef.current.startOx - (sp.x - panRef.current.startX) * dpr / viewRef.current.zoom
      viewRef.current.oy = panRef.current.startOy - (sp.y - panRef.current.startY) * dpr / viewRef.current.zoom
      setViewState({ ...viewRef.current })
      return
    }

    if (!drawingRef.current) return

    const drawEvents = (e.pointerType === 'pen' && typeof e.getCoalescedEvents === 'function')
      ? e.getCoalescedEvents()
      : [e]

    // Catmull-Rom interpolation: when we have 4+ points, interpolate through spline
    const useBuffer = strokeBufRef.current !== null
    const curBrush = brushRef.current

    for (const ev of drawEvents) {
      const sp = getScreenPos(ev)
      const rawWp = screenToWorld(sp.x, sp.y)
      const pressure = getPointerPressure(ev, lastPosRef.current, rawWp)
      const wp = smoothPoint(rawWp, pressure)
      const vel = Math.min(velocityRef.current / 3.0, 1.0)

      const paintSeg = (from, to, pr) => {
        if (useBuffer) {
          if (curBrush === 'oil') {
            paintOilToBuffer(strokeBufRef.current, tilesRef.current, from, to, color, size, pr, vel)
          } else if (curBrush === 'watercolor2') {
            const touched = depositWatercolorSim(strokeSimRef.current, from, to, size, pr, vel)
            if (touched && touched.size > 0) {
              const dirty = wc2DirtyRef.current
              touched.forEach(k => dirty.add(k))
              const now = performance.now()
              if (now - wc2LastPreviewRef.current >= WC2_PREVIEW_MS) {
                renderWatercolorSimTiles(strokeSimRef.current, strokeBufRef.current, color, dirty)
                dirty.clear()
                wc2LastPreviewRef.current = now
              }
            }
          } else if (curBrush === 'calligraphy') {
            paintToBuffer(strokeBufRef.current, from, to, color, size, pr, vel, strokeCalligraphy)
          } else if (curBrush === 'inkwash') {
            paintToBuffer(strokeBufRef.current, from, to, color, size, pr, vel, strokeInkWash)
          } else {
            paintToBuffer(strokeBufRef.current, from, to, color, size, pr, vel)
          }
        } else {
          paintToTiles(tilesRef.current, from, to, brush, color, size, pr, opacity, vel)
        }
      }

      const buf = splineBufferRef.current
      if (buf.length >= 4) {
        const p0 = buf[buf.length - 4]
        const p1 = buf[buf.length - 3]
        const p2 = buf[buf.length - 2]
        const p3 = buf[buf.length - 1]
        const segDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
        const splineSegs = Math.max(6, Math.min(16, Math.ceil(segDist / 2)))
        const splinePoints = catmullRomSegment(p0, p1, p2, p3, splineSegs)
        for (let i = 1; i < splinePoints.length; i++) {
          paintSeg(splinePoints[i - 1], splinePoints[i], splinePoints[i].pressure)
        }
      } else {
        paintSeg(lastPosRef.current || wp, wp, pressure)
      }

      lastPosRef.current = wp

      // Collect path for watercolor wet edge (subsample: skip points too close together)
      if (brushRef.current === 'watercolor') {
        const wcPath = wcPathRef.current
        const last = wcPath[wcPath.length - 1]
        if (!last || Math.hypot(wp.x - last.x, wp.y - last.y) > size * 0.5) {
          wcPath.push({ x: wp.x, y: wp.y, pressure })
        }
      }
    }

    scheduleRender()
  }, [brush, color, size, opacity, screenToWorld, getPointerPressure, scheduleRender, smoothPoint])

  const endDraw = useCallback((e) => {
    if (e) pointersRef.current.delete(e.pointerId)
    const wasDrawing = drawingRef.current
    if (wasDrawing) setStrokes(s => s + 1)

    // Composite stroke buffer onto tiles
    if (wasDrawing && strokeBufRef.current && strokeBufRef.current.size > 0) {
      const bufBrush = strokeBufBrushRef.current

      // Calligraphy: add a short tapered tail on lift for a pointed finish
      if (bufBrush === 'calligraphy') {
        const buf = splineBufferRef.current
        if (buf.length >= 2) {
          const p2 = buf[buf.length - 1]
          const p1 = buf[buf.length - 2]
          const dx = p2.x - p1.x
          const dy = p2.y - p1.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist > 0.01) {
            const ux = dx / dist
            const uy = dy / dist
            const basePressure = p2.pressure ?? 0.5
            const tailVel = Math.min(velocityRef.current / 3.0, 1.0)
            // Avoid long terminal spikes on fast lift.
            if (tailVel < 0.55) {
              const tailLen = Math.max(0.4, size * 0.32 * (0.35 + basePressure))
              const steps = 2
              let prev = { x: p2.x, y: p2.y }
              for (let i = 1; i <= steps; i++) {
                const t = i / steps
                const pt = { x: p2.x + ux * tailLen * t, y: p2.y + uy * tailLen * t }
                const pr = basePressure * (1 - t)
                paintToBuffer(strokeBufRef.current, prev, pt, color, size, pr, tailVel, strokeCalligraphy)
                prev = pt
              }
            }
          }
        }
      }

      if (bufBrush === 'watercolor2' && strokeSimRef.current) {
        stepWatercolorSim(strokeSimRef.current, WC2_STEPS)
        renderWatercolorSimTiles(strokeSimRef.current, strokeBufRef.current, color)
        strokeSimRef.current = null
        wc2DirtyRef.current.clear()
        wc2LastPreviewRef.current = 0
      }

      const alpha = bufBrush === 'oil' ? OIL_COMPOSITE_ALPHA
        : bufBrush === 'calligraphy' ? INK_COMPOSITE_ALPHA
          : bufBrush === 'inkwash' ? INKWASH_COMPOSITE_ALPHA
            : bufBrush === 'watercolor2' ? WC2_COMPOSITE_ALPHA
              : WC_COMPOSITE_ALPHA
      compositeBuffer(strokeBufRef.current, tilesRef.current, alpha)
      strokeBufRef.current = null
      strokeBufBrushRef.current = null

      // Watercolor: subtle wet edge after a brief delay
      if (bufBrush === 'watercolor' && wcPathRef.current.length >= 3) {
        const pathSnap = [...wcPathRef.current]
        const tiles = tilesRef.current
        const colorSnap = color
        const sizeSnap = size
        const opacitySnap = opacity
        setTimeout(() => {
          paintWetEdge(tiles, pathSnap, colorSnap, sizeSnap, opacitySnap)
          scheduleRender()
        }, 100)
      }
    }
    wcPathRef.current = []

    drawingRef.current = false
    lastPosRef.current = null
    emaRef.current = { x: 0, y: 0, vx: 0, vy: 0, lastTime: 0 }
    splineBufferRef.current = []
    velocityRef.current = 0
    panRef.current.active = false
    if (pointersRef.current.size < 2) pinchRef.current.active = false
    showToolbar()
    scheduleHideToolbar()
    if (wasDrawing) scheduleSave()
  }, [showToolbar, scheduleHideToolbar, color, size, opacity, scheduleRender, scheduleSave])

  // Scroll to zoom
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e) => {
      e.preventDefault()
      const dpr = window.devicePixelRatio || 1
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        viewRef.current.ox += (e.deltaX * dpr) / viewRef.current.zoom
        viewRef.current.oy += (e.deltaY * dpr) / viewRef.current.zoom
        setViewState({ ...viewRef.current })
        return
      }
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const zoomFactor = e.deltaY < 0 ? 1.08 : 0.93
      const v = viewRef.current
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * zoomFactor))
      const worldX = (mx * dpr) / v.zoom + v.ox
      const worldY = (my * dpr) / v.zoom + v.oy
      viewRef.current = { ox: worldX - (mx * dpr) / newZoom, oy: worldY - (my * dpr) / newZoom, zoom: newZoom }
      setViewState({ ...viewRef.current })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const resetCanvas = useCallback(() => {
    if (strokes === 0) return
    const snapshot = new Map()
    tilesRef.current.forEach((tile, key) => {
      const c = document.createElement('canvas')
      c.width = TILE_SIZE
      c.height = TILE_SIZE
      c.getContext('2d').drawImage(tile, 0, 0)
      snapshot.set(key, c)
    })
    historyRef.current.push(snapshot)
    if (historyRef.current.length > 100) historyRef.current.shift()
    tilesRef.current.clear()
    setStrokes(0)
    clearTilesDB()
    renderViewport()
  }, [strokes, renderViewport])

  const undo = useCallback(() => {
    if (!historyRef.current.length) return
    const snapshot = historyRef.current.pop()
    tilesRef.current.clear()
    snapshot.forEach((tile, key) => tilesRef.current.set(key, tile))
    setStrokes(s => Math.max(0, s - 1))
    renderViewport()
  }, [renderViewport])
  undoRef.current = undo

  const savePNG = useCallback(() => {
    exportPNG(tilesRef.current, currentPaper.bg, bgImageRef.current, bgImagePosRef.current, bgOpacity)
  }, [currentPaper, bgOpacity])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen()
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen()
    }
  }, [])

  const loadBgImage = useCallback((file) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        bgImageRef.current = img
        const v = viewRef.current
        const canvas = canvasRef.current
        if (!canvas) return
        const dpr = window.devicePixelRatio || 1
        const vpW = canvas.width / dpr / v.zoom
        const vpH = canvas.height / dpr / v.zoom
        const maxW = vpW * 0.8
        const maxH = vpH * 0.8
        const scale = Math.min(maxW / img.width, maxH / img.height)
        const w = img.width * scale
        const h = img.height * scale
        bgImagePosRef.current = {
          x: v.ox + (vpW - w) / 2,
          y: v.oy + (vpH - h) / 2,
          w, h,
        }
        setHasBgImage(true)
        scheduleRender()
      }
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  }, [scheduleRender])

  const removeBgImage = useCallback(() => {
    bgImageRef.current = null
    bgImagePosRef.current = { x: 0, y: 0, w: 0, h: 0 }
    setHasBgImage(false)
    scheduleRender()
  }, [scheduleRender])

  const placeBgImage = useCallback((img) => {
    bgImageRef.current = img
    const v = viewRef.current
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const vpW = canvas.width / dpr / v.zoom
    const vpH = canvas.height / dpr / v.zoom
    const maxW = vpW * 0.8
    const maxH = vpH * 0.8
    const scale = Math.min(maxW / img.width, maxH / img.height)
    const w = img.width * scale
    const h = img.height * scale
    bgImagePosRef.current = {
      x: v.ox + (vpW - w) / 2,
      y: v.oy + (vpH - h) / 2,
      w, h,
    }
    setHasBgImage(true)
    setShowGallery(false)
    scheduleRender()
  }, [scheduleRender])

  const loadBgFromUrl = useCallback((url) => {
    if (url.endsWith('.svg')) {
      // SVGs with <text> need rasterization with system fonts available
      fetch(url).then(r => r.text()).then(svgText => {
        const parser = new DOMParser()
        const doc = parser.parseFromString(svgText, 'image/svg+xml')
        const svgEl = doc.documentElement
        const w = parseInt(svgEl.getAttribute('width')) || 1000
        const h = parseInt(svgEl.getAttribute('height')) || 800
        const offscreen = document.createElement('canvas')
        offscreen.width = w
        offscreen.height = h
        const ctx = offscreen.getContext('2d')
        // Render SVG via blob URL with proper MIME so fonts resolve
        const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
        const blobUrl = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, w, h)
          URL.revokeObjectURL(blobUrl)
          // Use the rasterized canvas as the background image
          placeBgImage(offscreen)
        }
        img.src = blobUrl
      })
    } else {
      const img = new Image()
      img.onload = () => placeBgImage(img)
      img.src = url
    }
  }, [placeBgImage])

  const selectBrush = useCallback((id) => {
    if (id === 'eraser' || id === 'smudge' || id === 'fill') {
      if (brush !== 'eraser' && brush !== 'smudge' && brush !== 'fill') prevBrushRef.current = brush
    }
    setBrush(id)
    brushRef.current = id
  }, [brush])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (drawingRef.current) return
      const key = e.key.toLowerCase()
      if (key === 'z' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); undo(); return }
      if (key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); savePNG(); return }
      if (key === 'f') { toggleFullscreen(); return }
      if (key === '1') { selectBrush('felt'); return }
      if (key === '2') { selectBrush('watercolor'); return }
      if (key === '3') { selectBrush('calligraphy'); return }
      if (key === '4') { selectBrush('pastel'); return }
      if (key === '5') { selectBrush('charcoal'); return }
      if (key === '6') { selectBrush('oil'); return }
      if (key === '7') { selectBrush('smudge'); return }
      if (key === 'g') { selectBrush('fill'); return }
      if (key === 'e') { selectBrush(brush === 'eraser' ? prevBrushRef.current : 'eraser'); return }
      if (key === '[') { setSize(s => Math.max(2, s - 2)); return }
      if (key === ']') { setSize(s => Math.min(60, s + 2)); return }
      if (key === 'p') { setShowPalette(v => !v); return }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, savePNG, toggleFullscreen, selectBrush, brush])

  // ─── STYLES ───
  const segBtn = (id) => ({
    display: 'flex', flexDirection: showLabels ? 'column' : 'row',
    alignItems: 'center', justifyContent: 'center',
    width: showLabels ? 56 : 52, height: showLabels ? 56 : 46, borderRadius: 10, cursor: 'pointer', border: 'none',
    background: brush === id ? C.active : 'transparent',
    color: brush === id ? C.accent : C.dim,
    transition: 'all 0.2s ease', gap: 2, padding: 0,
  })

  const iconBtn = (disabled) => ({
    width: 46, height: 46, borderRadius: 10, border: 'none',
    background: 'transparent', cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: disabled ? '#D2D2D7' : C.dim, transition: 'color 0.2s ease',
  })

  const toolbarPill = {
    display: 'flex', alignItems: 'center', gap: 3,
    padding: '8px 10px', borderRadius: 16,
    background: C.toolbar, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
    boxShadow: '0 2px 20px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.06)',
  }

  const sep = <div style={{ width: 1, height: 32, background: C.sep, flexShrink: 0, margin: '0 5px' }} />

  return (
    <div style={{
      height: '100dvh', background: currentPaper.bg, fontFamily: SYS,
      color: C.text, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      position: 'relative',
    }}>

      {/* ─── FLOATING PROMPT ─── */}
      {prompt && (
        <div style={{
          position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 100, pointerEvents: 'none',
          opacity: promptVisible ? 1 : 0, transition: 'opacity 2s ease-out',
        }}>
          <div style={{
            padding: '10px 24px', borderRadius: 100,
            background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            boxShadow: '0 1px 8px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.04)',
            fontSize: 14, fontStyle: 'italic', color: C.dim, fontWeight: 400, letterSpacing: '-0.01em',
          }}>
            {prompt}
          </div>
        </div>
      )}

      {/* ─── CANVAS ─── */}
      <div ref={containerRef} style={{
        flex: 1, overflow: 'hidden', position: 'relative',
        cursor: brush === 'fill' ? 'cell' : brush === 'eraser' ? 'cell' : brush === 'smudge' ? 'grab' : 'crosshair',
        WebkitUserSelect: 'none', userSelect: 'none',
        WebkitTouchCallout: 'none',
      }}>
        <canvas
          ref={canvasRef}
          onPointerDown={startDraw}
          onPointerMove={onDraw}
          onPointerUp={endDraw}
          onPointerLeave={endDraw}
          onPointerCancel={endDraw}
          style={{
            width: '100%', height: '100%', touchAction: 'none',
            WebkitUserSelect: 'none', userSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
        />

        {/* ─── TOP-RIGHT UTILITY BAR ─── */}
        <div style={{
          position: 'absolute', top: 16, right: 16, zIndex: 100,
          display: 'flex', gap: 6,
          opacity: toolbarVisible ? 1 : 0,
          transition: 'opacity 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)',
          pointerEvents: toolbarVisible ? 'auto' : 'none',
        }}>
          {/* Paper selector */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowPaperMenu(!showPaperMenu); setShowPalette(false) }}
              style={{
                ...iconBtn(false), ...toolbarPill,
                padding: '6px 10px', gap: 6, width: 'auto',
              }}
              title="Paper texture"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <span style={{ fontSize: 12, fontWeight: 500, color: C.dim }}>{currentPaper.label}</span>
            </button>
            {showPaperMenu && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 8,
                background: C.paletteBg, borderRadius: 12, padding: 6, minWidth: 160,
                backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)', border: `1px solid ${C.paletteBorder}`,
              }}>
                {PAPERS.map(p => (
                  <button key={p.id} onClick={() => { setPaper(p.id); setShowPaperMenu(false) }} style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '8px 12px', border: 'none', borderRadius: 8, cursor: 'pointer',
                    background: paper === p.id ? 'rgba(255,255,255,0.1)' : 'transparent',
                    color: '#fff', fontSize: 13, fontFamily: SYS, textAlign: 'left',
                  }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: 4, background: p.bg,
                      border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0,
                    }} />
                    {p.label}
                    {paper === p.id && <span style={{ marginLeft: 'auto', fontSize: 11, color: C.accent }}>&#10003;</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Background image import + gallery */}
          <input ref={bgFileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { if (e.target.files[0]) loadBgImage(e.target.files[0]); e.target.value = '' }} />
          <div style={{ position: 'relative' }}>
            <div style={{ ...toolbarPill, padding: '6px 4px', gap: 2 }}>
              <button onClick={() => bgFileRef.current?.click()} style={{
                ...iconBtn(false), padding: '0 6px',
                color: hasBgImage ? C.accent : C.dim,
              }} title="Load from file">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </button>
              <button onClick={() => setShowGallery(v => !v)} style={{
                ...iconBtn(false), padding: '0 6px',
                color: showGallery ? C.accent : C.dim,
              }} title="Coloring pages gallery">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
              </button>
            </div>
            {showGallery && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 8,
                width: 280, maxHeight: 480, overflowY: 'auto',
                background: C.toolbar, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
                borderRadius: 14, padding: 12,
                boxShadow: '0 8px 40px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(0,0,0,0.08)',
              }}>
                {[...new Set(COLORING_PAGES.map(p => p.cat))].map((cat, i) => (
                  <div key={cat}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: C.dim, fontFamily: MONO, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: i > 0 ? 10 : 0 }}>{cat}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 4 }}>
                      {COLORING_PAGES.filter(p => p.cat === cat).map(page => (
                        <button key={page.id} onClick={() => loadBgFromUrl(page.src)} style={{
                          border: 'none', background: '#fff', borderRadius: 8, padding: 3, cursor: 'pointer',
                          aspectRatio: '1', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                          transition: 'transform 0.15s ease',
                        }}
                          onPointerEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                          onPointerLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                        >
                          {page.thumb ? (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5, background: '#fafafa', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontSize: 28, lineHeight: 1 }}>{page.thumb}</span>
                              <span style={{ fontSize: 7, color: C.dim, fontWeight: 600 }}>{page.label}</span>
                            </div>
                          ) : (
                            <img src={page.src} alt={page.label} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 5 }} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Background opacity + remove (visible when bg loaded) */}
          {hasBgImage && (
            <div style={{ ...toolbarPill, padding: '4px 8px', gap: 6, display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: C.dim, fontFamily: MONO, minWidth: 24 }}>{bgOpacity}%</span>
              <input type="range" min="5" max="100" value={bgOpacity}
                onChange={e => { setBgOpacity(Number(e.target.value)); scheduleRender() }}
                style={{ width: 48, accentColor: C.accent, opacity: 0.7 }} />
              <button onClick={removeBgImage} style={{ ...iconBtn(false), padding: 2 }} title="Remove background">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                </svg>
              </button>
            </div>
          )}

          {/* Save */}
          <button onClick={savePNG} style={{ ...iconBtn(strokes === 0), ...toolbarPill, padding: '6px 10px' }} title="Save as PNG (Cmd+S)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>

          {/* Fullscreen */}
          <button onClick={toggleFullscreen} style={{ ...iconBtn(false), ...toolbarPill, padding: '6px 10px' }} title="Fullscreen (F)">
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 14 10 14 10 20"/>
                <polyline points="20 10 14 10 14 4"/>
                <line x1="14" y1="10" x2="21" y2="3"/>
                <line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9"/>
                <polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/>
                <line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            )}
          </button>
        </div>

        {/* ─── BOTTOM TOOLBAR ─── */}
        <div
          onPointerEnter={() => { toolbarHoveredRef.current = true; showToolbar() }}
          onPointerLeave={() => { toolbarHoveredRef.current = false; scheduleHideToolbar() }}
          style={{
            position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)',
            zIndex: 100,
            opacity: toolbarVisible ? 1 : 0,
            transition: 'opacity 0.4s cubic-bezier(0.25, 0.1, 0.25, 1)',
            pointerEvents: toolbarVisible ? 'auto' : 'none',
          }}
        >
          <div style={toolbarPill}>
            {/* Brush segmented control */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 1,
              background: 'rgba(0,0,0,0.03)', borderRadius: 10, padding: 2,
            }}>
              {BRUSHES.map(b => (
                <button key={b.id} onClick={() => selectBrush(b.id)} style={segBtn(b.id)} title={b.label}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24 }}>
                    {BRUSH_ICONS[b.id]}
                  </span>
                  {showLabels && <span style={{ fontSize: 8, fontWeight: 600, letterSpacing: '0.02em', lineHeight: 1, color: 'inherit', whiteSpace: 'nowrap' }}>{b.label}</span>}
                </button>
              ))}
            </div>

            {sep}

            {/* Size */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{
                  width: Math.max(size * 0.4, 3), height: Math.max(size * 0.4, 3),
                  borderRadius: '50%', background: (brush === 'eraser' || brush === 'smudge') ? C.dim : color,
                  border: color === '#FFFFFF' && brush !== 'eraser' && brush !== 'smudge' ? '1px solid #D2D2D7' : 'none',
                  transition: 'all 0.15s',
                }} />
              </div>
              <input
                type="range" min="2" max="60" value={size}
                onChange={e => setSize(Number(e.target.value))}
                style={{ width: 64, accentColor: C.accent, opacity: 0.7 }}
              />
            </div>

            {/* Opacity */}
            {brush !== 'eraser' && brush !== 'smudge' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10, color: C.dim, fontFamily: MONO, minWidth: 28, textAlign: 'right' }}>{opacity}%</span>
                <input
                  type="range" min="5" max="100" value={opacity}
                  onChange={e => setOpacity(Number(e.target.value))}
                  style={{ width: 48, accentColor: C.accent, opacity: 0.7 }}
                />
              </div>
            )}

            {/* Color swatch (hidden for eraser/smudge) */}
            {brush !== 'eraser' && brush !== 'smudge' && (
              <button
                onClick={() => { setShowPalette(!showPalette); setShowPaperMenu(false) }}
                style={{
                  width: 36, height: 36, borderRadius: '50%', cursor: 'pointer', flexShrink: 0,
                  background: color,
                  border: showPalette ? `2px solid ${C.accent}` : '2px solid rgba(0,0,0,0.08)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)', transition: 'all 0.2s',
                }}
              />
            )}

            {sep}

            {/* Undo */}
            <button onClick={undo} disabled={strokes === 0} style={iconBtn(strokes === 0)} title="Undo (Cmd+Z)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6"/>
                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6.69 3L3 13"/>
              </svg>
            </button>
            {/* Reset */}
            <button onClick={resetCanvas} disabled={strokes === 0} style={iconBtn(strokes === 0)} title="Clear canvas">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18"/>
                <path d="m6 6 12 12"/>
              </svg>
            </button>

            {sep}

            {/* Pin toolbar (keep visible) */}
            <button onClick={() => {
              const next = !toolbarLocked
              setToolbarLocked(next)
              if (next) { showToolbar(); if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null } }
              else { setShowLabels(false); scheduleHideToolbar() }
            }} style={{ ...iconBtn(false), color: toolbarLocked ? C.accent : C.dim }} title={toolbarLocked ? 'Unlock toolbar' : 'Lock toolbar'}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill={toolbarLocked ? C.accent : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                {toolbarLocked
                  ? <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>
                  : <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>
                }
              </svg>
            </button>

            {/* Show labels (only when locked) */}
            {toolbarLocked && (
              <button onClick={() => setShowLabels(v => !v)} style={{ ...iconBtn(false), color: showLabels ? C.accent : C.dim }} title={showLabels ? 'Hide labels' : 'Show labels'}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 7 4 4 20 4 20 7"/>
                  <line x1="9" y1="20" x2="15" y2="20"/>
                  <line x1="12" y1="4" x2="12" y2="20"/>
                </svg>
              </button>
            )}
          </div>

          {/* ─── FLOATING PALETTE ─── */}
          {showPalette && (
            <div style={{
              position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
              marginBottom: 10, maxWidth: 'calc(100vw - 32px)',
            }}>
              <div style={{
                background: C.paletteBg, borderRadius: 16, padding: 14,
                backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)', border: `1px solid ${C.paletteBorder}`,
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
                  {PALETTE.map(c => (
                    <button key={c} onClick={() => { setColor(c); setShowPalette(false) }} style={{
                      width: 30, height: 30, borderRadius: '50%', cursor: 'pointer', background: c,
                      border: color === c ? '2.5px solid #fff' : '1.5px solid rgba(255,255,255,0.1)',
                      boxShadow: color === c ? `0 0 0 1.5px ${c}, 0 0 10px ${c}40` : 'none',
                      transition: 'all 0.15s', transform: color === c ? 'scale(1.1)' : 'scale(1)',
                    }} />
                  ))}
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
                  paddingTop: 10, borderTop: `1px solid ${C.paletteBorder}`,
                }}>
                  <input type="color" value={color} onChange={e => setColor(e.target.value)}
                    style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                  <span style={{ fontSize: 11, color: '#888', fontFamily: MONO }}>{color.toUpperCase()}</span>
                  <button onClick={() => setShowMixer(!showMixer)} style={{
                    marginLeft: 'auto', fontSize: 10, fontWeight: 600, fontFamily: MONO,
                    color: showMixer ? '#fff' : '#888', background: showMixer ? 'rgba(255,255,255,0.12)' : 'transparent',
                    border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                    letterSpacing: '0.05em',
                  }}>MIX</button>
                </div>

                {/* ─── COLOR MIXER ─── */}
                {showMixer && (() => {
                  const rgb1 = hexToRgb(mixColor1)
                  const rgb2 = hexToRgb(mixColor2)
                  const r = mixRatio / 100
                  const mixed = mixPigments(rgb1, rgb2, r)
                  const clamp = v => Math.max(0, Math.min(255, Math.round(v)))
                  const mixedHex = `#${clamp(mixed.r).toString(16).padStart(2,'0')}${clamp(mixed.g).toString(16).padStart(2,'0')}${clamp(mixed.b).toString(16).padStart(2,'0')}`
                  return (
                    <div style={{
                      marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.paletteBorder}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="color" value={mixColor1} onChange={e => setMixColor1(e.target.value)}
                          style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                        <input
                          type="range" min="0" max="100" value={mixRatio}
                          onChange={e => setMixRatio(Number(e.target.value))}
                          style={{ flex: 1, accentColor: mixedHex }}
                        />
                        <input type="color" value={mixColor2} onChange={e => setMixColor2(e.target.value)}
                          style={{ width: 28, height: 28, border: 'none', background: 'transparent', cursor: 'pointer' }} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <button onClick={() => { setColor(mixedHex); setShowPalette(false); setShowMixer(false) }} style={{
                          flex: 1, height: 32, borderRadius: 8, border: '1.5px solid rgba(255,255,255,0.15)',
                          background: mixedHex, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <span style={{
                            fontSize: 10, fontWeight: 600, fontFamily: MONO, letterSpacing: '0.08em',
                            color: (clamp(mixed.r) * 0.299 + clamp(mixed.g) * 0.587 + clamp(mixed.b) * 0.114) > 128 ? '#000' : '#fff',
                          }}>USE {mixedHex.toUpperCase()}</span>
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
