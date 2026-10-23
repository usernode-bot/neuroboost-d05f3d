/* NeuroBoost's screen: one workout a day. It loads the summary, runs the
   three exercises in the card, saves each score and deletes rows. */
(function () {
  'use strict';

  var EX = window.NeuroBoostExercises;
  var ORDER = ['reaction', 'memory', 'words'];
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var params = new URLSearchParams(location.search);
  var DEMO = params.get('demo') === '1';
  var TOKEN = params.get('token');

  var state = {
    loading: true,
    phase: 'loading', // loading | error | idle | playing | saving | scored | save-error | done
    current: 'reaction',
    lastScore: null,
    data: { today: [], recent: [], days: [] },
    expanded: null,
    hiddenDemo: new Set()
  };

  var el = {
    demoNote: document.getElementById('demo-note'),
    card: document.getElementById('exercise-card'),
    action: document.getElementById('main-action'),
    steps: document.getElementById('steps'),
    loadError: document.getElementById('load-error'),
    retryLoad: document.getElementById('retry-load'),
    recent: document.getElementById('recent-list'),
    recentLabel: document.getElementById('recent-label'),
    recentEmpty: document.getElementById('recent-empty'),
    progressSection: document.getElementById('progress-section'),
    progressAvg: document.getElementById('progress-avg'),
    progressBars: document.getElementById('progress-bars'),
    progressDays: document.getElementById('progress-days'),
    ring: document.getElementById('ring'),
    ringProgress: document.getElementById('ring-progress'),
    ringBrain: document.getElementById('ring-brain'),
    ringScore: document.getElementById('ring-score')
  };

  if (el.demoNote) el.demoNote.hidden = !DEMO;

  // ── Small helpers ──────────────────────────────────────────────────────
  function localDay(date) {
    var d = date || new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function shiftDay(day, offset) {
    var d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  function dayLabel(day) {
    var today = localDay();
    if (day === today) return "Aujourd'hui";
    if (day === shiftDay(today, -1)) return 'Hier';
    var parts = day.split('-');
    return Number(parts[2]) + ' ' + MONTHS[Number(parts[1]) - 1];
  }

  function timeLabel(iso) {
    try {
      return new Date(iso).toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function api(path, options) {
    options = options || {};
    var headers = Object.assign({}, options.headers || {});
    if (TOKEN) headers['x-usernode-token'] = TOKEN;
    if (options.body) headers['content-type'] = 'application/json';
    return fetch(path, Object.assign({}, options, { headers: headers }));
  }

  function demoQuery() {
    return DEMO ? '?demo=1' : '';
  }

  function doneExercises() {
    var done = {};
    (state.data.today || []).forEach(function (row) { done[row.exercise] = row; });
    return done;
  }

  function nextExercise() {
    var done = doneExercises();
    for (var i = 0; i < ORDER.length; i++) {
      if (!done[ORDER[i]]) return ORDER[i];
    }
    return null;
  }

  // ── Data ───────────────────────────────────────────────────────────────
  function applyPayload(payload) {
    function keep(row) { return !state.hiddenDemo.has(row.id); }
    state.data = {
      today: (payload.today || []).filter(keep),
      recent: (payload.recent || []).filter(keep),
      days: payload.days || []
    };
  }

  function refresh(options) {
    options = options || {};
    var quiet = options.quiet === true;
    if (!quiet) {
      state.loading = true;
      state.phase = 'loading';
      render();
    }
    return api('/api/summary?day=' + localDay() + (DEMO ? '&demo=1' : ''))
      .then(function (res) {
        if (!res.ok) throw new Error('summary ' + res.status);
        return res.json();
      })
      .then(function (payload) {
        applyPayload(payload);
        state.loading = false;
        if (!options.keepPhase) {
          var next = nextExercise();
          state.current = next || 'reaction';
          state.phase = next ? 'idle' : 'done';
        }
        render();
      })
      .catch(function (err) {
        if (quiet) {
          console.warn('summary refresh failed', err);
          return;
        }
        state.loading = false;
        state.phase = 'error';
        render();
      });
  }

  function recordRow(row) {
    var exists = state.data.today.some(function (r) {
      return r.exercise === row.exercise && r.day === row.day;
    });
    if (!exists) state.data.today.push(row);
    state.data.recent = [row].concat(state.data.recent.filter(function (r) {
      return r.id !== row.id;
    })).sort(function (a, b) {
      return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id;
    }).slice(0, 10);
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  function render() {
    renderDemoNote();
    renderRing();
    renderSteps();
    renderCard();
    renderAction();
    renderRecent();
    renderProgress();
    renderError();
  }

  function renderDemoNote() {
    if (el.demoNote) el.demoNote.hidden = !DEMO;
  }

  function renderRing() {
    var today = state.data.today || [];
    var done = ORDER.filter(function (kind) {
      return today.some(function (row) { return row.exercise === kind; });
    }).length;
    var circumference = 188;
    el.ringProgress.setAttribute('stroke-dashoffset', String(circumference * (1 - done / 3)));
    // A zero-length round-capped arc paints a dot at the top: draw nothing.
    el.ringProgress.style.strokeOpacity = done === 0 ? '0' : '';
    if (done === 3 && !state.loading) {
      var scores = today.map(function (row) { return row.score; });
      var average = Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length);
      el.ringBrain.setAttribute('hidden', '');
      el.ringScore.textContent = String(average);
      el.ringScore.removeAttribute('hidden');
      el.ring.setAttribute('aria-label', 'Séance terminée, score ' + average + ' sur 100');
    } else {
      el.ringBrain.removeAttribute('hidden');
      el.ringScore.setAttribute('hidden', '');
      el.ring.setAttribute('aria-label', done + (done === 1 ? ' exercice terminé' : ' exercices terminés') + ' sur 3');
    }
  }

  function renderSteps() {
    var today = state.data.today || [];
    ORDER.forEach(function (kind) {
      var step = document.querySelector('[data-step="' + kind + '"]');
      if (!step) return;
      var isDone = today.some(function (row) { return row.exercise === kind; });
      var isCurrent = !isDone && kind === state.current && state.phase !== 'done' && state.phase !== 'error' && !state.loading;
      step.className = isDone ? 'd' : (isCurrent ? 'c' : '');
    });
  }

  function skeletonCard() {
    el.card.innerHTML =
      '<div class="top"><h2><span class="skeleton sk-title"></span></h2></div>' +
      '<p class="small muted" style="margin:4px 0 16px"><span class="skeleton sk-line"></span></p>' +
      '<div id="ex-stage"><span class="skeleton sk-block"></span></div>' +
      '<p class="small muted" style="margin-top:12px;text-align:center"><span class="skeleton sk-line"></span></p>';
  }

  function cardHeader(kind) {
    var index = ORDER.indexOf(kind) + 1;
    return '<div class="top"><h2>' + index + '. ' + EX.label(kind) + '</h2>' +
      '<span class="chip">' + EX.icon(kind) + EX.shortLabel(kind) + '</span></div>';
  }

  function renderCard() {
    if (state.phase === 'playing') return;
    el.card.hidden = false;
    if (state.loading) {
      skeletonCard();
      return;
    }
    if (state.phase === 'error') {
      el.card.hidden = true;
      return;
    }
    if (state.phase === 'done') {
      var rows = (state.data.today || []).slice().sort(function (a, b) {
        return ORDER.indexOf(a.exercise) - ORDER.indexOf(b.exercise);
      });
      var list = rows.map(function (row) {
        return '<div><span>' + EX.label(row.exercise) + '</span><span class="score">' + row.score + '</span></div>';
      }).join('');
      el.card.innerHTML =
        '<div class="top"><h2>Séance terminée</h2></div>' +
        '<p class="small muted" style="margin:4px 0 8px">Vos trois exercices sont terminés pour aujourd\'hui.</p>' +
        '<div class="session-scores">' + list + '</div>' +
        '<p class="small muted" style="margin-top:12px;text-align:center">Revenez demain pour une nouvelle séance.</p>';
      return;
    }
    if (state.phase === 'saving' || state.phase === 'scored' || state.phase === 'save-error') {
      renderScoreCard();
      return;
    }
    // idle: the next exercise, with a picture of it
    var kind = state.current;
    el.card.innerHTML =
      cardHeader(kind) +
      '<p class="small muted" style="margin:4px 0 16px">' + EX.description(kind) + '</p>' +
      '<div id="ex-stage"></div>' +
      '<p class="small muted" id="ex-note" style="margin-top:12px;text-align:center">' + EX.previewNote(kind) + '</p>';
    EX.preview(kind, el.card.querySelector('#ex-stage'), localDay());
  }

  function renderScoreCard() {
    var kind = state.current;
    var note = 'Score enregistré.';
    var retry = '';
    if (state.phase === 'saving') note = 'Enregistrement…';
    if (state.phase === 'save-error') {
      note = "Votre score n'a pas été enregistré.";
      retry = '<button class="btn-secondary" id="retry-save" type="button" style="width:100%;margin-top:12px">Réessayer</button>';
    }
    el.card.innerHTML =
      cardHeader(kind) +
      '<p class="small muted" style="margin:4px 0 0">Terminé</p>' +
      '<div class="result-box"><span class="score result-score">' + state.lastScore + '</span>' +
      '<span class="small muted">/ 100</span></div>' +
      '<p class="small' + (state.phase === 'save-error' ? ' note-miss' : ' muted') + '" id="ex-note" style="text-align:center">' + note + '</p>' +
      retry;
    var retryButton = el.card.querySelector('#retry-save');
    if (retryButton) {
      retryButton.addEventListener('click', function () {
        saveScore(kind, state.lastScore);
      });
    }
  }

  function renderAction() {
    var show = state.phase === 'idle' || state.phase === 'scored';
    el.action.hidden = !show;
    if (!show) return;
    el.action.textContent = state.phase === 'idle' ? 'Commencer' : 'Suivant';
  }

  function renderError() {
    el.loadError.hidden = state.phase !== 'error';
  }

  function skeletonRow() {
    var row = document.createElement('li');
    row.className = 'list-row';
    row.innerHTML = '<span class="dot" style="background:rgb(var(--line))"></span>' +
      '<div class="t"><span class="skeleton sk-line"></span><span class="skeleton sk-line" style="width:45%"></span></div>' +
      '<span class="skeleton sk-score"></span>';
    return row;
  }

  function renderRecent() {
    if (state.loading) {
      if (el.recentLabel) el.recentLabel.hidden = false;
      el.recent.hidden = false;
      el.recentEmpty.hidden = true;
      el.recent.innerHTML = '';
      for (var i = 0; i < 3; i++) el.recent.appendChild(skeletonRow());
      return;
    }
    if (state.phase === 'error') {
      if (el.recentLabel) el.recentLabel.hidden = true;
      el.recent.hidden = true;
      el.recentEmpty.hidden = true;
      return;
    }
    if (el.recentLabel) el.recentLabel.hidden = false;
    var recent = state.data.recent || [];
    if (!recent.length) {
      el.recent.hidden = true;
      el.recentEmpty.hidden = false;
      return;
    }
    el.recentEmpty.hidden = true;
    el.recent.hidden = false;
    el.recent.innerHTML = '';
    recent.forEach(function (row) {
      var li = document.createElement('li');
      li.className = 'list-row row';
      var main = document.createElement('button');
      main.type = 'button';
      main.className = 'row-main';
      main.setAttribute('aria-expanded', state.expanded === row.id ? 'true' : 'false');
      main.innerHTML = '<span class="dot" style="background:' +
        (row.score >= 50 ? 'rgb(var(--hit))' : 'rgb(var(--miss))') + '"></span>' +
        '<div class="t"><p>' + EX.label(row.exercise) + '</p>' +
        '<p class="small muted">' + dayLabel(row.day) + ', ' + timeLabel(row.created_at) + '</p></div>' +
        '<span class="score">' + row.score + '</span>';
      main.addEventListener('click', function () {
        state.expanded = state.expanded === row.id ? null : row.id;
        renderRecent();
      });
      li.appendChild(main);
      if (state.expanded === row.id) {
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-secondary row-delete';
        remove.textContent = 'Supprimer ce résultat';
        remove.addEventListener('click', function () { deleteRow(row); });
        li.appendChild(remove);
      }
      el.recent.appendChild(li);
    });
  }

  function renderProgress() {
    if (state.loading) {
      el.progressSection.hidden = false;
      el.progressAvg.innerHTML = '<span class="skeleton sk-score"></span>';
      el.progressBars.innerHTML = '';
      el.progressDays.innerHTML = '';
      for (var i = 0; i < 7; i++) {
        var bar = document.createElement('i');
        bar.className = 'sk';
        bar.style.height = (30 + i * 8) + '%';
        el.progressBars.appendChild(bar);
      }
      return;
    }
    if (state.phase === 'error') {
      el.progressSection.hidden = true;
      return;
    }
    var days = state.data.days || [];
    if (!days.length) {
      el.progressSection.hidden = true;
      return;
    }
    el.progressSection.hidden = false;
    var average = Math.round(days.reduce(function (sum, d) { return sum + d.average; }, 0) / days.length);
    el.progressAvg.textContent = String(average);
    el.progressBars.innerHTML = '';
    el.progressDays.innerHTML = '';
    days.forEach(function (day, index) {
      var bar = document.createElement('i');
      bar.style.height = Math.max(4, Math.min(100, day.average)) + '%';
      el.progressBars.appendChild(bar);
      var label = document.createElement('span');
      var parts = day.day.split('-');
      label.textContent = index === 0
        ? Number(parts[2]) + ' ' + MONTHS[Number(parts[1]) - 1]
        : String(Number(parts[2]));
      el.progressDays.appendChild(label);
    });
  }

  // ── Running an exercise ────────────────────────────────────────────────
  function setNote(text, isMiss) {
    var note = document.getElementById('ex-note');
    if (!note) return;
    note.textContent = text;
    note.className = 'small' + (isMiss ? ' note-miss' : ' muted');
  }

  function flash(type) {
    var stage = document.getElementById('ex-stage');
    if (!stage) return;
    stage.classList.remove('flash-hit', 'flash-miss');
    void stage.offsetWidth;
    stage.classList.add(type === 'hit' ? 'flash-hit' : 'flash-miss');
    setTimeout(function () { stage.classList.remove('flash-hit', 'flash-miss'); }, 420);
  }

  function startExercise() {
    var kind = nextExercise();
    if (!kind) return;
    state.current = kind;
    state.phase = 'playing';
    el.card.hidden = false;
    el.card.innerHTML =
      cardHeader(kind) +
      '<p class="small muted" style="margin:4px 0 16px">' + EX.description(kind) + '</p>' +
      '<div id="ex-stage"></div>' +
      '<p class="small muted" id="ex-note" style="margin-top:12px;text-align:center"></p>';
    renderAction();
    renderSteps();
    EX.run(kind, document.getElementById('ex-stage'), {
      day: localDay(),
      note: setNote,
      flash: flash,
      onDone: function (score) {
        state.lastScore = score;
        state.phase = 'saving';
        renderCard();
        renderAction();
        saveScore(kind, score);
      }
    });
  }

  function saveScore(kind, score) {
    state.phase = 'saving';
    renderCard();
    renderAction();
    api('/api/results' + demoQuery(), {
      method: 'POST',
      body: JSON.stringify({ exercise: kind, score: score, day: localDay() })
    }).then(function (res) {
      if (res.status === 409) {
        // Already recorded today: reload what the server has.
        state.phase = 'scored';
        return refresh({ quiet: true, keepPhase: true });
      }
      if (!res.ok) throw new Error('save ' + res.status);
      return res.json().then(function (row) {
        recordRow(row);
        state.phase = 'scored';
        return refresh({ quiet: true, keepPhase: true });
      });
    }).catch(function (err) {
      console.warn('score not saved', err);
      state.phase = 'save-error';
      renderCard();
      renderAction();
    });
  }

  function advance() {
    var next = nextExercise();
    if (!next) {
      state.phase = 'done';
      state.current = ORDER[0];
    } else {
      state.phase = 'idle';
      state.current = next;
    }
    render();
  }

  function deleteRow(row) {
    if (state.phase === 'playing' || state.phase === 'saving') return;
    api('/api/results/' + row.id + demoQuery(), { method: 'DELETE' })
      .then(function (res) {
        if (!res.ok) throw new Error('delete ' + res.status);
        state.expanded = null;
        if (row.id < 0) state.hiddenDemo.add(row.id);
        state.data.today = state.data.today.filter(function (r) { return r.id !== row.id; });
        state.data.recent = state.data.recent.filter(function (r) { return r.id !== row.id; });
        afterTodayChange(row);
        // The demo's days and scores are fixed server-side; the real rows
        // come back from the summary. Both render through the same path.
        refresh({ quiet: true, keepPhase: true }).catch(function () {});
      })
      .catch(function (err) { console.warn('result not deleted', err); });
  }

  // A deleted result reopens its exercise. When the session was finished,
  // the screen goes back to the workout.
  function afterTodayChange(row) {
    var isToday = row.day === localDay();
    if (!isToday) return;
    if (state.phase === 'done') {
      state.phase = 'idle';
      state.current = nextExercise() || row.exercise;
    } else if (state.phase === 'scored' && state.current === row.exercise) {
      state.phase = 'idle';
      state.current = row.exercise;
    } else if (state.phase === 'idle') {
      // Another exercise may now be the first still to do.
      var next = nextExercise();
      if (next) state.current = next;
      else state.phase = 'done';
    }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  el.action.addEventListener('click', function () {
    if (state.phase === 'idle') startExercise();
    else if (state.phase === 'scored') advance();
  });

  el.retryLoad.addEventListener('click', function () {
    refresh();
  });

  render();
  refresh();
})();
