import type { Activity, AgentCapabilities, AgentStats, AgentStatus, MessageRef, TerminalEntry } from './types';

/** Native adapters never masquerade as another runtime. Version changes require an explicit handshake. */
export const BRIDGE_VERSION = 1 as const;
export type NativeProvider = 'dsh' | 'pi';

export interface BridgeSession {
  sessionId: string;
  /** A stable, non-secret label for this runtime's configuration directory. */
  account: string;
  cwd: string;
  /** Pi's native session file, used only after validation against configured session roots. */
  sessionFile?: string;
  startedAt: number;
  status: AgentStatus;
  model?: string;
  title?: string;
  parentSessionId?: string;
  role?: string;
  waitingFor?: string;
  waitingForI18n?: MessageRef;
  stats?: Partial<AgentStats>;
  capabilities?: AgentCapabilities;
}

export type BridgeEvent =
  | { type: 'session'; session: BridgeSession; historical?: boolean }
  | { type: 'status'; sessionId: string; status: AgentStatus; waitingFor?: string; waitingForI18n?: MessageRef; model?: string; stats?: Partial<AgentStats> }
  | { type: 'activity'; sessionId: string; activity: Activity; historical?: boolean }
  | { type: 'terminal'; sessionId: string; entries: TerminalEntry[]; reset?: boolean; truncated?: boolean }
  | { type: 'closed'; sessionId: string }
  | { type: 'heartbeat' };

export interface BridgeEnvelope {
  version: typeof BRIDGE_VERSION;
  provider: NativeProvider;
  instanceId: string;
  /** Increasing per adapter instance, not per session; retries retain the same sequence. */
  seq: number;
  events: BridgeEvent[];
}

export interface BridgeMessageCommand {
  id: string;
  sessionId: string;
  text: string;
  mode: 'queue' | 'steer';
}

export interface BridgePoll {
  messages: BridgeMessageCommand[];
  viewers: number;
  permissions: boolean;
  messaging: boolean;
}

export interface BridgePermission {
  sessionId: string;
  tool: string;
  input?: unknown;
  callId?: string;
  reason?: string;
  timeoutMs?: number;
}

export type BridgePermissionResult =
  | { behavior: 'allow' | 'deny'; message?: string }
  | { behavior: 'terminal' | 'cancelled' };

export interface BridgeConnectionConfig {
  version: typeof BRIDGE_VERSION;
  url: string;
  token: string;
}
