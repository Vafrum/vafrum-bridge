import type { PrinterStatus } from '../../shared/interfaces/printer-status';
import type { KnownPrinter } from '../App';
import { PrinterCard } from './PrinterCard';

interface Props {
  knownPrinters: Map<string, KnownPrinter>;
  statusByPrinter: Map<string, PrinterStatus>;
}

export function PrinterList({ knownPrinters, statusByPrinter }: Props) {
  const list = [...knownPrinters.values()];
  if (list.length === 0) {
    return (
      <section className="printer-list">
        <h2>Drucker</h2>
        <p className="empty">Noch keine Drucker verbunden.</p>
      </section>
    );
  }
  return (
    <section className="printer-list">
      <h2>Drucker ({list.length})</h2>
      {list.map((known) => (
        <PrinterCard
          key={known.printerId}
          known={known}
          status={statusByPrinter.get(known.printerId) ?? null}
        />
      ))}
    </section>
  );
}
