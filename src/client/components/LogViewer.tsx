import { useEffect, useRef } from 'react';
import type { JobLogRecord } from '../../shared/types';

export function LogViewer({ logs }: { logs: JobLogRecord[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [logs]);
  return (
    <div ref={ref} style={{ fontFamily: 'monospace', fontSize: 12, background: '#1e1e1e', color: '#d4d4d4', padding: 8, borderRadius: 4, height: 300, overflow: 'auto' }}>
      {logs.map((log) => (
        <div key={log.id} style={{ color: log.stream === 'stderr' ? '#f87171' : log.stream === 'system' ? '#60a5fa' : '#d4d4d4' }}>
          <span style={{ opacity: 0.5 }}>[{log.stream}] </span>{log.message}
        </div>
      ))}
    </div>
  );
}
