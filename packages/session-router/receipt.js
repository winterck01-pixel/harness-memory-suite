
export function receiptOf(events, row) {
  const matches = message => {
    const s = message?.source;
    return s?.kind === 'cross-session-relay' && s.routerId === 'cross-session-agent-router'
      && s.fromAgentId === row.caller && s.requestId === row.requestId;
  };
  const queues = {'next-turn': [], 'next-step': []};
  let currentTurn = null, turn = null, state = 'uncertain', entered = false;
  const text = [];
  for (const event of events) {
    const d = event.data;
    if (event.type === 'turn/start') currentTurn = d.turn;
    if (event.type === 'agent/inbox/spliced' && queues[d.target]) {
      const removed = queues[d.target].splice(d.start, d.removedCount || 0, ...(d.inserted || []));
      if (removed.some(matches)) {
        state = d.outcome === 'canceled' ? 'canceled' : 'preparing';
        turn = d.outcome === 'canceled' ? null : currentTurn;
      }
      if ((d.inserted || []).some(matches)) {state = 'queued'; turn = null;}
    }
    if (event.type === 'user/message' && matches(d)) {
      entered = true; turn = currentTurn; state = 'running';
    }
    if (entered && turn !== null && d.turn === turn && event.type === 'assistant/message') {
      for (const block of d.message?.content || []) if (block.type === 'text') text.push(block.text);
    }
    if (event.type === 'turn/end') {
      if (turn !== null && d.turn === turn) {
        state = !entered && d.reason.kind === 'completed' ? 'not_executed' : d.reason.kind;
      }
      if (currentTurn === d.turn) currentTurn = null;
    }
  }
  return {state, turn, text: text.join('\n')};
}


export function keyedQueue() {
  const jobs = new Map();
  return (key, fn) => {
    const job = (jobs.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    jobs.set(key, job);
    const cleanup = () => {if (jobs.get(key) === job) jobs.delete(key);};
    job.then(cleanup, cleanup);
    return job;
  };
}
