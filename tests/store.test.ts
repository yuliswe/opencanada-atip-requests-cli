import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import {
  addRequest,
  findRequest,
  getStoreFilePath,
  loadStore,
  removeRequest,
  updateRequest,
} from '@/utils/store';

describe('store', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'atip-cli-test-'));
    process.env.ATIP_CLI_HOME = tempHome;
  });

  afterEach(() => {
    delete process.env.ATIP_CLI_HOME;
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('stores requests under ATIP_CLI_HOME', () => {
    expect(getStoreFilePath()).toBe(path.join(tempHome, 'requests.json'));
  });

  it('returns an empty store when no file exists', () => {
    expect(loadStore()).toEqual({ nextId: 1, requests: [] });
  });

  it('adds requests with incrementing ids and persists them', () => {
    const first = addRequest({
      kind: 'formal',
      requestNumber: 'A-2026-00001',
      institution: 'Immigration, Refugees and Citizenship Canada',
      summary: 'All notes in my file',
      status: 'submitted',
      url: null,
    });
    const second = addRequest({
      kind: 'informal',
      requestNumber: null,
      institution: null,
      summary: 'Copy of released records',
      status: 'submitted',
      url: null,
    });
    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    const store = loadStore();
    expect(store.nextId).toBe(3);
    expect(store.requests).toHaveLength(2);
  });

  it('finds requests by id and by request number', () => {
    addRequest({
      kind: 'formal',
      requestNumber: 'A-2026-00001',
      institution: 'IRCC',
      summary: 'My file',
      status: 'submitted',
      url: null,
    });
    const store = loadStore();
    expect(findRequest(store, '1')?.requestNumber).toBe('A-2026-00001');
    expect(findRequest(store, 'a-2026-00001')?.id).toBe(1);
    expect(findRequest(store, 'A-9999-99999')).toBeUndefined();
  });

  it('updates status, fields, and appends notes', () => {
    addRequest({
      kind: 'formal',
      requestNumber: null,
      institution: 'IRCC',
      summary: 'My file',
      status: 'submitted',
      url: null,
    });
    const updated = updateRequest({
      ref: '1',
      status: 'acknowledged',
      requestNumber: 'A-2026-00002',
      note: 'Acknowledgement email received',
    });
    expect(updated.status).toBe('acknowledged');
    expect(updated.requestNumber).toBe('A-2026-00002');
    expect(updated.notes).toHaveLength(1);
    expect(updated.notes[0].text).toBe('Acknowledgement email received');
    const reloaded = loadStore();
    expect(reloaded.requests[0].status).toBe('acknowledged');
  });

  it('throws when updating an unknown request', () => {
    expect(() => updateRequest({ ref: '42', status: 'completed' })).toThrow(
      /No tracked request matches "42"/
    );
  });

  it('removes requests without reusing ids', () => {
    addRequest({
      kind: 'formal',
      requestNumber: null,
      institution: null,
      summary: 'First',
      status: 'submitted',
      url: null,
    });
    removeRequest('1');
    const store = loadStore();
    expect(store.requests).toHaveLength(0);
    expect(store.nextId).toBe(2);
  });
});
