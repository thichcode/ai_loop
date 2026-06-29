export function DiffViewer({ diff }: { diff: string }) {
  if (!diff) return <div style={{ color: '#9ca3af', padding: 8 }}>No diff available</div>;
  return (
    <pre style={{ fontFamily: 'monospace', fontSize: 12, background: '#0d1117', color: '#e6edf3', padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 400, margin: 0 }}>
      {diff}
    </pre>
  );
}
