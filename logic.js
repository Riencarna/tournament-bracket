/* =========================================================
   Tournament Logic — shared helpers
   ========================================================= */

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(2, p);
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Standard bracket seeding pattern (1 vs 16, 8 vs 9, 5 vs 12, ...)
function seededOrder(n) {
  // n must be a power of 2
  if (n < 2) return [1];
  let order = [1, 2];
  while (order.length < n) {
    const sum = order.length * 2 + 1;
    const next = [];
    for (const v of order) {
      next.push(v);
      next.push(sum - v);
    }
    order = next;
  }
  return order;
}

/* Build a single elimination bracket.
   participants: array of name strings (already shuffled)
   seeding: 'random' (use order given), 'seeded' (use standard seeded pattern)
*/
function buildSingleElimination(participants) {
  const n = participants.length;
  const size = nextPow2(n);
  const order = seededOrder(size);

  // Fill positions with seeded ordering; missing slots become BYE
  const slots = new Array(size).fill(null);
  order.forEach((seed, idx) => {
    if (seed <= n) slots[idx] = { id: `p${seed}`, name: participants[seed - 1], seed };
    else slots[idx] = null; // BYE
  });

  const rounds = [];
  let prevMatchIds = [];

  // Round 1
  const r1Matches = [];
  for (let i = 0; i < size; i += 2) {
    const m = {
      id: `r1m${i / 2}`,
      round: 0,
      a: slots[i],
      b: slots[i + 1],
      scoreA: null,
      scoreB: null,
      winnerIdx: null,
      aFrom: null, bFrom: null,
    };
    // Auto-advance BYE
    if (m.a && !m.b) { m.winnerIdx = 0; m.scoreA = 'W'; m.scoreB = '-'; }
    else if (!m.a && m.b) { m.winnerIdx = 1; m.scoreA = '-'; m.scoreB = 'W'; }
    r1Matches.push(m);
  }
  rounds.push(r1Matches);
  prevMatchIds = r1Matches.map(m => m.id);

  let rIndex = 1;
  let cur = r1Matches.length;
  while (cur > 1) {
    const next = [];
    for (let i = 0; i < cur; i += 2) {
      const aPrev = prevMatchIds[i];
      const bPrev = prevMatchIds[i + 1];
      const m = {
        id: `r${rIndex + 1}m${i / 2}`,
        round: rIndex,
        a: null, b: null,
        scoreA: null, scoreB: null,
        winnerIdx: null,
        aFrom: aPrev, bFrom: bPrev,
      };
      next.push(m);
    }
    rounds.push(next);
    prevMatchIds = next.map(m => m.id);
    cur = next.length;
    rIndex++;
  }

  // After setup, propagate BYE winners forward
  propagateSingle(rounds);

  // Third place match — only if there's a semifinal with exactly 2 matches
  let thirdPlace = null;
  if (rounds.length >= 2 && rounds[rounds.length - 2].length === 2) {
    thirdPlace = {
      id: 'tp1',
      round: rounds.length - 1,
      kind: 'thirdPlace',
      a: null, b: null,
      scoreA: null, scoreB: null,
      winnerIdx: null,
    };
  }

  const result = { type: 'single', size, rounds, thirdPlace };
  propagateThirdPlace(result);
  return result;
}

function propagateThirdPlace(t) {
  if (!t.thirdPlace) return;
  const rounds = t.rounds;
  if (rounds.length < 2) return;
  const sfRound = rounds[rounds.length - 2];
  if (sfRound.length !== 2) return;
  const tp = t.thirdPlace;
  const prevA = tp.a?.name;
  const prevB = tp.b?.name;
  const loserOf = (m) => {
    if (!m.a || !m.b) return null;
    if (m.winnerIdx === null) return null;
    return m.winnerIdx === 0 ? m.b : m.a;
  };
  tp.a = loserOf(sfRound[0]);
  tp.b = loserOf(sfRound[1]);
  // Clear stale score if participants changed
  if ((prevA !== tp.a?.name || prevB !== tp.b?.name)
      && tp.scoreA !== 'W' && tp.scoreB !== 'W') {
    tp.scoreA = null; tp.scoreB = null; tp.winnerIdx = null;
  }
}

function getMatchById(rounds, id) {
  for (const r of rounds) for (const m of r) if (m.id === id) return m;
  return null;
}

function propagateSingle(rounds) {
  for (let r = 0; r < rounds.length - 1; r++) {
    rounds[r].forEach((m, idx) => {
      if (m.winnerIdx === null) return;
      const winner = m.winnerIdx === 0 ? m.a : m.b;
      const parent = rounds[r + 1][Math.floor(idx / 2)];
      if (!parent) return;
      if (idx % 2 === 0) parent.a = winner;
      else parent.b = winner;
      // Auto-advance if opposite is BYE
      if (parent.a && !parent.b && parent.bFrom) {
        // bFrom match might have no participants (both BYEs)
        const bParent = getMatchById(rounds, parent.bFrom);
        if (bParent && !bParent.a && !bParent.b) {
          parent.winnerIdx = 0;
          parent.scoreA = 'W'; parent.scoreB = '-';
        }
      }
    });
  }
}

function setScore(t, matchId, sa, sb) {
  // Third place match has no downstream effects
  if (t.thirdPlace && t.thirdPlace.id === matchId) {
    const tp = t.thirdPlace;
    tp.scoreA = sa; tp.scoreB = sb;
    if (sa > sb) tp.winnerIdx = 0;
    else if (sb > sa) tp.winnerIdx = 1;
    else tp.winnerIdx = null;
    return;
  }
  const rounds = t.rounds;
  const m = getMatchById(rounds, matchId);
  if (!m) return;
  m.scoreA = sa;
  m.scoreB = sb;
  if (sa > sb) m.winnerIdx = 0;
  else if (sb > sa) m.winnerIdx = 1;
  else m.winnerIdx = null;
  propagateSingle(rounds);
  propagateThirdPlace(t);
  // If a downstream match's participants changed, clear its score if stale
  for (let r = 0; r < rounds.length; r++) {
    rounds[r].forEach(x => {
      if (x.winnerIdx !== null && x.scoreA !== 'W' && x.scoreB !== 'W') {
        const w = x.winnerIdx === 0 ? x.a : x.b;
        if (!w) { x.winnerIdx = null; x.scoreA = null; x.scoreB = null; }
      }
    });
  }
}

function getChampion(rounds) {
  const lastRound = rounds[rounds.length - 1];
  if (!lastRound || lastRound.length === 0) return null;
  const finalMatch = lastRound[0];
  if (finalMatch.winnerIdx === null) return null;
  return finalMatch.winnerIdx === 0 ? finalMatch.a : finalMatch.b;
}

function roundName(index, total) {
  const remaining = total - index;
  if (remaining === 1) return '결승';
  if (remaining === 2) return '준결승';
  if (remaining === 3) return '8강';
  if (remaining === 4) return '16강';
  if (remaining === 5) return '32강';
  return `${index + 1}R`;
}

/* ---------- Round Robin ---------- */
function buildRoundRobin(participants) {
  const n = participants.length;
  // Circle method — handle odd count with BYE
  const hasBye = n % 2 === 1;
  const players = hasBye ? [...participants, '__BYE__'] : [...participants];
  const m = players.length;
  const rounds = [];
  const total = m - 1;
  // Use indices 0..m-1; fix index 0, rotate the rest
  const ids = Array.from({ length: m }, (_, i) => i);
  for (let r = 0; r < total; r++) {
    const matches = [];
    for (let i = 0; i < m / 2; i++) {
      const aIdx = ids[i];
      const bIdx = ids[m - 1 - i];
      const a = players[aIdx];
      const b = players[bIdx];
      if (a === '__BYE__' || b === '__BYE__') continue;
      matches.push({
        id: `rr${r}_${i}`,
        round: r,
        a: { name: a }, b: { name: b },
        scoreA: null, scoreB: null, winnerIdx: null,
      });
    }
    rounds.push(matches);
    // rotate (keep ids[0] fixed)
    const last = ids.pop();
    ids.splice(1, 0, last);
  }
  return { type: 'roundrobin', rounds, participants: [...participants] };
}

function computeStandings(rr) {
  const table = {};
  rr.participants.forEach(p => {
    table[p] = { name: p, w: 0, l: 0, d: 0, pf: 0, pa: 0, played: 0 };
  });
  rr.rounds.forEach(round => {
    round.forEach(m => {
      if (m.winnerIdx === null || m.scoreA === null) return;
      const ra = table[m.a.name]; const rb = table[m.b.name];
      if (!ra || !rb) return;
      ra.played++; rb.played++;
      ra.pf += +m.scoreA; ra.pa += +m.scoreB;
      rb.pf += +m.scoreB; rb.pa += +m.scoreA;
      if (+m.scoreA > +m.scoreB) { ra.w++; rb.l++; }
      else if (+m.scoreB > +m.scoreA) { rb.w++; ra.l++; }
      else { ra.d++; rb.d++; }
    });
  });
  const rows = Object.values(table).map(r => ({ ...r, pts: r.w * 3 + r.d, diff: r.pf - r.pa }));
  rows.sort((a, b) => b.pts - a.pts || b.diff - a.diff || b.pf - a.pf || a.name.localeCompare(b.name));
  return rows;
}

/* ---------- Double Elimination ----------
   Structure:
   - winners: standard single-elim bracket
   - losers: losers bracket; loser of each winners match drops here
   - grand: grand final (W-champ vs L-champ). If L-champ wins, a reset match fires.

   Losers bracket pairing:
   - LR1: losers from WR1 paired (size/4 matches, if size >=4)
   - LR2: winners of LR1 vs losers from WR2 (minor round)
   - LR3: winners of LR2 paired (major round)
   - ...alternating minor/major until 1 winner remains.
*/
function buildDoubleElimination(participants) {
  const winners = buildSingleElimination(participants);
  const wRounds = winners.rounds.length;
  const size = winners.size;

  // Annotate winners matches: add losersTo field for where loser goes
  const losers = [];

  if (wRounds < 2) {
    // Too few players — fall back to single
    return { ...winners, type: 'double', losers: [], grand: null };
  }

  // Build losers bracket structure (empty slots, filled as matches progress)
  // Total losers rounds = 2*(wRounds-1) for size >= 4
  // Pattern: LR1 pairs WR1 losers, then alternates minor/major:
  //   minor = prev L winners vs next WR round's losers (1:1)
  //   major = halve prev L winners (pair them up)
  let lRoundIdx = 0;

  // LR1: pair WR1 losers → size/4 matches
  const lr1Count = Math.max(1, size / 4);
  const lr1 = [];
  for (let i = 0; i < lr1Count; i++) {
    lr1.push({
      id: `lr1m${i}`,
      round: 0,
      bracket: 'L',
      a: null, b: null,
      scoreA: null, scoreB: null,
      winnerIdx: null,
      aFromW: `r1m${i * 2}`,   // loser of these winners matches
      bFromW: `r1m${i * 2 + 1}`,
      aFromL: null, bFromL: null,
    });
  }
  losers.push(lr1);
  lRoundIdx++;

  // Subsequent rounds: minor first (drop WR_k losers), then major (halve L winners)
  let prevLRoundSize = lr1Count;
  let wRoundForDrop = 2; // next winners round whose losers drop in
  while (wRoundForDrop <= wRounds) {
    // Minor round: prev L winners (1:1) vs losers from WR_wRoundForDrop
    const wRound = winners.rounds[wRoundForDrop - 1];
    if (wRound.length !== prevLRoundSize) break; // safety: power-of-2 invariant
    const minor = [];
    for (let i = 0; i < wRound.length; i++) {
      minor.push({
        id: `lr${lRoundIdx + 1}m${i}`,
        round: lRoundIdx,
        bracket: 'L',
        kind: 'minor',
        a: null, b: null,
        scoreA: null, scoreB: null,
        winnerIdx: null,
        aFromL: `lr${lRoundIdx}m${i}`,
        bFromW: `r${wRoundForDrop}m${i}`,
      });
    }
    losers.push(minor);
    lRoundIdx++;
    wRoundForDrop++;

    // Major round: halve L winners. Skip if no more W losers to drop or only 1 L winner left.
    if (wRoundForDrop <= wRounds && prevLRoundSize > 1) {
      const count = prevLRoundSize / 2;
      const major = [];
      for (let i = 0; i < count; i++) {
        major.push({
          id: `lr${lRoundIdx + 1}m${i}`,
          round: lRoundIdx,
          bracket: 'L',
          kind: 'major',
          a: null, b: null,
          scoreA: null, scoreB: null,
          winnerIdx: null,
          aFromL: `lr${lRoundIdx}m${i * 2}`,
          bFromL: `lr${lRoundIdx}m${i * 2 + 1}`,
        });
      }
      losers.push(major);
      lRoundIdx++;
      prevLRoundSize = count;
    }
  }

  // Grand final: winners champion vs losers champion
  const grand = [{
    id: 'gf1',
    round: 0,
    bracket: 'G',
    kind: 'grand',
    a: null, b: null,
    scoreA: null, scoreB: null,
    winnerIdx: null,
    aFromW: winners.rounds[wRounds - 1][0].id,
    bFromL: losers[losers.length - 1][0].id,
  }, {
    id: 'gf2', // reset match — only active if L-champ wins GF1
    round: 1,
    bracket: 'G',
    kind: 'grand-reset',
    a: null, b: null,
    scoreA: null, scoreB: null,
    winnerIdx: null,
    reset: true,
  }];

  const result = { ...winners, type: 'double', losers, grand };
  propagateDouble(result);
  return result;
}

function propagateDouble(t) {
  const { rounds: winners, losers, grand } = t;
  // 1. Propagate winners bracket normally
  propagateSingle(winners);

  // Helper: loser of a W match
  const wLoser = (m) => {
    if (m.winnerIdx === null) return null;
    if (!m.a || !m.b) return null; // BYE: no loser
    return m.winnerIdx === 0 ? m.b : m.a;
  };
  const lWinner = (m) => {
    if (m.winnerIdx === null) return null;
    return m.winnerIdx === 0 ? m.a : m.b;
  };

  // Build lookup
  const byId = {};
  winners.forEach(r => r.forEach(m => byId[m.id] = m));
  losers.forEach(r => r.forEach(m => byId[m.id] = m));
  if (grand) grand.forEach(m => byId[m.id] = m);

  // 2. Fill losers bracket slots from winners drops and losers progression
  losers.forEach(round => {
    round.forEach(m => {
      // A slot
      if (m.aFromW) {
        const src = byId[m.aFromW];
        m.a = src ? wLoser(src) : null;
      } else if (m.aFromL) {
        const src = byId[m.aFromL];
        m.a = src ? lWinner(src) : null;
      }
      // B slot
      if (m.bFromW) {
        const src = byId[m.bFromW];
        m.b = src ? wLoser(src) : null;
      } else if (m.bFromL) {
        const src = byId[m.bFromL];
        m.b = src ? lWinner(src) : null;
      }

      // Auto-handle walkovers: if one side null (e.g. BYE produced no loser)
      if (m.a && !m.b) {
        // Check if B source is resolved — if resolved and produced no loser, A walks over
        const bSrc = m.bFromW ? byId[m.bFromW] : (m.bFromL ? byId[m.bFromL] : null);
        const bResolved = bSrc && (m.bFromW ? (bSrc.winnerIdx !== null) : (bSrc.winnerIdx !== null));
        if (bResolved && !m.b) {
          m.winnerIdx = 0;
          if (m.scoreA === null) { m.scoreA = 'W'; m.scoreB = '-'; }
        }
      } else if (!m.a && m.b) {
        const aSrc = m.aFromW ? byId[m.aFromW] : (m.aFromL ? byId[m.aFromL] : null);
        const aResolved = aSrc && aSrc.winnerIdx !== null;
        if (aResolved && !m.a) {
          m.winnerIdx = 1;
          if (m.scoreB === null) { m.scoreB = 'W'; m.scoreA = '-'; }
        }
      }
    });
  });

  // 3. Fill grand final
  if (grand) {
    const gf = grand[0];
    const wFinal = winners[winners.length - 1][0];
    const lFinal = losers.length > 0 ? losers[losers.length - 1][0] : null;
    gf.a = wFinal.winnerIdx !== null ? (wFinal.winnerIdx === 0 ? wFinal.a : wFinal.b) : null;
    gf.b = lFinal ? lWinner(lFinal) : null;

    // Grand final reset: only if GF1 winner is the L-champ
    const reset = grand[1];
    if (gf.winnerIdx === 1 && gf.a && gf.b) {
      // L bracket champion won first GF — reset match is active
      reset.a = gf.a;
      reset.b = gf.b;
    } else {
      reset.a = null; reset.b = null;
      reset.winnerIdx = null; reset.scoreA = null; reset.scoreB = null;
    }
  }
}

function setScoreDouble(t, matchId, sa, sb) {
  const all = [];
  t.rounds.forEach(r => r.forEach(m => all.push(m)));
  t.losers.forEach(r => r.forEach(m => all.push(m)));
  if (t.grand) t.grand.forEach(m => all.push(m));
  const m = all.find(x => x.id === matchId);
  if (!m) return;
  m.scoreA = sa;
  m.scoreB = sb;
  if (sa > sb) m.winnerIdx = 0;
  else if (sb > sa) m.winnerIdx = 1;
  else m.winnerIdx = null;
  propagateDouble(t);
}

function getChampionDouble(t) {
  if (!t.grand) return null;
  const gf1 = t.grand[0];
  const gf2 = t.grand[1];
  // If reset happened and has winner
  if (gf2.a && gf2.b && gf2.winnerIdx !== null) {
    return gf2.winnerIdx === 0 ? gf2.a : gf2.b;
  }
  // If GF1 W-champ won
  if (gf1.winnerIdx === 0) {
    return gf1.a;
  }
  return null;
}

window.TournLogic = {
  nextPow2,
  shuffleArray,
  seededOrder,
  buildSingleElimination,
  buildRoundRobin,
  buildDoubleElimination,
  propagateSingle,
  propagateDouble,
  propagateThirdPlace,
  setScore,
  setScoreDouble,
  getChampion,
  getChampionDouble,
  roundName,
  getMatchById,
  computeStandings,
};
