import type {
  ExtensionToWebviewMessage,
  PackageManagerOperationKind,
  PackageManagerOperationMessage,
} from "#contracts";
import type { ExtensionLogger } from "#extension/logger";

export class PackageManagerOperationRunner {
  private sequence = 0;

  constructor(
    private readonly logger: ExtensionLogger,
    private readonly publish: (message: ExtensionToWebviewMessage) => void,
  ) {}

  async run(
    kind: PackageManagerOperationKind,
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    const operation = this.start(kind, label);

    try {
      this.logger.information("vscode", label);
      await action();
      this.finish(operation);
    } catch (error) {
      this.fail(operation, error);
      throw error;
    }
  }

  start(
    kind: PackageManagerOperationKind,
    label: string,
    requestId?: number,
  ): PackageManagerOperationMessage {
    const operation = {
      operationId: String(++this.sequence),
      kind,
      label,
      requestId,
    };

    this.publish({ type: "operationStarted", ...operation });
    return operation;
  }

  finish(operation: PackageManagerOperationMessage): void {
    this.publish({ type: "operationFinished", ...operation });
  }

  fail(operation: PackageManagerOperationMessage, error: unknown): void {
    this.publish({
      type: "operationFailed",
      ...operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
