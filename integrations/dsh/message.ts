import type { BridgeMessageCommand } from '../../shared/native-bridge';

/** Mirrors the installed SessionController.prompt request/receipt fields. */
export interface PromptController {
  prompt(request: {
    requestId: string;
    sessionId: string;
    mode: 'queue' | 'steer';
    content: Array<{ type: 'text'; text: string }>;
  }, signal: AbortSignal): Promise<{ accepted: true }>;
}

export async function deliverMessage(
  controller: PromptController, command: BridgeMessageCommand, signal: AbortSignal,
): Promise<{ id: string; ok: boolean; error?: string }> {
  try {
    // The bridge command ID is the native durable idempotency key: an ACK retry cannot enqueue twice.
    const receipt = await controller.prompt({ requestId: command.id, sessionId: command.sessionId,
      mode: command.mode, content: [{ type: 'text', text: command.text }] }, signal);
    return { id: command.id, ok: receipt.accepted === true };
  } catch (cause) {
    // The remote error message can contain workspace or prompt content; return only its class.
    return { id: command.id, ok: false, error: cause instanceof Error ? cause.name : 'PromptError' };
  }
}
