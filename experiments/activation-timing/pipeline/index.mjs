import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'acorn';

const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
export const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');
const copy = value => structuredClone(value);
const required = (v, name) => { if (typeof v !== 'string' || !v.trim() || Object.hasOwn(Object.prototype, v) || v === 'prototype') throw new TypeError(`${name} required`); };
const eventId = e => `${e.sourceId}:${e.seq}`;
function requestedTools(code) {
  if (typeof code !== 'string') return [];
  try {
    const ast = parse(code, { ecmaVersion: 'latest', allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true });
    const names = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression'
        && node.callee.object?.type === 'Identifier' && node.callee.object.name === 'tools') {
        const key = node.callee.computed ? node.callee.property.value : node.callee.property.name;
        if (typeof key === 'string') names.push(key);
      }
      for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else walk(value);
    }
    walk(ast); return names;
  } catch { return []; }
}
const content = c => ({ id: c.id, version: c.version, sourceFingerprint: c.sourceFingerprint,
  contractFingerprint: c.contractFingerprint, applicability: c.applicability, instruction: c.instruction });

/** Isolated, synchronous single-writer experiment ledger. No production memory API. */
export class ActivationLearningPipeline {
  constructor({ directory, verifyHumanReceipt = null }) {
    required(directory, 'directory');
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, 'learning-ledger.json');
    this.verifyHumanReceipt = verifyHumanReceipt;
    this.state = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8'))
      : { schemaVersion: 1, sources: {}, candidates: {}, reviews: [], withdrawals: [] };
    if (this.state.schemaVersion !== 1) throw new Error('Unsupported ledger schema');
    this.committed = copy(this.state);
  }
  _save() {
    // Derived records and ingestion positions are one atomic replacement. Caller must
    // serialize writers. This does not guarantee fsync durability or external effects.
    const temporary = `${this.path}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, this.path);
      this.committed = copy(this.state);
    } catch (error) { this.state = copy(this.committed); throw error; }
  }
  snapshot() { return copy(this.state); }
  ingest(events, { consent = false } = {}) {
    if (consent !== true) throw new Error('Learning consent required');
    if (!Array.isArray(events)) throw new TypeError('events must be an array');
    // Validate the complete batch before changing the in-memory projection.
    for (const e of events) {
      required(e.sourceId, 'sourceId'); required(e.taskId, 'taskId'); required(e.type, 'type');
      if (!Number.isSafeInteger(e.seq) || e.seq < 1) throw new TypeError('Positive seq required');
      if (!['action', 'result', 'verification', 'assembly', 'binding-snapshot'].includes(e.type)) throw new TypeError('Unknown event type');
      required(e.callId, 'callId');
      if (!Number.isSafeInteger(e.step) || e.step < 0) throw new TypeError('Nonnegative step required');
      required(e.contractFingerprint, 'contractFingerprint');
      if (!e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) throw new TypeError('payload required');
      if (e.type === 'action') {
        required(e.tool, 'tool');
        if (!['activate', 'invoke', 'program'].includes(e.payload.operation)) throw new TypeError('Invalid operation');
      }
      if (e.type === 'result' && typeof e.payload.ok !== 'boolean') throw new TypeError('Result ok must be boolean');
      if (e.type === 'verification' && typeof e.payload.passed !== 'boolean') throw new TypeError('Verification passed must be boolean');
      if (this.state.sources[e.sourceId]?.withdrawn) throw new Error('Source withdrawn');
      canonical(e);
    }
    let added = 0, duplicates = 0, conflicts = 0;
    for (const raw of events) {
      const e = copy(raw), source = this.state.sources[e.sourceId] ??= { events: {}, conflicts: [], cursor: 0, withdrawn: false };
      if (source.withdrawn) throw new Error('Source withdrawn');
      const hash = fingerprint(e), previous = source.events[e.seq];
      if (previous) {
        if (previous.hash === hash) duplicates++;
        else { conflicts++; source.conflicts.push({ seq: e.seq, existingHash: previous.hash, rejectedHash: hash }); }
      } else { source.events[e.seq] = { event: e, hash, id: eventId(e) }; added++; }
      while (source.events[source.cursor + 1]) source.cursor++;
    }
    this._save();
    return { added, duplicates, conflicts };
  }
  episode({ sourceId, taskId }) {
    const source = this.state.sources[sourceId];
    if (!source) throw new Error('Unknown source');
    const entries = Object.values(source.events).filter(x => x.event.taskId === taskId).sort((a, b) => a.event.seq - b.event.seq);
    const events = entries.map(x => x.event), actions = events.filter(e => e.type === 'action');
    const problems = [];
    if (!events.length) problems.push('empty-source');
    if (source.withdrawn) problems.push('withdrawn');
    if (source.conflicts.length) problems.push('source-conflict');
    if (events.some(e => e.seq > source.cursor)) problems.push('sequence-gap');
    const contracts = [...new Set(events.map(e => e.contractFingerprint))];
    if (contracts.length !== 1) problems.push('mixed-contract');
    const calls = actions.map(action => {
      const results = events.filter(e => e.type === 'result' && e.callId === action.callId);
      const verifications = events.filter(e => e.type === 'verification' && e.callId === action.callId);
      if (results.length !== 1) problems.push(results.length ? 'duplicate-call-result' : 'missing-result');
      if (results.some(r => r.seq <= action.seq || r.step !== action.step)) problems.push('invalid-result-order');
      if (results.some(r => typeof r.payload.result?.isError === 'boolean' && r.payload.ok === r.payload.result.isError)) problems.push('result-status-conflict');
      if (verifications.some(v => v.seq <= (results[0]?.seq ?? Infinity))) problems.push('invalid-verification-order');
      if (verifications.some(v => verifications.some(other => other.payload.claim === v.payload.claim && other.payload.passed !== v.payload.passed))) problems.push('conflicting-verification');
      return { action, result: results[0] ?? null, verifications };
    });
    if (new Set(actions.map(e => e.callId)).size !== actions.length) problems.push('duplicate-call-id');
    if (events.some(e => ['result', 'verification'].includes(e.type) && !actions.some(a => a.callId === e.callId))) problems.push('orphan-result');
    return { sourceId, taskId, sourceFingerprint: fingerprint(entries.map(e => ({ id: e.id, hash: e.hash }))),
      contractFingerprint: contracts[0] ?? null, eventRefs: entries.map(e => e.id), calls,
      status: problems.length ? 'incomplete' : 'complete', problems: [...new Set(problems)] };
  }
  propose({ sourceId, taskId }) {
    const episode = this.episode({ sourceId, taskId });
    if (episode.status !== 'complete') return { status: 'incomplete', episode };
    const calls = episode.calls, events = Object.values(this.state.sources[sourceId].events).map(x => x.event).filter(e => e.taskId === taskId);
    let failed, activated, repaired, target;
    for (const activation of calls.filter(c => c.action.payload.operation === 'activate' && c.result.payload.ok === true
      && c.result.payload.result?.value?.availableOnNextStep === true)) {
      for (const tool of Array.isArray(activation.action.payload.arguments?.tools) ? activation.action.payload.arguments.tools : []) {
        if (typeof tool !== 'string') continue;
        if (!activation.result.payload.result.value.enabled?.includes(tool)) continue;
        const failure = calls.find(c => c.action.payload.operation === 'program' && c.action.step === activation.action.step
          && c.result.payload.ok === false && activation.result.seq < c.result.seq
          && activation.action.callId.startsWith(`${c.action.callId}:ptc:`)
          && requestedTools(c.action.payload.arguments?.code).includes(tool)
          && JSON.stringify(c.result.payload.result).includes(`tools.${tool} is not a function`)
          && events.some(e => e.type === 'binding-snapshot' && e.callId === c.action.callId && e.step === c.action.step && Array.isArray(e.payload.names) && !e.payload.names.includes(tool)));
        const repair = failure && calls.find(c => c.action.payload.operation === 'invoke' && c.action.tool === tool
          && c.action.step > failure.action.step && c.result.payload.ok === true
          && c.verifications.some(v => v.payload.passed === true && v.payload.claim === 'fixture-marker-executed')
          && events.some(e => e.type === 'assembly' && e.step > failure.action.step && e.seq < c.action.seq)
          && events.some(e => e.type === 'binding-snapshot' && c.action.callId.startsWith(`${e.callId}:ptc:`)
            && e.step === c.action.step && e.seq < c.action.seq && e.payload.names?.includes(tool)));
        if (failure && repair) { failed = failure; activated = activation; repaired = repair; target = tool; break; }
      }
      if (failed) break;
    }
    if (!failed || !activated || !repaired || activated.action.payload.activationMode !== 'next-step')
      return { status: 'insufficient-evidence', episode };
    const id = `activation-${fingerprint({ source: episode.sourceFingerprint, extractor: 1 }).slice(0, 20)}`;
    if (this.state.candidates[id]) return copy(this._candidate(id));
    const candidate = { id, version: 1, status: 'proposed', kind: 'conditional-experience',
      sourceId, taskId, sourceFingerprint: episode.sourceFingerprint,
      contractFingerprint: episode.contractFingerprint, evidenceRefs: episode.eventRefs,
      observation: { failure: eventId(failed.result), activation: eventId(activated.result), repair: eventId(repaired.result), target,
        failedDispatchObserved: false, requestedTargetEvidence: 'program-AST-and-missing-binding-snapshot',
        verification: repaired.verifications.filter(v => v.payload.passed).map(eventId), causalStrength: 'local-observed-sequence' },
      applicability: { activationMode: 'next-step', toolActive: false, permission: 'allowed' },
      instruction: 'For this fingerprinted host contract, tool bindings are snapshotted when run_code begins. Activation updates availability state; newly activated tools become callable only after the next prompt assembly and a new run_code execution. Activate, return from the current run_code, allow the next prompt assembly, then invoke the tool in a new run_code. Waiting or invoking again within the same run_code does not refresh bindings. Check the current contract and permission first; do not reactivate an already active tool.',
      humanReview: 'pending', agentReview: 'pending', productionEligible: false };
    candidate.contentHash = fingerprint(content(candidate));
    candidate.reviewPacketHash = fingerprint({ contentHash: candidate.contentHash, evidenceRefs: candidate.evidenceRefs, observation: candidate.observation });
    this.state.candidates[id] = candidate; this._save(); return copy(candidate);
  }
  _integrity(c) {
    if (!c || fingerprint(content(c)) !== c.contentHash) return false;
    if (fingerprint({ contentHash: c.contentHash, evidenceRefs: c.evidenceRefs, observation: c.observation }) !== c.reviewPacketHash) return false;
    if ((c.status === 'frozen-evaluation' || c.frozenHash !== undefined) && c.frozenHash !== c.contentHash) return false;
    return true;
  }
  _candidate(id) {
    const c = this.state.candidates[id];
    if (!c) throw new Error('Unknown candidate');
    if (!this._integrity(c)) throw new Error('Candidate content or review packet integrity mismatch');
    return c;
  }
  _valid(c) {
    if (!this._integrity(c)) return false;
    const source = this.state.sources[c.sourceId];
    if (!source || source.withdrawn || source.conflicts.length || c.status === 'withdrawn') return false;
    const episode = this.episode(c);
    return episode.status === 'complete' && episode.sourceFingerprint === c.sourceFingerprint;
  }
  review(id, { actorType, decision, evidenceRefs = [], note = '' } = {}) {
    const c = this._candidate(id);
    // This experiment deliberately has no authenticated human-review adapter.
    // A JSON caller cannot claim to be human and mint its own approval.
    if (actorType !== 'agent') throw new Error('Authenticated human review unavailable; human review remains pending');
    if (!['accept', 'reject'].includes(decision)) throw new TypeError('Invalid review decision');
    if (!this._valid(c)) throw new Error('Stale or withdrawn candidate');
    if (!Array.isArray(evidenceRefs) || !evidenceRefs.length || evidenceRefs.some(r => !c.evidenceRefs.includes(r))) throw new Error('Review must reference candidate evidence');
    if (c.status === 'frozen-evaluation') throw new Error('Frozen candidate review is immutable');
    const receipt = { candidateId: id, candidateVersion: c.version, actorType, decision, evidenceRefs: copy(evidenceRefs), note };
    this.state.reviews.push(receipt); c.agentReview = decision; this._save(); return copy(receipt);
  }
  importHumanReviewReceipt(receipt) {
    const c = this._candidate(receipt?.candidateId);
    if (typeof this.verifyHumanReceipt !== 'function' || this.verifyHumanReceipt(copy(receipt)) !== true)
      throw new Error('Trusted external human receipt verification required');
    if (!this._valid(c) || receipt.candidateVersion !== c.version || receipt.contentHash !== c.contentHash
      || receipt.reviewPacketHash !== c.reviewPacketHash) throw new Error('Human receipt candidate binding mismatch');
    required(receipt.messageId, 'external messageId'); required(receipt.text, 'external human text');
    if (!['accept', 'reject'].includes(receipt.decision)) throw new TypeError('Invalid human decision');
    const record = { ...copy(receipt), actorType: 'human', verificationBoundary: 'caller-provided trusted external message verifier' };
    this.state.reviews.push(record); c.humanReview = receipt.decision;
    if (receipt.decision === 'reject') c.status = 'withdrawn';
    this._save(); return copy(record);
  }
  freeze(id, { evaluationConsent = false } = {}) {
    const c = this._candidate(id);
    if (evaluationConsent !== true) throw new Error('Explicit sandbox evaluation consent required');
    if (c.agentReview !== 'accept' || !this._valid(c)) throw new Error('Accepted valid agent review required');
    c.status = 'frozen-evaluation';
    c.frozenHash ??= fingerprint(content(c));
    this._save();
    return { candidateId: id, version: c.version, contentHash: c.frozenHash, sourceFingerprint: c.sourceFingerprint,
      contractFingerprint: c.contractFingerprint, evaluationOnly: true, humanApproved: c.humanReview === 'accept', productionEligible: false };
  }
  retrieve(features = {}, { evaluationOnly = false, consent = false } = {}) {
    const decisions = [], cards = [];
    for (const c of Object.values(this.state.candidates)) {
      let applicability = 'match', reason = 'matched';
      if (!this._valid(c)) { applicability = 'mismatch'; reason = 'source-invalid'; }
      else for (const [key, expected] of Object.entries({ ...c.applicability, contractFingerprint: c.contractFingerprint })) {
        if (features[key] === undefined || features[key] === null || features[key] === 'unknown') {
          if (applicability !== 'mismatch') { applicability = 'unknown'; reason = 'missing-condition'; }
        } else if (features[key] !== expected) { applicability = 'mismatch'; reason = `condition:${key}`; }
      }
      const permitted = consent === true && evaluationOnly === true && c.status === 'frozen-evaluation';
      decisions.push({ candidateId: c.id, applicability, reason, eligible: permitted && applicability === 'match',
        gate: permitted ? 'sandbox-only' : 'not-authorized' });
      if (permitted && applicability === 'match') cards.push({ candidateId: c.id, version: c.version, contentHash: c.frozenHash,
        instruction: c.instruction, evidenceRefs: copy(c.evidenceRefs), evaluationOnly: true, humanApproved: c.humanReview === 'accept' });
    }
    return { cards, decisions };
  }
  withdrawSource(sourceId, { consent = false } = {}) {
    if (consent !== true) throw new Error('Withdrawal authority required');
    const s = this.state.sources[sourceId]; if (!s) throw new Error('Unknown source');
    s.withdrawn = true;
    for (const c of Object.values(this.state.candidates)) if (c.sourceId === sourceId) c.status = 'withdrawn';
    this.state.withdrawals.push({ sourceId }); this._save();
  }
}
