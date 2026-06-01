const state = {
  gameId: '',
  tokenId: '',
  pendingTx: null,
};

const els = {
  status: document.querySelector('#status'),
  newGame: document.querySelector('#newGame'),
  price: document.querySelector('#price'),
  playerAccount: document.querySelector('#playerAccount'),
  join: document.querySelector('#join'),
  pot: document.querySelector('#pot'),
  priceText: document.querySelector('#priceText'),
  community: document.querySelector('#community'),
  players: document.querySelector('#players'),
  explain: document.querySelector('#explain'),
  explainText: document.querySelector('#explainText'),
  advice: document.querySelector('#advice'),
  adviceText: document.querySelector('#adviceText'),
  paidReport: document.querySelector('#paidReport'),
  paidText: document.querySelector('#paidText'),
  actions: document.querySelectorAll('[data-action]'),
  gameId: document.querySelector('#gameId'),
  tokenId: document.querySelector('#tokenId'),
  phase: document.querySelector('#phase'),
  nextStep: document.querySelector('#nextStep'),
  log: document.querySelector('#log'),
  confirmDialog: document.querySelector('#confirmDialog'),
  confirmText: document.querySelector('#confirmText'),
  confirmTx: document.querySelector('#confirmTx'),
};

function setStatus(message) {
  els.status.textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

function cardMarkup(card) {
  return `<span class="card">${card || '??'}</span>`;
}

function renderTable(table) {
  els.gameId.textContent = table.id || state.gameId || '-';
  els.tokenId.textContent = table.tokenId || state.tokenId || '-';
  els.phase.textContent = table.phase || '-';
  els.nextStep.textContent = nextStepForPhase(table.phase);
  els.pot.textContent = `${table.pot || 0} HBAR`;
  els.community.innerHTML = (table.communityCards || []).map(cardMarkup).join('');
  els.players.innerHTML = (table.players || []).map((player) => `
    <article class="player ${player.folded ? 'folded' : ''}">
      <div class="player-name">
        <span>${player.name}</span>
        <small>${player.isAgent ? 'AI' : 'Human'}</small>
      </div>
      <div>${player.chips} chips</div>
      <div>Bet: ${player.bet}</div>
      <div class="hole">${(player.holeCards || []).map(cardMarkup).join('')}</div>
    </article>
  `).join('');
  els.log.innerHTML = (table.log || []).slice().reverse().map((entry) => `<li>${entry.message}</li>`).join('');
  els.actions.forEach((button) => {
    button.disabled = !table.id || table.phase === 'waiting' || table.phase === 'complete';
  });
  els.advice.disabled = !table.id || table.phase === 'waiting';
  els.explain.disabled = !table.id || table.phase === 'waiting';
  els.paidReport.disabled = !table.id || table.phase === 'waiting';
}

function nextStepForPhase(phase) {
  if (phase === 'waiting') return 'Enter 0.0.6990994, click Join Table, then confirm the buy-in.';
  if (phase === 'preflop') return 'Choose an action to play preflop; the next response deals the flop.';
  if (phase === 'flop') return 'Choose an action on the flop; the next response deals the turn.';
  if (phase === 'turn') return 'Choose an action on the turn; the next response deals the river.';
  if (phase === 'river') return 'Choose an action on the river; the next response goes to showdown.';
  if (phase === 'showdown') return 'Confirm the winner payout if the modal is open.';
  if (phase === 'complete') return 'Hand complete. Create a new game to replay the demo.';
  if (phase) return 'Continue the current hand.';
  return 'Create a game.';
}

function showPendingTx(tx) {
  state.pendingTx = tx;
  els.confirmText.textContent = `${tx.purpose}: transfer ${tx.amountHbar} HBAR from ${tx.from} to ${tx.to}`;
  els.confirmDialog.showModal();
}

els.newGame.addEventListener('click', async () => {
  try {
    setStatus('Creating token...');
    const result = await api('/game/new', { method: 'POST' });
    state.gameId = result.gameId;
    state.tokenId = result.tokenId || '';
    els.price.disabled = false;
    els.join.disabled = false;
    renderTable({ id: result.gameId, tokenId: result.tokenId, phase: 'waiting', pot: 0, players: [], communityCards: [], log: [] });
    setStatus('Game created. Join and confirm buy-in next.');
  } catch (error) {
    setStatus(error.message);
  }
});

els.price.addEventListener('click', async () => {
  try {
    setStatus('Fetching price...');
    const result = await api(`/table/${state.gameId}/price`);
    els.priceText.textContent = result.display;
    setStatus('Price loaded');
  } catch (error) {
    setStatus(error.message);
  }
});

els.advice.addEventListener('click', async () => {
  try {
    setStatus('Asking Llama...');
    const advice = await api(`/table/${state.gameId}/advice`);
    els.adviceText.textContent = `${advice.recommendation.toUpperCase()}${advice.amount ? ` ${advice.amount}` : ''} (${Math.round(advice.confidence * 100)}%): ${advice.reasoning}`;
    setStatus(`Llama advice from ${advice.model}`);
  } catch (error) {
    setStatus(error.message);
  }
});

els.explain.addEventListener('click', async () => {
  try {
    setStatus('Reading table with Llama...');
    const result = await api(`/table/${state.gameId}/explain`);
    els.explainText.textContent = result.explanation;
    setStatus(`Table explained by ${result.model}`);
  } catch (error) {
    setStatus(error.message);
  }
});

els.paidReport.addEventListener('click', async () => {
  try {
    const playerAccountId = els.playerAccount.value.trim();
    if (!playerAccountId) throw new Error('Enter your Hedera account ID');
    setStatus('Queueing paid agent execution...');
    const result = await api(`/agent/paid-report/${state.gameId}/pay`, {
      method: 'POST',
      body: JSON.stringify({ playerAccountId }),
    });
    els.paidText.textContent = 'Payment queued. Confirm the 0.1 HBAR payment to execute the premium report.';
    showPendingTx(result.pending_tx);
    setStatus('Confirm paid report payment');
  } catch (error) {
    setStatus(error.message);
  }
});

els.join.addEventListener('click', async () => {
  try {
    const playerAccountId = els.playerAccount.value.trim();
    if (!playerAccountId) throw new Error('Enter your Hedera account ID');
    setStatus('Queueing buy-in...');
    const result = await api(`/game/${state.gameId}/join`, {
      method: 'POST',
      body: JSON.stringify({ playerAccountId }),
    });
    showPendingTx(result.pending_tx);
    setStatus('Confirm buy-in');
  } catch (error) {
    setStatus(error.message);
  }
});

els.confirmTx.addEventListener('click', async (event) => {
  event.preventDefault();
  try {
    if (!state.pendingTx) throw new Error('No pending transaction');
    setStatus('Submitting transfer...');
    const confirmation = await api('/tx/confirm', {
      method: 'POST',
      body: JSON.stringify({ txId: state.pendingTx.txId }),
    });
    els.confirmDialog.close();
    state.pendingTx = null;
    if (confirmation.paid_execution) {
      els.paidText.textContent = confirmation.paid_execution.result;
    }
    const table = await api(`/table/${state.gameId}`);
    renderTable(table);
    setStatus('Transfer confirmed');
  } catch (error) {
    setStatus(error.message);
  }
});

els.actions.forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      const action = button.dataset.action;
      setStatus(`Playing ${action}...`);
      const table = await api(`/game/${state.gameId}/action`, {
        method: 'POST',
        body: JSON.stringify({
          playerId: 'human',
          action,
          amount: action === 'raise' ? 25 : 0,
        }),
      });
      renderTable(table);
      if (table.pending_tx) {
        showPendingTx(table.pending_tx);
      }
      setStatus('Action complete');
    } catch (error) {
      setStatus(error.message);
    }
  });
});
