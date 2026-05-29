/**
 * Hex color input bound to a labeled field of styleSchema.
 */
export default function ColorPicker({ label, value, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer bg-transparent border border-slate-300"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-20 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs font-mono text-slate-900"
        />
      </div>
    </label>
  )
}
