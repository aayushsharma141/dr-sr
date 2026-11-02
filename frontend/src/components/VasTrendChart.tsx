import type { TreatmentSessionOut } from '../api/types'

interface VasTrendChartProps {
  sessions: TreatmentSessionOut[]
}

export function VasTrendChart({ sessions }: VasTrendChartProps) {
  if (sessions.length === 0) return null

  const width = 500
  const height = 150
  const paddingX = 40
  const paddingY = 25

  const chartWidth = width - paddingX * 2
  const chartHeight = height - paddingY * 2

  // Map sessions to x, y coordinates
  const points = sessions.map((sess, idx) => {
    const x =
      sessions.length === 1
        ? paddingX + chartWidth / 2
        : paddingX + (idx / (sessions.length - 1)) * chartWidth
    // vas_score 0 is bottom (y = height - paddingY), 10 is top (y = paddingY)
    const y = paddingY + chartHeight - (sess.vas_score / 10) * chartHeight
    return { ...sess, x, y }
  })

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-2">
      <div className="flex justify-between items-center">
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700">
          VAS Pain Trend Across Sessions (दर्द में सुधार का ग्राफ़)
        </h4>
        <span className="text-[11px] text-gray-500 font-medium">Visual Analog Scale (0–10)</span>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full max-w-lg mx-auto overflow-visible select-none"
        >
          {/* Horizontal Gridlines */}
          {[0, 2, 4, 6, 8, 10].map((score) => {
            const y = paddingY + chartHeight - (score / 10) * chartHeight
            return (
              <g key={score}>
                <line
                  x1={paddingX}
                  y1={y}
                  x2={width - paddingX}
                  y2={y}
                  stroke="#e5e7eb"
                  strokeDasharray={score === 0 ? undefined : '2,2'}
                  strokeWidth="1"
                />
                <text
                  x={paddingX - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="9"
                  fill="#9ca3af"
                  fontFamily="monospace"
                >
                  {score}
                </text>
              </g>
            )
          })}

          {/* Trend Polyline */}
          {sessions.length > 1 && (
            <polyline
              fill="none"
              stroke="#0f766e"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={polylinePoints}
            />
          )}

          {/* Points & Data Labels */}
          {points.map((p) => (
            <g key={p.id}>
              <circle cx={p.x} cy={p.y} r="5" fill="#0f766e" stroke="#ffffff" strokeWidth="2" />
              <text
                x={p.x}
                y={p.y - 8}
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fill="#0f766e"
              >
                {p.vas_score}
              </text>
              <text
                x={p.x}
                y={height - 6}
                textAnchor="middle"
                fontSize="9"
                fill="#6b7280"
                fontFamily="monospace"
              >
                S#{p.session_number}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  )
}

