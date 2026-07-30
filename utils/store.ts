import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getEnv } from '@/utils/env';

export const TRACKED_STATUSES = [
  'submitted',
  'acknowledged',
  'in-progress',
  'extended',
  'records-ready',
  'completed',
  'abandoned',
] as const;

export type TrackedStatus = (typeof TRACKED_STATUSES)[number];

export type RequestKind = 'formal' | 'informal';

export type TrackedNote = {
  at: string;
  text: string;
};

export type TrackedRequest = {
  id: number;
  kind: RequestKind;
  requestNumber: string | null;
  institution: string | null;
  summary: string;
  status: TrackedStatus;
  url: string | null;
  createdAt: string;
  updatedAt: string;
  notes: TrackedNote[];
};

export type RequestStore = {
  nextId: number;
  requests: TrackedRequest[];
};

export function isTrackedStatus(value: string): value is TrackedStatus {
  return (TRACKED_STATUSES as readonly string[]).includes(value);
}

export function getStoreFilePath(): string {
  const home = getEnv().ATIP_CLI_HOME ?? path.join(os.homedir(), '.atip-cli');
  return path.join(home, 'requests.json');
}

export function loadStore(): RequestStore {
  const file = getStoreFilePath();
  if (!fs.existsSync(file)) {
    return { nextId: 1, requests: [] };
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as RequestStore;
}

export function saveStore(store: RequestStore): void {
  const file = getStoreFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, file);
}

export function findRequest(
  store: RequestStore,
  ref: string
): TrackedRequest | undefined {
  const id = Number.parseInt(ref, 10);
  if (Number.isFinite(id) && String(id) === ref.trim()) {
    return store.requests.find(request => request.id === id);
  }
  const wanted = ref.trim().toLowerCase();
  return store.requests.find(
    request => request.requestNumber?.toLowerCase() === wanted
  );
}

export function requireRequest(
  store: RequestStore,
  ref: string
): TrackedRequest {
  const request = findRequest(store, ref);
  if (!request) {
    throw new Error(
      `No tracked request matches "${ref}". Run "atip request list" to see IDs.`
    );
  }
  return request;
}

export function addRequest(fields: {
  institution: string | null;
  kind: RequestKind;
  requestNumber: string | null;
  status: TrackedStatus;
  summary: string;
  url: string | null;
}): TrackedRequest {
  const store = loadStore();
  const now = new Date().toISOString();
  const request: TrackedRequest = {
    ...fields,
    id: store.nextId,
    createdAt: now,
    updatedAt: now,
    notes: [],
  };
  store.nextId += 1;
  store.requests.push(request);
  saveStore(store);
  return request;
}

export function updateRequest(params: {
  ref: string;
  institution?: string;
  note?: string;
  requestNumber?: string;
  status?: TrackedStatus;
  summary?: string;
}): TrackedRequest {
  const store = loadStore();
  const request = requireRequest(store, params.ref);
  const now = new Date().toISOString();
  if (params.status) {
    request.status = params.status;
  }
  if (params.requestNumber !== undefined) {
    request.requestNumber = params.requestNumber || null;
  }
  if (params.institution !== undefined) {
    request.institution = params.institution || null;
  }
  if (params.summary !== undefined) {
    request.summary = params.summary;
  }
  if (params.note) {
    request.notes.push({ at: now, text: params.note });
  }
  request.updatedAt = now;
  saveStore(store);
  return request;
}

export function removeRequest(ref: string): TrackedRequest {
  const store = loadStore();
  const request = requireRequest(store, ref);
  store.requests = store.requests.filter(other => other.id !== request.id);
  saveStore(store);
  return request;
}
