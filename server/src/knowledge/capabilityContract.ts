export interface CapabilityEvidenceContract {
  input: string;
  output: string;
  dependencies: string;
  freshness: string;
  provenance: string;
  whenUnavailable: string;
}

export const CAPABILITY_READ_CONTRACT = {
  trigger: 'Leader background pass (scheduled every 60 seconds)',
  permission: 'READ_ONLY',
  maxRuntimeMs: null,
} as const;
