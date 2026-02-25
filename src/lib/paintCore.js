// Shared math/texture helpers for brush engines.

// Non-linear mapping: soft start, fast ramp mid-range, plateau at top
const PRESSURE_CURVE = [
  { in: 0.0, out: 0.0 },
  { in: 0.1, out: 0.2 },
  { in: 0.3, out: 0.42 },
  { in: 0.5, out: 0.62 },
  { in: 0.75, out: 0.86 },
  { in: 1.0, out: 1.0 },
]

export function mapPressure(raw) {
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

export function clamp01(v) {
  return Math.max(0, Math.min(1, v))
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  }
}

function rgbToKS(r, g, b) {
  const R = r / 255
  const G = g / 255
  const B = b / 255
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

export function mixPigments(c1, c2, ratio) {
  const ks1 = rgbToKS(c1.r, c1.g, c1.b)
  const ks2 = rgbToKS(c2.r, c2.g, c2.b)
  return ksToRgb(
    ks1.r * ratio + ks2.r * (1 - ratio),
    ks1.g * ratio + ks2.g * (1 - ratio),
    ks1.b * ratio + ks2.b * (1 - ratio),
  )
}

export function catmullRomSegment(p0, p1, p2, p3, segments) {
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

const GRAIN_SIZE = 256
let grainData = null

function getGrainData() {
  if (grainData) return grainData
  grainData = new Float32Array(GRAIN_SIZE * GRAIN_SIZE)
  for (let i = 0; i < GRAIN_SIZE * GRAIN_SIZE; i++) {
    grainData[i] = Math.random() * 0.4 + 0.3
  }
  return grainData
}

export function sampleGrain(wx, wy) {
  const data = getGrainData()
  const gx = ((Math.floor(wx) % GRAIN_SIZE) + GRAIN_SIZE) % GRAIN_SIZE
  const gy = ((Math.floor(wy) % GRAIN_SIZE) + GRAIN_SIZE) % GRAIN_SIZE
  return data[gy * GRAIN_SIZE + gx]
}

export function getSplineConfig(brushId, isPen) {
  if (brushId === 'inkwash') {
    return isPen ? { min: 3, max: 10, divisor: 2.8 } : { min: 2, max: 8, divisor: 3.2 }
  }
  if (brushId === 'felt') {
    return isPen ? { min: 4, max: 12, divisor: 2.4 } : { min: 3, max: 10, divisor: 2.8 }
  }
  if (brushId === 'watercolor' || brushId === 'watercolor2') {
    return isPen ? { min: 5, max: 14, divisor: 2.2 } : { min: 4, max: 12, divisor: 2.6 }
  }
  return isPen ? { min: 6, max: 18, divisor: 1.9 } : { min: 5, max: 14, divisor: 2.2 }
}

export function cloneCanvas(source) {
  const c = document.createElement('canvas')
  c.width = source.width
  c.height = source.height
  c.getContext('2d').drawImage(source, 0, 0)
  return c
}
