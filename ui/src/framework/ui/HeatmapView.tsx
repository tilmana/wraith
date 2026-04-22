import { useEffect, useRef, useState, useCallback } from 'react'

// ─── Public types (importable by modules) ─────────────────────────────────────

export interface HeatPoint { x: number; y: number; buttons?: number; t?: number }
export interface HeatClick { x: number; y: number; button?: number; t?: number }
export interface HeatScreen {
  innerWidth?:  number
  innerHeight?: number
  width?:       number
  height?:      number
}

export interface HeatmapViewProps {
  points:       HeatPoint[]
  clicks?:      HeatClick[]           // optional — omit if the module has no click concept
  screenSize?:  HeatScreen | null
  cursorPos?:   HeatPoint | null      // replay cursor dot
  pointRadius?: number                // density spread per point (default 12)
  cutoffTime?:  number                // replay cutoff — only draw overlays up to this timestamp
}

// ─── Internal constants ───────────────────────────────────────────────────────

const CANVAS_W = 560
const CLICK_R  = 10

function heatColor(a: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0,   [20,  20,  80 ]],
    [60,  [0,   80,  220]],
    [110, [0,   200, 180]],
    [160, [80,  220, 0  ]],
    [200, [255, 200, 0  ]],
    [230, [255, 80,  0  ]],
    [255, [255, 0,   0  ]],
  ]
  for (let i = 0; i < stops.length - 1; i++) {
    const [lo, cLo] = stops[i]
    const [hi, cHi] = stops[i + 1]
    if (a <= hi) {
      const t = (a - lo) / (hi - lo)
      return [
        Math.round(cLo[0] + t * (cHi[0] - cLo[0])),
        Math.round(cLo[1] + t * (cHi[1] - cLo[1])),
        Math.round(cLo[2] + t * (cHi[2] - cLo[2])),
      ]
    }
  }
  return [255, 0, 0]
}

// Density pass: returns offscreen ctx + the max alpha found (used for auto-scale)
function buildDensity(
  points: HeatPoint[],
  W: number, H: number,
  sX: number, sY: number,
  pointRadius: number,
) {
  const off = document.createElement('canvas')
  off.width  = W
  off.height = H
  const ctx = off.getContext('2d')!
  for (const { x, y } of points) {
    const px  = x * sX
    const py  = y * sY
    const grd = ctx.createRadialGradient(px, py, 0, px, py, pointRadius)
    grd.addColorStop(0, 'rgba(255,255,255,0.07)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grd
    ctx.fillRect(px - pointRadius, py - pointRadius, pointRadius * 2, pointRadius * 2)
  }
  const raw = ctx.getImageData(0, 0, W, H)
  let maxAlpha = 0
  for (let i = 3; i < raw.data.length; i += 4) {
    if (raw.data[i] > maxAlpha) maxAlpha = raw.data[i]
  }
  return { ctx, raw, maxAlpha }
}

// buttons bitmask → rgb string (left=1, right=2, middle=4)
function dragColor(buttons: number): string {
  if (buttons & 1) return '255,255,255'
  if (buttons & 2) return '255,140,0'
  if (buttons & 4) return '0,210,255'
  return '255,255,255'
}

// Cheap: composite cached base + cursor dot — no density recomputation
function drawCursor(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  cursorPos: HeatPoint,
  vpW: number,
  vpH: number,
) {
  const sX = base.width  / vpW
  const sY = base.height / vpH
  ctx.clearRect(0, 0, base.width, base.height)
  ctx.drawImage(base, 0, 0)
  const cx = cursorPos.x * sX
  const cy = cursorPos.y * sY
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx, cy, 9, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth   = 1.5
  ctx.stroke()
}

// ─── Toggle pill (reusable within this component) ────────────────────────────

function Pill({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2 py-0.5 rounded-full border transition-colors whitespace-nowrap ${
        active ? 'border-accent text-accent' : 'border-border text-muted hover:text-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HeatmapView({
  points,
  clicks      = [],
  screenSize,
  cursorPos,
  pointRadius = 12,
  cutoffTime,
}: HeatmapViewProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const baseRef    = useRef<HTMLCanvasElement | null>(null)  // cached composite without cursor
  const baseRafRef = useRef<number | null>(null)
  const curRafRef  = useRef<number | null>(null)

  const [zoom,        setZoom]        = useState(1)
  const [autoScale,   setAutoScale]   = useState(false)
  const [frozenScale, setFrozenScale] = useState<number | null>(null)
  const [showPath,    setShowPath]    = useState(true)
  const [showDrags,   setShowDrags]   = useState(true)

  const vpW      = screenSize?.innerWidth  ?? screenSize?.width  ?? 1280
  const vpH      = screenSize?.innerHeight ?? screenSize?.height ?? 800
  const canvasH  = Math.round(CANVAS_W * (vpH / vpW)) || Math.round(CANVAS_W * 9 / 16)
  const displayW = Math.round(CANVAS_W * zoom)

  const getScale = useCallback((): number => {
    if (autoScale) {
      const { maxAlpha } = buildDensity(points, CANVAS_W, canvasH, CANVAS_W / vpW, canvasH / vpH, pointRadius)
      return maxAlpha > 0 ? 255 / maxAlpha : 4
    }
    return frozenScale ?? 4
  }, [autoScale, frozenScale, points, vpW, vpH, canvasH, pointRadius])

  function recalibrate() {
    const { maxAlpha } = buildDensity(points, CANVAS_W, canvasH, CANVAS_W / vpW, canvasH / vpH, pointRadius)
    setFrozenScale(maxAlpha > 0 ? 255 / maxAlpha : 4)
    setAutoScale(false)
  }

  // Track the last points count that triggered a full density rebuild.
  // The caller passes the full point set always; cutoffTime controls which
  // points are visible for overlays. Density only rebuilds when new data
  // arrives (live) or display settings change — never during replay scrub.
  const densityRef   = useRef<HTMLCanvasElement | null>(null)
  const densityNRef  = useRef(0)  // points count at last density build
  const densityOptsRef = useRef('')

  // Heavy effect: rebuild base canvas when data or display options change.
  // During replay we skip density recomputation if the underlying dataset
  // hasn't grown — only path/clicks/drags need to be redrawn.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (baseRafRef.current !== null) cancelAnimationFrame(baseRafRef.current)
    baseRafRef.current = requestAnimationFrame(() => {
      const W  = canvas.width
      const H  = canvas.height
      const sX = W / vpW
      const sY = H / vpH
      const scale = getScale()

      // Reuse cached density bitmap when point count hasn't grown past the
      // high-water mark. During replay the filtered array shrinks and re-grows
      // but no new data has arrived — density doesn't change.
      const optsKey = `${autoScale}:${frozenScale}:${pointRadius}:${W}:${H}`
      const needDensity = points.length > densityNRef.current || optsKey !== densityOptsRef.current

      let densityCanvas: HTMLCanvasElement
      if (needDensity) {
        const { ctx: offCtx, raw } = buildDensity(points, W, H, sX, sY, pointRadius)
        const data = raw.data
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3]
          if (alpha === 0) continue
          const scaled = Math.min(alpha * scale, 255)
          const [r, g, b] = heatColor(scaled)
          data[i]     = r
          data[i + 1] = g
          data[i + 2] = b
          data[i + 3] = Math.min(scaled * (220 / 255), 220)
        }
        offCtx.putImageData(raw, 0, 0)
        densityCanvas = offCtx.canvas
        densityRef.current  = densityCanvas
        densityNRef.current = points.length
        densityOptsRef.current = optsKey
      } else {
        densityCanvas = densityRef.current!
      }

      // Compute visible count: when cutoffTime is set, only draw overlays up to that time.
      // Points are sorted by t — find the first past the cutoff.
      let visibleCount = points.length
      if (cutoffTime != null) {
        for (let i = 0; i < points.length; i++) {
          if ((points[i].t ?? 0) > cutoffTime) { visibleCount = i; break }
        }
      }

      // Build the base layer: density + overlays
      const base    = document.createElement('canvas')
      base.width    = W
      base.height   = H
      const ctx     = base.getContext('2d')!
      ctx.drawImage(densityCanvas, 0, 0)

      // Path overlay
      if (showPath && visibleCount > 1) {
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(points[0].x * sX, points[0].y * sY)
        for (let i = 1; i < visibleCount; i++) {
          ctx.lineTo(points[i].x * sX, points[i].y * sY)
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.lineWidth   = 0.8
        ctx.lineJoin    = 'round'
        ctx.stroke()
        ctx.restore()
      }

      // Drag segments
      if (showDrags) {
        let i = 0
        while (i < visibleCount) {
          const btns = points[i].buttons ?? 0
          if (btns === 0) { i++; continue }
          const color = dragColor(btns)
          const start = i
          while (i < visibleCount && (points[i].buttons ?? 0) === btns) i++
          const end = i
          ctx.save()
          ctx.strokeStyle = `rgba(${color},0.75)`
          ctx.lineWidth   = 2.5
          ctx.lineCap     = 'round'
          ctx.lineJoin    = 'round'
          ctx.beginPath()
          ctx.moveTo(points[start].x * sX, points[start].y * sY)
          for (let j = start + 1; j < end; j++) {
            ctx.lineTo(points[j].x * sX, points[j].y * sY)
          }
          ctx.stroke()
          for (const idx of [start, end - 1]) {
            ctx.beginPath()
            ctx.arc(points[idx].x * sX, points[idx].y * sY, 3, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(${color},0.9)`
            ctx.fill()
          }
          ctx.restore()
        }
      }

      // Click markers (filter by cutoffTime when set)
      for (const { x, y, button, t } of clicks) {
        if (cutoffTime != null && (t ?? 0) > cutoffTime) continue
        const cx    = x * sX
        const cy    = y * sY
        const color = button === 2 ? '255,140,0' : button === 1 ? '0,210,255' : '255,255,255'
        ctx.beginPath()
        ctx.arc(cx, cy, CLICK_R, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${color},0.95)`
        ctx.lineWidth   = 2
        ctx.stroke()
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, CLICK_R)
        grd.addColorStop(0, `rgba(${color},0.35)`)
        grd.addColorStop(1, `rgba(${color},0)`)
        ctx.fillStyle = grd
        ctx.fill()
      }

      baseRef.current = base

      // Composite onto visible canvas
      const visCtx = canvas.getContext('2d')!
      if (cursorPos) {
        drawCursor(visCtx, base, cursorPos, vpW, vpH)
      } else {
        visCtx.clearRect(0, 0, W, H)
        visCtx.drawImage(base, 0, 0)
      }
      baseRafRef.current = null
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length, clicks.length, vpW, vpH, autoScale, frozenScale, showPath, showDrags, pointRadius, cutoffTime])

  // Cheap effect: composite cached base + cursor dot — skips density recomputation
  useEffect(() => {
    const canvas = canvasRef.current
    const base   = baseRef.current
    if (!canvas || !base) return
    if (curRafRef.current !== null) cancelAnimationFrame(curRafRef.current)
    curRafRef.current = requestAnimationFrame(() => {
      const ctx = canvas.getContext('2d')!
      if (cursorPos) {
        drawCursor(ctx, base, cursorPos, vpW, vpH)
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(base, 0, 0)
      }
      curRafRef.current = null
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorPos?.x, cursorPos?.y])

  const isEmpty     = points.length === 0 && clicks.length === 0
  const hasClicks   = clicks.length > 0
  const isCalibrated = frozenScale !== null && !autoScale

  return (
    <div className="space-y-2">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Heatmap</p>
        <div className="flex items-center gap-2 flex-wrap">
          <Pill active={showPath}  onClick={() => setShowPath(p => !p)}>movement path</Pill>
          <Pill active={showDrags} onClick={() => setShowDrags(p => !p)}>drag segments</Pill>
          <Pill active={autoScale} onClick={() => { setAutoScale(p => !p); setFrozenScale(null) }}>
            auto-scale
          </Pill>
          <button
            onClick={recalibrate}
            disabled={points.length === 0}
            title="Lock colour scale to current density range"
            className="text-xs px-2 py-0.5 rounded border transition-colors disabled:opacity-40 border-border text-muted hover:text-gray-300"
          >
            {isCalibrated ? 'recalibrated ×' : 'recalibrate'}
          </button>
          {isCalibrated && (
            <button
              onClick={() => setFrozenScale(null)}
              className="text-xs text-muted hover:text-gray-300 -ml-1"
              title="Clear calibration"
            >×</button>
          )}

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted">zoom</span>
            <input
              type="range" min={0.5} max={2.5} step={0.25} value={zoom}
              onChange={e => setZoom(Number(e.target.value))}
              className="w-20 accent-accent"
            />
            <span className="text-xs text-muted w-7 tabular-nums">{zoom}×</span>
          </div>

          <span className="text-xs text-muted">
            {points.length.toLocaleString()} moves
            {hasClicks ? ` · ${clicks.length} click${clicks.length === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        className="rounded border border-border overflow-hidden bg-[#08080f]"
        style={{ width: displayW, lineHeight: 0 }}
      >
        {isEmpty ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted" style={{ width: displayW }}>
            no data yet
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={canvasH}
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
        )}
      </div>

      {/* ── Legend ── */}
      {!isEmpty && (
        <div className="flex items-center gap-2 flex-wrap" style={{ maxWidth: displayW }}>
          <span className="text-xs text-muted">sparse</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden min-w-16" style={{
            background: 'linear-gradient(to right, rgb(20,20,80), rgb(0,80,220), rgb(0,200,180), rgb(80,220,0), rgb(255,200,0), rgb(255,80,0), rgb(255,0,0))'
          }} />
          <span className="text-xs text-muted">dense</span>
          {hasClicks && (
            <>
              <span className="ml-2 text-xs text-muted">● left</span>
              <span className="text-xs" style={{ color: 'rgb(0,210,255)' }}>● mid</span>
              <span className="text-xs" style={{ color: 'rgb(255,140,0)' }}>● right</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
