import type { PrinterStatus } from '../../shared/interfaces/printer-status';
import { PrinterCard } from './PrinterCard';

interface Props {
  statusByPrinter: Map<string, PrinterStatus>;
}

export function PrinterList({ statusByPrinter }: Props) {
  const printers = [...statusByPrinter.values()];
  if (printers.length === 0) {
    return (
      <section className="printer-list">
        <h2>Drucker</h2>
        <p className="empty">Noch keine Drucker verbunden.</p>
      </section>
    );
  }
  return (
    <section className="printer-list">
      <h2>Drucker ({printers.length})</h2>
      {printers.map((p) => <PrinterCard key={p.printerId} status={p} />)}
    </section>
  );
}
