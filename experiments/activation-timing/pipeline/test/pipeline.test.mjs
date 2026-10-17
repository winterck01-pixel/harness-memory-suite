import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivationLearningPipeline } from '../index.mjs';

const contractFingerprint = 'contract-next-step-v1';
const features = { activationMode: 'next-step', toolActive: false, permission: 'allowed', contractFingerprint };
function trace() {
  const base = { sourceId: 'capture-a', taskId: 'source-task', contractFingerprint, tool: 'sample.echo' };
  return [
    { type: 'assembly', callId: 'assembly-0', step: 0, payload: { transportNames: ['run_code'] } },
    { type: 'action', callId: 'program-a', step: 0, payload: { operation: 'program', arguments: { code: 'await tools.activate_tool_group({tools:["sample_echo"]});return await tools.sample_echo({});' } } },
    { type: 'binding-snapshot', callId: 'program-a', step: 0, payload: { names: ['activate_tool_group'] } },
    { type: 'action', callId: 'program-a:ptc:1', step: 0, payload: { operation: 'activate', arguments: { tools: ['sample_echo'] }, activationMode: 'next-step' } },
    { type: 'result', callId: 'program-a:ptc:1', step: 0, payload: { ok: true, result: { value: { availableOnNextStep: true, enabled: ['sample_echo'] } } } },
    { type: 'result', callId: 'program-a', step: 0, payload: { ok: false, result: { error: { message: 'TypeError: tools.sample_echo is not a function' } } } },
    { type: 'assembly', callId: 'assembly-1', step: 1, payload: { transportNames: ['run_code'] } },
    { type: 'action', callId: 'program-b', step: 1, payload: { operation: 'program', arguments: { code: 'return await tools.sample_echo({});' } } },
    { type: 'binding-snapshot', callId: 'program-b', step: 1, payload: { names: ['activate_tool_group', 'sample_echo'] } },
    { type: 'action', callId: 'program-b:ptc:1', step: 1, tool: 'sample_echo', payload: { operation: 'invoke' } },
    { type: 'result', callId: 'program-b:ptc:1', step: 1, payload: { ok: true } },
    { type: 'result', callId: 'program-b', step: 1, payload: { ok: true } },
    { type: 'verification', callId: 'program-b:ptc:1', step: 1, payload: { passed: true, claim: 'fixture-marker-executed' } },
  ].map((e, i) => ({ ...base, ...e, seq: i + 1 }));
}
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'activation-learning-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, pipeline: new ActivationLearningPipeline({ directory }) };
}
const propose = p => p.propose({ sourceId: 'capture-a', taskId: 'source-task' });
function frozen(p) {
  p.ingest(trace(), { consent: true });
  const c = propose(p);
  p.review(c.id, { actorType: 'agent', decision: 'accept', evidenceRefs: c.evidenceRefs, note: 'Independent sandbox review' });
  return { candidate: c, capsule: p.freeze(c.id, { evaluationConsent: true }) };
}

test('durable consumption resumes without human turn input; duplicates are not new evidence', t => {
  const { directory, pipeline: p } = setup(t), events = trace();
  assert.deepEqual(p.ingest(events.slice(0, 4), { consent: true }), { added: 4, duplicates: 0, conflicts: 0 });
  const restarted = new ActivationLearningPipeline({ directory });
  assert.equal(restarted.snapshot().sources['capture-a'].cursor, 4);
  assert.equal(propose(restarted).status, 'incomplete');
  assert.deepEqual(restarted.ingest(events, { consent: true }), { added: events.length - 4, duplicates: 4, conflicts: 0 });
  const c = propose(restarted);
  assert.equal(c.status, 'proposed');
  assert.equal(c.observation.causalStrength, 'local-observed-sequence');
  assert.equal(propose(restarted).id, c.id);
  assert.equal(Object.keys(restarted.snapshot().candidates).length, 1);
});

test('missing result remains incomplete after reconstruction and cannot propose', t => {
  const { directory, pipeline: p } = setup(t);
  p.ingest(trace().slice(0, 10), { consent: true });
  const reopened = new ActivationLearningPipeline({ directory });
  assert.equal(propose(reopened).status, 'incomplete');
  assert.ok(propose(reopened).episode.problems.includes('missing-result'));
});

test('sequence gaps remain incomplete until the actual missing event arrives', t => {
  const { pipeline: p } = setup(t), events = trace();
  p.ingest(events.filter(e => e.seq !== 2), { consent: true });
  assert.equal(p.snapshot().sources['capture-a'].cursor, 1);
  assert.ok(propose(p).episode.problems.includes('sequence-gap'));
  p.ingest([events[1]], { consent: true });
  assert.equal(propose(p).status, 'proposed');
});

test('conflicting content at the same source sequence quarantines existing and future retrieval', t => {
  const { directory, pipeline: p } = setup(t); frozen(p);
  const changed = trace()[5]; changed.payload.result.error.message = 'Different failure';
  assert.equal(p.ingest([changed], { consent: true }).conflicts, 1);
  const reopened = new ActivationLearningPipeline({ directory });
  assert.equal(reopened.retrieve(features, { evaluationOnly: true, consent: true }).cards.length, 0);
  assert.ok(propose(reopened).episode.problems.includes('source-conflict'));
});

test('agent review never becomes human approval; freeze needs separate sandbox authority', t => {
  const { pipeline: p } = setup(t); p.ingest(trace(), { consent: true }); const c = propose(p);
  assert.throws(() => p.freeze(c.id, { evaluationConsent: true }), /review/);
  assert.throws(() => p.review(c.id, { actorType: 'human', decision: 'accept', evidenceRefs: c.evidenceRefs }), /human review unavailable/);
  p.review(c.id, { actorType: 'agent', decision: 'accept', evidenceRefs: c.evidenceRefs });
  assert.throws(() => p.freeze(c.id), /consent/);
  const capsule = p.freeze(c.id, { evaluationConsent: true });
  assert.equal(capsule.humanApproved, false);
  assert.equal(capsule.productionEligible, false);
  assert.equal(p.snapshot().candidates[c.id].humanReview, 'pending');
  assert.throws(() => p.review(c.id, { actorType: 'agent', decision: 'reject', evidenceRefs: c.evidenceRefs }), /immutable/);
});

test('tri-state conditional retrieval excludes unknowns, immediate contracts, active tools and denied permissions', t => {
  const { pipeline: p } = setup(t); frozen(p);
  const retrieve = f => p.retrieve(f, { evaluationOnly: true, consent: true });
  assert.equal(retrieve(features).cards.length, 1);
  for (const f of [{ ...features, activationMode: 'immediate' }, { ...features, toolActive: true },
    { ...features, permission: 'denied' }, { ...features, contractFingerprint: 'other-contract' }]) {
    assert.equal(retrieve(f).decisions[0].applicability, 'mismatch');
    assert.equal(retrieve(f).cards.length, 0);
  }
  for (const key of Object.keys(features)) {
    const f = { ...features }; delete f[key];
    assert.equal(retrieve(f).decisions[0].applicability, 'unknown');
    assert.equal(retrieve(f).cards.length, 0);
  }
  assert.equal(p.retrieve(features, { consent: true }).cards.length, 0);
  assert.equal(p.retrieve(features, { evaluationOnly: true }).cards.length, 0);
});

test('source withdrawal survives reconstruction and invalidates the sandbox capsule', t => {
  const { directory, pipeline: p } = setup(t); frozen(p);
  p.withdrawSource('capture-a', { consent: true });
  const restarted = new ActivationLearningPipeline({ directory });
  assert.equal(restarted.retrieve(features, { evaluationOnly: true, consent: true }).cards.length, 0);
  assert.throws(() => restarted.ingest(trace(), { consent: true }), /withdrawn/);
});

test('new source evidence invalidates frozen source version without silently rewriting candidate', t => {
  const { pipeline: p } = setup(t), { capsule, candidate } = frozen(p);
  p.ingest([{ ...trace()[1], seq: trace().length + 1, callId: 'd', step: 2 }], { consent: true });
  assert.equal(p.retrieve(features, { evaluationOnly: true, consent: true }).cards.length, 0);
  assert.equal(p.snapshot().candidates[candidate.id].frozenHash, capsule.contentHash);
});

test('failed verification or a different error does not become the timing candidate', t => {
  const { pipeline: p } = setup(t), events = trace(); events.at(-1).payload.passed = false;
  p.ingest(events, { consent: true }); assert.equal(propose(p).status, 'insufficient-evidence');
  const { pipeline: other } = setup(t), otherEvents = trace(); otherEvents[5].payload.result.error.message = 'AUTH_DENIED';
  other.ingest(otherEvents, { consent: true }); assert.equal(propose(other).status, 'insufficient-evidence');
});

test('consent denial and invalid event batch have no ingestion side effect', t => {
  const { pipeline: p } = setup(t);
  assert.throws(() => p.ingest(trace()), /consent/);
  assert.throws(() => p.ingest([...trace(), { ...trace()[0], seq: 0 }], { consent: true }), /Positive seq/);
  assert.deepEqual(p.snapshot().sources, {});
});

test('external human receipt requires trusted verification and exact candidate packet binding', t => {
  const { directory, pipeline: p } = setup(t); p.ingest(trace(), { consent: true }); const c = propose(p);
  const receipt = { candidateId: c.id, candidateVersion: c.version, contentHash: c.contentHash,
    reviewPacketHash: c.reviewPacketHash, messageId: 'external-human-message-1', text: 'Approve this exact sandbox candidate.', decision: 'accept' };
  assert.throws(() => p.importHumanReviewReceipt(receipt), /Trusted external/);
  // Test-only simulated trusted adapter; no test result is a real human approval.
  const simulated = new ActivationLearningPipeline({ directory, verifyHumanReceipt: r => r.messageId === 'external-human-message-1' });
  assert.throws(() => simulated.importHumanReviewReceipt({ ...receipt, contentHash: 'changed' }), /binding mismatch/);
  assert.throws(() => simulated.importHumanReviewReceipt({ ...receipt, reviewPacketHash: 'changed' }), /binding mismatch/);
  simulated.importHumanReviewReceipt(receipt);
  assert.equal(simulated.snapshot().candidates[c.id].humanReview, 'accept');
  assert.equal(simulated.snapshot().candidates[c.id].productionEligible, false);
});

test('write failure restores the last committed in-memory cursor and projection', t => {
  const { directory, pipeline: p } = setup(t);
  mkdirSync(join(directory, 'learning-ledger.json.tmp'));
  assert.throws(() => p.ingest(trace(), { consent: true }));
  assert.deepEqual(p.snapshot().sources, {});
  rmSync(join(directory, 'learning-ledger.json.tmp'), { recursive: true });
  assert.equal(p.ingest(trace(), { consent: true }).added, trace().length);
});

test('error text alone or failed result normalization cannot fabricate an actionable experience', t => {
  const { pipeline: p } = setup(t), events = trace();
  events[1].payload.arguments.code = 'return "tools.sample_echo({})";';
  p.ingest(events, { consent: true }); assert.equal(propose(p).status, 'insufficient-evidence');
  const { pipeline: other } = setup(t), contradictory = trace();
  contradictory[5].payload.result.isError = false;
  other.ingest(contradictory, { consent: true });
  assert.ok(propose(other).episode.problems.includes('result-status-conflict'));
});

test('contradictory verification is incomplete and is not cherry-picked as success', t => {
  const { pipeline: p } = setup(t), events = trace();
  events.push({ ...structuredClone(events.at(-1)), seq: events.length + 1, payload: { passed: false, claim: 'fixture-marker-executed' } });
  p.ingest(events, { consent: true });
  assert.ok(propose(p).episode.problems.includes('conflicting-verification'));
});

test('mutating frozen candidate content cannot reuse its prior frozen hash in memory', t => {
  const { pipeline: p } = setup(t), { candidate } = frozen(p);
  p.state.candidates[candidate.id].instruction = 'Changed after review and freeze';
  assert.equal(p.retrieve(features, { evaluationOnly: true, consent: true }).cards.length, 0);
  assert.throws(() => p.freeze(candidate.id, { evaluationConsent: true }), /integrity mismatch/);
  assert.throws(() => propose(p), /integrity mismatch/);
});

test('persisted review-packet or frozen-hash tampering fails closed after reconstruction', t => {
  for (const field of ['instruction', 'evidenceRefs', 'observation', 'contentHash', 'reviewPacketHash', 'frozenHash']) {
    const { directory, pipeline: p } = setup(t), { candidate } = frozen(p);
    const path = join(directory, 'learning-ledger.json'), ledger = JSON.parse(readFileSync(path, 'utf8'));
    const stored = ledger.candidates[candidate.id];
    if (field === 'evidenceRefs') stored.evidenceRefs = [];
    else if (field === 'observation') stored.observation.failure = 'changed-source-ref';
    else stored[field] = 'tampered';
    writeFileSync(path, JSON.stringify(ledger));
    const reopened = new ActivationLearningPipeline({ directory, verifyHumanReceipt: () => true });
    assert.equal(reopened.retrieve(features, { evaluationOnly: true, consent: true }).cards.length, 0, field);
    assert.throws(() => propose(reopened), /integrity mismatch/, field);
    assert.throws(() => reopened.freeze(candidate.id, { evaluationConsent: true }), /integrity mismatch/, field);
    assert.throws(() => reopened.importHumanReviewReceipt({ candidateId: candidate.id, candidateVersion: candidate.version,
      contentHash: candidate.contentHash, reviewPacketHash: candidate.reviewPacketHash, messageId: 'trusted-message',
      text: 'Approve original candidate', decision: 'accept' }), /integrity mismatch/, field);
  }
});
