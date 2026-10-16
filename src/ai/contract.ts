// Design-workbench contract (tjm-wb/0), as served by the TJM-AItool Admin backend
// (`apps/ai-gateway/src/workbench/`). The tool catalog itself lives there.

export const WB_PROTOCOL = 'tjm-wb/0';

export type TaskState =
  | 'created' | 'planning' | 'waiting_model' | 'waiting_asset' | 'waiting_confirmation'
  | 'waiting_client' | 'executing' | 'reviewing' | 'paused' | 'reconciling'
  | 'completed' | 'failed' | 'cancelled';

export const TERMINAL: TaskState[] = ['completed', 'failed', 'cancelled'];

export interface WbError { code: string; message: string; detail?: unknown }

export interface DocTarget { projectRef: string; clientSessionId: string; docId: string; name?: string }

export interface CreateTaskRequest {
  protocol: typeof WB_PROTOCOL;
  requestId: string;
  target: DocTarget;
  observedRevision: number;
  prompt: string;
  model?: string;
  allowedLayers?: number[];
  mode?: { maxModelCalls?: number };
}

export type StepStatus = 'pending' | 'leased' | 'done' | 'failed' | 'uncertain' | 'rejected' | 'skipped';

export interface Step {
  stepId: string;
  callId: string;
  round: number;
  tool: string;
  args: Record<string, unknown>;
  inputDigest: string;
  where: 'client' | 'server';
  status: StepStatus;
  needsConfirmation?: boolean;
  confirmed?: boolean;
  lease?: { id: string; clientSessionId: string; expiresAt: number };
  observedRevision?: number;
  receipt?: Receipt;
  error?: WbError;
}

export interface PreviewRef {
  revision: number;
  dataUrl: string;
  width: number;
  height: number;
  region: { x: number; y: number; w: number; h: number };
  scale: number;
}

export interface Receipt {
  taskId: string;
  runId: string;
  stepId: string;
  callId: string;
  leaseId: string;
  inputDigest: string;
  docId: string;
  revisionBefore: number;
  revisionAfter: number;
  status: 'ok' | 'error';
  result?: unknown;
  error?: WbError;
  affectedLayers?: number[];
  preview?: PreviewRef;
  assets?: string[];
}

export interface TaskEvent { seq: number; at: number; type: string; message: string; data?: any }

/** Workflow gate: analysis → asset check → skill match must happen before any edit. */
export interface Phases { analyze: boolean; assets: boolean; skills: boolean }

export interface TaskSummary {
  id: string;
  runId: string;
  parentTaskId?: string;
  ownerId: string;
  state: TaskState;
  prompt: string;
  target: DocTarget;
  allowedLayers?: number[];
  observedRevision: number;
  pinned: { model: string; providerProtocol: string; mock: boolean };
  phases: Phases;
  analysis: { goal: string; deliverable?: string; constraints?: string[]; keepUnchanged?: string[]; neededAssets?: string[] } | null;
  skill: { slug: string; version: number; name: string; tools: string[] } | null;
  budget: { modelCalls: number; modelCallsUsed: number; generations: number; generationsUsed: number; steps: number; stepsUsed: number };
  steps: Step[];
  attempts: { id: string; purpose: string; model: string; mock: boolean; status: string }[];
  lastSeq: number;
  resultText?: string;
  error?: WbError;
  createdAt: number;
  updatedAt: number;
}

export interface Site { id: string; name: string; url: string; note?: string }

export interface Capabilities {
  protocol: typeof WB_PROTOCOL;
  mode: 'official';
  mock: boolean;
  aiEnabled: boolean;
  reason?: string;
  model: string | null;
  models?: { agent: ModelOption[]; image: ModelOption[] };
  imageEnabled?: boolean;
  /** 生图 output controls the backend accepts (sent as response_format). */
  imageOptions?: { aspectRatios: string[]; imageSizes: string[] };
  verified: boolean;
  tools: { name: string; kind: string; risk: string }[];
  limits: Record<string, number>;
  sites: Site[];
  closed: string[];
}

export interface AssetRecord {
  id: string;
  kind: 'upload' | 'generated' | 'web';
  name: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  alphaChannel: boolean;
  source: { site?: string; url?: string; license?: string; styleName?: string | null; prompt?: string; mock?: boolean };
  createdAt: string;
}

export interface GenerationRecord {
  id: string;
  status: 'running' | 'succeeded' | 'failed' | 'uncertain';
  sent: { model: string; mock: boolean; styleId: number | null; styleName: string | null };
  notes: string[];
  assetIds: string[];
  error?: WbError;
}

export interface PublicStyle { id: number; name: string; description: string; coverUrl: string | null; tags?: { id: number; name: string }[] }
export interface ModelOption { id: string; label: string; provider: string; supportsText?: boolean; supportsReferences?: boolean }
