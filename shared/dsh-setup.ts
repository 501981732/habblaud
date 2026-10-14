export type DshSetupState =
  | 'ready'
  | 'connecting'
  | 'connected'
  | 'installed'
  | 'disabled'
  | 'unavailable'
  | 'error';

export type DshSetupError =
  | 'dsh-not-found'
  | 'bridge-not-built'
  | 'profile-not-found'
  | 'different-source'
  | 'install-failed'
  | 'enable-failed'
  | 'setup-disabled';

export interface DshSetupProfile {
  name: string;
  installed: boolean;
  enabled: boolean;
}

export interface DshSetupStatus {
  state: DshSetupState;
  profile: string;
  profiles: DshSetupProfile[];
  canConnect: boolean;
  connected: boolean;
  autostart: boolean;
  error?: DshSetupError;
}

export interface DshSetupPort {
  status(profile?: string): DshSetupStatus;
  connect(profile?: string): Promise<DshSetupStatus>;
}
