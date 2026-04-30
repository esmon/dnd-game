// Floating label that sits on the panel's top border (à la a fieldset
// legend). Background matches the page so the dark border line is
// visually cut where the label overlays it. Caller's wrapping panel must
// be `relative`.
export function PanelLabel({ children }: { children: string }) {
  return (
    <span className="absolute -top-3 left-3 bg-background px-1.5 font-mono text-sm font-bold uppercase tracking-widest">
      {children}
    </span>
  );
}
