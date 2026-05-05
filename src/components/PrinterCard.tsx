import { useState } from 'react';
import type { PrinterStatus } from '../../shared/interfaces/printer-status';

interface Props {
  status: PrinterStatus;
}

export function PrinterCard({ status }: Props) {
  const [open, setOpen] = useState(false);
  const stateClass =
    status.gcodeState === 'RUNNING' ? 'running'
      : status.gcodeState === 'PAUSE' ? 'paused'
      : status.gcodeState === 'FAILED' ? 'failed'
      : 'idle';

  const modelLabel = status.modelFamily ?? status.modelClass ?? '?';

  return (
    <div className="printer-card">
      <header>
        <strong>{status.serialNumber}</strong>
        <span className="model">{modelLabel}</span>
        <span className={`state ${stateClass}`}>{status.gcodeState ?? 'UNKNOWN'}</span>
        <span className={status.online ? 'ok' : 'off'}>{status.online ? '● online' : '○ offline'}</span>
      </header>
      <div className="metrics">
        <div>Progress: {status.printProgress ?? 0}%</div>
        <div>Layer: {status.layer ?? 0} / {status.totalLayers ?? 0}</div>
        <div>Nozzle: {status.nozzleTemp ?? 0}°C / {status.nozzleTargetTemp ?? 0}°C</div>
        <div>Bed: {status.bedTemp ?? 0}°C / {status.bedTargetTemp ?? 0}°C</div>
        <div>Chamber: {status.chamberTemp ?? 0}°C</div>
        <div>File: {status.currentFile ?? '-'}</div>
      </div>
      <button onClick={() => setOpen(!open)}>{open ? 'Weniger' : 'Alle Details'}</button>
      {open && (
        <pre className="details">{JSON.stringify(status, null, 2)}</pre>
      )}
    </div>
  );
}
