// Shared label/value row used by PlayerPanel and MonsterCard.
// `items-start` + `text-right` keeps the label aligned to the top line of a
// wrapping value (e.g. monster DMG "1d6+1\nbludgeoning").
export function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm tabular-nums">
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
