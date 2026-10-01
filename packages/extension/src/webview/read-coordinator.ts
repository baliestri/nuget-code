import type { ReadFlow } from "#contracts";

/** Host-only read identity; signals are never serialized to the webview. */
export interface ReadTicket {
  readonly flow: ReadFlow;
  readonly contextKey: string;
  readonly sequence: number;
  readonly signal: AbortSignal;
}

/** A replaced or cancelled read cannot publish results or finish its successor's loading state. */
export class ReadCoordinator {
  private readonly sequences = new Map<ReadFlow, number>();
  private readonly active = new Map<
    ReadFlow,
    { ticket: ReadTicket; controller: AbortController }
  >();
  private disposed = false;
  begin(flow: ReadFlow, contextKey: string): ReadTicket {
    if (this.disposed) throw new Error("Read coordinator is disposed.");
    this.cancel(flow);
    const sequence = (this.sequences.get(flow) ?? 0) + 1;
    this.sequences.set(flow, sequence);
    const controller = new AbortController();
    const ticket = Object.freeze({
      flow,
      contextKey,
      sequence,
      signal: controller.signal,
    });
    this.active.set(flow, { ticket, controller });
    return ticket;
  }
  isCurrent(ticket: ReadTicket): boolean {
    const current = this.active.get(ticket.flow)?.ticket;
    return (
      !this.disposed &&
      !ticket.signal.aborted &&
      current?.sequence === ticket.sequence &&
      current.contextKey === ticket.contextKey &&
      current.signal === ticket.signal
    );
  }
  cancel(flow: ReadFlow): void {
    const request = this.active.get(flow);
    this.active.delete(flow);
    request?.controller.abort();
  }
  dispose(): void {
    this.disposed = true;
    for (const flow of this.active.keys()) this.cancel(flow);
  }
}
