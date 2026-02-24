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
  { in: 0.1, out: 0.15 },
  { in: 0.3, out: 0.35 },
  { in: 0.5, out: 0.55 },
  { in: 0.75, out: 0.82 },
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
  { id: 'felt',        label: 'Felt Tip' },
  { id: 'watercolor',  label: 'Watercolor' },
  { id: 'calligraphy', label: 'Calligraphy' },
  { id: 'pastel',      label: 'Soft Pastel' },
  { id: 'charcoal',    label: 'Charcoal' },
  { id: 'oil',         label: 'Oil Paint' },
  { id: 'smudge',      label: 'Smudge' },
  { id: 'eraser',      label: 'Eraser' },
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
  calligraphy: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 4L8.5 15.5"/>
      <path d="M15.5 9.5l-3 3"/>
      <path d="M8.5 15.5c-1 1-3.5 2.5-4.5 3.5 1-1 2-3 1-4l3-3 3.5 3.5z"/>
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

  const speedFactor = Math.max(0.65, Math.min(1.0, 1.1 - vel * 0.35))
  const w = size * (0.8 + pressure * 0.4)
  const stepSize = Math.max(size * 0.3, 4)
  const steps = Math.max(Math.floor(dist / stepSize), 1)
  const jitter = w * 0.3

  // Buffer mode: paint at elevated alpha; entire stroke composited at ~18% on pen-up
  // This ensures uniform opacity per stroke with predictable darkening on overlap
  ctx.globalCompositeOperation = 'source-over'

  // Wash body: soft radial gradient blobs that fill in to near-solid in the buffer
  const washAlpha = (0.06 + pressure * 0.1) * speedFactor
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = from.x + dx * t + (Math.random() - 0.5) * jitter
    const y = from.y + dy * t + (Math.random() - 0.5) * jitter
    const grain = sampleGrain(x, y)
    const grainMod = 0.7 + grain * 0.6

    const r = w * (0.7 + Math.random() * 0.5)
    const outerR = r * 1.3
    const a = washAlpha * grainMod

    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, outerR)
    g.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`)
    g.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},${a * 0.65})`)
    g.addColorStop(0.8, `rgba(${rgb.r},${rgb.g},${rgb.b},${a * 0.25})`)
    g.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    blobPath(ctx, x, y, outerR)
    ctx.fill()
  }

  // Bloom puddles for organic spread
  if (dist > 4) {
    const bloomCount = Math.ceil(dist / (size * 1.5))
    for (let i = 0; i < bloomCount; i++) {
      const t = Math.random()
      const bx = from.x + dx * t + (Math.random() - 0.5) * w * 0.7
      const by = from.y + dy * t + (Math.random() - 0.5) * w * 0.7
      const grain = sampleGrain(bx, by)
      const br = w * (0.8 + Math.random() * 0.8)
      const a = (0.02 + pressure * 0.04) * (0.5 + grain * 0.5) * speedFactor
      const g = ctx.createRadialGradient(bx, by, br * 0.1, bx, by, br)
      g.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`)
      g.addColorStop(0.6, `rgba(${rgb.r},${rgb.g},${rgb.b},${a * 0.4})`)
      g.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      blobPath(ctx, bx, by, br)
      ctx.fill()
    }
  }

  // Edge accent — pigment pooling hint
  const edgeAlpha = (0.02 + pressure * 0.03) * speedFactor
  for (let i = 0; i <= steps; i += 2) {
    const t = i / steps
    const x = from.x + dx * t + (Math.random() - 0.5) * jitter * 0.5
    const y = from.y + dy * t + (Math.random() - 0.5) * jitter * 0.5
    const grain = sampleGrain(x, y)

    const r = w * (0.6 + Math.random() * 0.3)
    ctx.globalAlpha = edgeAlpha * (0.5 + grain * 1.0)
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(w * 0.08, 1)
    ctx.beginPath()
    blobPath(ctx, x, y, r)
    ctx.stroke()
  }

  // Pigment granulation in paper valleys
  if (dist > 6) {
    const darkR = Math.max(0, rgb.r - 25)
    const darkG = Math.max(0, rgb.g - 25)
    const darkB = Math.max(0, rgb.b - 25)
    const spread = w * 0.6
    for (let i = 0; i < Math.ceil(dist / 4); i++) {
      const t = Math.random()
      const px = from.x + dx * t + (Math.random() - 0.5) * spread
      const py = from.y + dy * t + (Math.random() - 0.5) * spread
      const pGrain = sampleGrain(px, py)
      if (pGrain < 0.4) continue
      ctx.globalAlpha = (0.08 + pressure * 0.12) * pGrain * speedFactor
      ctx.fillStyle = `rgb(${darkR},${darkG},${darkB})`
      ctx.beginPath()
      ctx.arc(px, py, 0.5 + Math.random() * size * 0.06, 0, Math.PI * 2)
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


// Calligraphy: flat nib whose width depends on stroke direction vs. fixed nib angle
const NIB_ANGLE = Math.PI * 0.25 // 45 degrees, classic italic

function strokeCalligraphy(ctx, from, to, color, size, pressure) {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'

  const dx = to.x - from.x
  const dy = to.y - from.y
  const strokeAngle = Math.atan2(dy, dx)

  // Width = how perpendicular the stroke is to the nib angle
  // Parallel to nib = thin hairline, perpendicular = full width
  const angleDiff = strokeAngle - NIB_ANGLE
  const nibWidth = size * (0.08 + Math.abs(Math.sin(angleDiff)) * 0.92) * (0.5 + pressure * 0.5)

  // Nib perpendicular direction (fixed angle, not stroke-following)
  const nibPerpX = -Math.sin(NIB_ANGLE)
  const nibPerpY = Math.cos(NIB_ANGLE)

  // Filled quad: nib shape stays at fixed angle
  ctx.globalAlpha = 0.88 + pressure * 0.12
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(from.x + nibPerpX * nibWidth * 0.5, from.y + nibPerpY * nibWidth * 0.5)
  ctx.lineTo(to.x + nibPerpX * nibWidth * 0.5, to.y + nibPerpY * nibWidth * 0.5)
  ctx.lineTo(to.x - nibPerpX * nibWidth * 0.5, to.y - nibPerpY * nibWidth * 0.5)
  ctx.lineTo(from.x - nibPerpX * nibWidth * 0.5, from.y - nibPerpY * nibWidth * 0.5)
  ctx.closePath()
  ctx.fill()

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
  calligraphy: strokeCalligraphy,
  pastel: strokePastel,
  charcoal: strokeCharcoal,
  oil: strokeOil,
  smudge: strokeSmudge,
  eraser: strokeEraser,
}

// ─── INFINITE CANVAS SYSTEM ───
const TILE_SIZE = 2048
const WC_COMPOSITE_ALPHA = 0.18
const OIL_COMPOSITE_ALPHA = 0.88
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

// Paint watercolor to stroke buffer at elevated opacity (composited at fixed alpha on pen-up)
function paintToBuffer(bufferTiles, from, to, color, size, pressure, velocity) {
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
      strokeWatercolor(ctx, from, to, color, size, pressure, velocity)
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

  const viewRef = useRef({ ox: -500, oy: -500, zoom: 1 })
  const [viewState, setViewState] = useState({ ox: -500, oy: -500, zoom: 1 })

  const drawingRef = useRef(false)
  const lastPosRef = useRef(null)
  const panRef = useRef({ active: false, startX: 0, startY: 0, startOx: 0, startOy: 0 })
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1, midX: 0, midY: 0 })
  const historyRef = useRef([])
  const rafRef = useRef(null)
  const lastPressureRef = useRef(0.5)

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
    const isWatercolor = brushRef.current === 'watercolor'
    const minAlpha = isWatercolor ? 0.2 : 0.4
    const maxAlpha = isWatercolor ? 0.7 : 0.9
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
  const toolbarHoveredRef = useRef(false)

  // Tool state
  const [brush, setBrush] = useState('watercolor')
  const brushRef = useRef('calligraphy')
  const [color, setColor] = useState('#1D1D1F')
  const [size, setSize] = useState(8)
  const [opacity, setOpacity] = useState(100)

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
  const wcPathRef = useRef([])

  // Two-finger rewind gesture
  const rewindRef = useRef({ lastAngle: null, cumulative: 0, undoFired: false })
  const undoRef = useRef(null)
  const [paper, setPaper] = useState('dots')
  const [showPalette, setShowPalette] = useState(false)
  const [showPaperMenu, setShowPaperMenu] = useState(false)
  const [prompt] = useState(() => PROMPTS[Math.floor(Math.random() * PROMPTS.length)])
  const [promptVisible, setPromptVisible] = useState(true)
  const [strokes, setStrokes] = useState(0)
  const [canvasSize, setCanvasSize] = useState({ w: 1200, h: 800 })
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Track last brush before eraser for toggle-back
  const prevBrushRef = useRef('calligraphy')

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
      const previewAlpha = strokeBufBrushRef.current === 'oil' ? OIL_COMPOSITE_ALPHA : WC_COMPOSITE_ALPHA
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
    if (toolbarHoveredRef.current) return
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (!toolbarHoveredRef.current) setToolbarVisible(false)
    }, TOOLBAR_HIDE_DELAY)
  }, [])

  // ─── POINTER HANDLERS ───
  const getScreenPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const getPointerPressure = useCallback((e, from, to) => {
    if (e.pointerType === 'pen' && e.pressure > 0) {
      const mapped = mapPressure(e.pressure)
      const smoothed = lastPressureRef.current * 0.15 + mapped * 0.85
      lastPressureRef.current = smoothed
      return smoothed
    }
    if (!from || !to) return 0.7
    const dx = to.x - from.x
    const dy = to.y - from.y
    const speed = Math.sqrt(dx * dx + dy * dy)
    const simulated = Math.max(0.2, Math.min(1, 1 - speed / 200))
    lastPressureRef.current = simulated
    return simulated
  }, [])

  const pointersRef = useRef(new Map())

  const startDraw = useCallback((e) => {
    e.preventDefault()
    if (!canvasRef.current) return

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

    // Reset watercolor path for wet edge tracking
    wcPathRef.current = []

    // Initialize stroke buffer for brushes that use buffered compositing
    const b = brushRef.current
    if (b === 'watercolor' || b === 'oil') {
      strokeBufRef.current = new Map()
      strokeBufBrushRef.current = b
    }

    // Don't paint a dot here. The first onDraw will paint from this position.
    // Painting from→from (same point) causes artifacts (angle=0, dist=1 fallback).
  }, [brush, color, size, screenToWorld, scheduleRender, promptVisible, getPointerPressure, smoothPoint])

  const onDraw = useCallback((e) => {
    e.preventDefault()

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
    const sp = getScreenPos(e)
    const rawWp = screenToWorld(sp.x, sp.y)
    const pressure = getPointerPressure(e, lastPosRef.current, rawWp)
    const wp = smoothPoint(rawWp, pressure)

    // Normalize velocity to 0-1 range for brush engines (3.0 px/ms = full speed)
    const vel = Math.min(velocityRef.current / 3.0, 1.0)

    // Catmull-Rom interpolation: when we have 4+ points, interpolate through spline
    const useBuffer = strokeBufRef.current !== null
    const curBrush = brushRef.current
    const buf = splineBufferRef.current
    const paintSeg = (from, to, pr) => {
      if (useBuffer) {
        if (curBrush === 'oil') {
          paintOilToBuffer(strokeBufRef.current, tilesRef.current, from, to, color, size, pr, vel)
        } else {
          paintToBuffer(strokeBufRef.current, from, to, color, size, pr, vel)
        }
      } else {
        paintToTiles(tilesRef.current, from, to, brush, color, size, pr, opacity, vel)
      }
    }
    if (buf.length >= 4) {
      const p0 = buf[buf.length - 4]
      const p1 = buf[buf.length - 3]
      const p2 = buf[buf.length - 2]
      const p3 = buf[buf.length - 1]
      const splinePoints = catmullRomSegment(p0, p1, p2, p3, 6)
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

    scheduleRender()
  }, [brush, color, size, opacity, screenToWorld, getPointerPressure, scheduleRender, smoothPoint])

  const endDraw = useCallback((e) => {
    if (e) pointersRef.current.delete(e.pointerId)
    const wasDrawing = drawingRef.current
    if (wasDrawing) setStrokes(s => s + 1)

    // Composite stroke buffer onto tiles
    if (wasDrawing && strokeBufRef.current && strokeBufRef.current.size > 0) {
      const bufBrush = strokeBufBrushRef.current
      const alpha = bufBrush === 'oil' ? OIL_COMPOSITE_ALPHA : WC_COMPOSITE_ALPHA
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
  }, [showToolbar, scheduleHideToolbar, color, size, opacity, scheduleRender])

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
        const scale = Math.min(maxW / img.width, maxH / img.height, 1)
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

  const loadBgFromUrl = useCallback((url) => {
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
      const scale = Math.min(maxW / img.width, maxH / img.height, 1)
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
    }
    img.src = url
  }, [scheduleRender])

  const selectBrush = useCallback((id) => {
    if (id === 'eraser' || id === 'smudge') {
      if (brush !== 'eraser' && brush !== 'smudge') prevBrushRef.current = brush
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
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 40, height: 36, borderRadius: 8, cursor: 'pointer', border: 'none',
    background: brush === id ? C.active : 'transparent',
    color: brush === id ? C.accent : C.dim,
    transition: 'all 0.2s ease',
  })

  const iconBtn = (disabled) => ({
    width: 36, height: 36, borderRadius: 8, border: 'none',
    background: 'transparent', cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: disabled ? '#D2D2D7' : C.dim, transition: 'color 0.2s ease',
  })

  const toolbarPill = {
    display: 'flex', alignItems: 'center', gap: 2,
    padding: '6px 8px', borderRadius: 14,
    background: C.toolbar, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
    boxShadow: '0 2px 20px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.06)',
  }

  const sep = <div style={{ width: 1, height: 24, background: C.sep, flexShrink: 0, margin: '0 4px' }} />

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
        cursor: brush === 'eraser' ? 'cell' : brush === 'smudge' ? 'grab' : 'crosshair',
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
                width: 280, maxHeight: 360, overflowY: 'auto',
                background: C.toolbar, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
                borderRadius: 14, padding: 12,
                boxShadow: '0 8px 40px rgba(0,0,0,0.15), 0 0 0 0.5px rgba(0,0,0,0.08)',
              }}>
                {['Mandala', 'Mayan'].map(cat => (
                  <div key={cat}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: C.dim, fontFamily: MONO, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6, marginTop: cat !== 'Mandala' ? 10 : 0 }}>{cat}</div>
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
                          <img src={page.src} alt={page.label} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 5 }} />
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
                  {BRUSH_ICONS[b.id]}
                </button>
              ))}
            </div>

            {sep}

            {/* Size */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                  width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', flexShrink: 0,
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
