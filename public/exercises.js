/* NeuroBoost's three daily exercises, played in plain DOM inside the
   exercise card. Their content (delays, patterns, words) comes from a
   seeded PRNG over the local day, so it is the same for everyone that day
   and changes at midnight. */
(function () {
  'use strict';

  var LABELS = {
    reaction: 'Réaction rapide',
    memory: 'Mémoire des cases',
    words: 'Anagrammes'
  };
  var SHORT = { reaction: 'Réaction', memory: 'Mémoire', words: 'Mots' };
  var DESCRIPTIONS = {
    reaction: "Un cercle s'allume après un court délai. Touchez-le le plus vite possible.",
    memory: 'Retenez les cases allumées, puis touchez-les dans la grille vide.',
    words: "Remettez les lettres dans l'ordre. 20 secondes par mot."
  };
  var PREVIEW_NOTES = {
    reaction: "5 manches, réagissez dès que le cercle s'allume",
    memory: '5 manches, de 3 à 5 cases à retenir',
    words: '5 mots, 20 secondes par mot'
  };
  var ICONS = {
    reaction: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
    memory: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    words: '<rect x="3" y="5" width="8" height="14" rx="1.5"/><rect x="13" y="5" width="8" height="14" rx="1.5"/><path d="M6 13h2M16 9v6"/>'
  };

  // About 80 common French words, 5 to 7 letters, written without accents
  // so a typed answer matches however it is spelled.
  var WORDS = [
    'maison', 'jardin', 'soleil', 'cheval', 'poisson', 'arbre', 'livre',
    'table', 'chaise', 'porte', 'nuage', 'pluie', 'neige', 'feuille',
    'fleur', 'riviere', 'etoile', 'terre', 'ecole', 'classe', 'crayon',
    'cahier', 'gomme', 'regle', 'stylo', 'enfant', 'famille', 'frere',
    'soeur', 'chien', 'oiseau', 'vache', 'cochon', 'poule', 'canard',
    'lapin', 'souris', 'tigre', 'singe', 'renard', 'cerise', 'pomme',
    'poire', 'fraise', 'citron', 'orange', 'banane', 'tomate', 'carotte',
    'salade', 'soupe', 'fromage', 'beurre', 'sucre', 'sirop', 'gateau',
    'tarte', 'crepe', 'bonbon', 'musique', 'danse', 'chanson', 'guitare',
    'piano', 'theatre', 'cinema', 'voyage', 'voiture', 'train', 'avion',
    'bateau', 'route', 'ville', 'village', 'matin', 'semaine', 'lundi',
    'mardi', 'heure', 'minute', 'seconde', 'couleur', 'rouge', 'jaune',
    'blanc', 'petit', 'froid', 'chaud', 'lumiere', 'lettre', 'phrase',
    'papier', 'dessin', 'photo', 'pierre', 'plage', 'vague', 'marche',
    'ballon', 'equipe', 'partie', 'niveau', 'effort', 'sourire', 'esprit',
    'cerveau', 'memoire', 'logique', 'nombre', 'chiffre', 'calcul',
    'reponse', 'langue', 'parole'
  ];

  function hashDay(text) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // mulberry32: small, fast, and the same sequence whenever it is seeded
  // with the same day.
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rngFor(day, salt) {
    return mulberry32(hashDay(day + ':' + salt));
  }

  function shuffle(list, rng) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function normalise(text) {
    return String(text)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }

  function jumbleWord(word, rng) {
    var letters = word.split('');
    if (letters.length < 2) return word;
    for (var attempt = 0; attempt < 12; attempt++) {
      letters = shuffle(word.split(''), rng);
      if (letters.join('') !== word) break;
    }
    return letters.join('');
  }

  function pickWords(day) {
    return shuffle(WORDS, rngFor(day, 'words')).slice(0, 5);
  }

  function icon(kind) {
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[kind] || '') + '</svg>';
  }

  // The still picture of an exercise, shown before it starts.
  function preview(kind, stage, day) {
    if (kind === 'memory') {
      var rng = rngFor(day, 'memory');
      var lit = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8], rng).slice(0, 3);
      var cells = '';
      for (var i = 0; i < 9; i++) {
        cells += '<div class="tile' + (lit.indexOf(i) >= 0 ? ' on' : '') + '"></div>';
      }
      stage.innerHTML = '<div class="grid">' + cells + '</div>';
      return;
    }
    if (kind === 'words') {
      var first = pickWords(day)[0];
      stage.innerHTML = '<p class="jumble">' +
        jumbleWord(first, rngFor(day, 'words-preview')).toUpperCase().split('').join(' ') +
        '</p>';
      return;
    }
    stage.innerHTML = '<div class="react-wrap"><div class="react-circle" aria-hidden="true"></div></div>';
  }

  // ── Reaction: 5 rounds, tap the circle as soon as it lights. ───────────
  function runReaction(stage, opts) {
    var rng = rngFor(opts.day, 'reaction');
    var scores = [];
    var round = 0;
    var waiting = false;
    var armed = false;
    var locked = false;
    var goAt = 0;
    var timer = null;

    stage.innerHTML = '<div class="react-wrap">' +
      '<button type="button" class="react-circle" id="react-circle" aria-label="Cercle de réaction"></button>' +
      '</div>';
    var circle = stage.querySelector('#react-circle');

    function startRound() {
      round += 1;
      locked = false;
      waiting = true;
      armed = false;
      circle.className = 'react-circle';
      circle.setAttribute('aria-label', 'Cercle de réaction, manche ' + round + ' sur 5');
      opts.note('Manche ' + round + ' sur 5. Attendez que le cercle s\'allume.', false);
      timer = setTimeout(light, 800 + Math.round(rng() * 1400));
    }

    function light() {
      if (locked) return;
      waiting = false;
      armed = true;
      goAt = performance.now();
      circle.classList.add('go');
      opts.note('Touchez !', false);
      timer = setTimeout(function () { finish(0, false, null); }, 1600);
    }

    function tap() {
      if (locked) return;
      if (waiting) { finish(0, true, null); return; }
      if (!armed) return;
      var elapsed = performance.now() - goAt;
      var score = Math.max(0, Math.min(100, Math.round(100 * (750 - elapsed) / 500)));
      finish(score, false, elapsed);
    }

    function finish(score, early, elapsed) {
      locked = true;
      waiting = false;
      armed = false;
      clearTimeout(timer);
      scores.push(score);
      circle.className = 'react-circle done';
      if (early) opts.note('Trop tôt : cette manche compte 0.', true);
      else if (score > 0) opts.note(Math.round(elapsed) + ' ms', false);
      else opts.note('Trop lent : cette manche compte 0.', true);
      opts.flash(score > 0 ? 'hit' : 'miss');
      timer = setTimeout(function () {
        if (round < 5) startRound();
        else opts.onDone(Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length));
      }, 750);
    }

    circle.addEventListener('pointerdown', function (event) {
      event.preventDefault();
      tap();
    });
    circle.addEventListener('click', tap);
    startRound();
  }

  // ── Memory: 5 rounds on a 3x3 grid, 3, 3, 4, 4 then 5 squares. ────────
  function runMemory(stage, opts) {
    var rng = rngFor(opts.day, 'memory');
    var counts = [3, 3, 4, 4, 5];
    var scores = [];
    var round = 0;

    var grid = '';
    for (var i = 0; i < 9; i++) {
      grid += '<button type="button" class="tile locked" data-i="' + i + '" aria-label="Case ' + (i + 1) + '"></button>';
    }
    stage.innerHTML = '<div class="grid" id="mem-grid">' + grid + '</div>';
    var tiles = Array.prototype.slice.call(stage.querySelectorAll('.tile'));

    function startRound() {
      round += 1;
      var count = counts[round - 1];
      var lit = new Set(shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8], rng).slice(0, count));
      var found = 0;
      var wrong = 0;
      var accepting = false;

      tiles.forEach(function (tile, i) {
        tile.className = 'tile locked' + (lit.has(i) ? ' on' : '');
        tile.setAttribute('aria-label', 'Case ' + (i + 1));
      });
      opts.note('Manche ' + round + ' sur 5. Retenez ' + count + ' cases.', false);

      setTimeout(function () {
        if (!tiles.length) return;
        tiles.forEach(function (tile) { tile.className = 'tile'; });
        accepting = true;
        opts.note('Touchez les ' + count + ' cases allumées.', false);
      }, 900 + count * 200);

      function end() {
        if (!accepting) return;
        accepting = false;
        var score = Math.max(0, Math.min(100, Math.round(((found - wrong) / count) * 100)));
        scores.push(score);
        tiles.forEach(function (tile, i) {
          tile.classList.add('locked');
          if (lit.has(i) && !tile.classList.contains('found')) tile.classList.add('on');
        });
        opts.note('Trouvées : ' + found + ' sur ' + count + '.', false);
        opts.flash(score >= 50 ? 'hit' : 'miss');
        setTimeout(function () {
          if (round < 5) startRound();
          else opts.onDone(Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length));
        }, 800);
      }

      function press(i) {
        if (!accepting) return;
        if (lit.has(i)) {
          if (tiles[i].classList.contains('found')) return;
          tiles[i].classList.add('found');
          found += 1;
          if (found === count) end();
        } else {
          wrong += 1;
          tiles[i].classList.add('wrong');
          setTimeout(function () { tiles[i].classList.remove('wrong'); }, 260);
          if (wrong >= 3) end();
        }
      }

      tiles.forEach(function (tile, i) {
        tile.onclick = function () { press(i); };
      });
    }

    startRound();
  }

  // ── Words: 5 jumbled words, 20 seconds each, 20 points a word. ────────
  function runWords(stage, opts) {
    var words = pickWords(opts.day);
    var shaker = rngFor(opts.day, 'words-shuffle');
    var index = 0;
    var correct = 0;
    var current = '';
    var deadline = 0;
    var tick = null;
    var locked = false;

    stage.innerHTML = '<form class="word-form" id="word-form" novalidate>' +
      '<p class="jumble" id="word-jumble" aria-hidden="true"></p>' +
      '<div>' +
      '<label class="small muted" for="word-input">Votre réponse</label>' +
      '<div class="word-row">' +
      '<input class="field" id="word-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ex. maison">' +
      '<button class="btn-secondary" id="word-submit" type="submit">Valider</button>' +
      '</div></div>' +
      '<div class="word-meta"><span class="small muted" id="word-time">20 s</span>' +
      '<button class="btn-secondary" id="word-skip" type="button">Passer</button></div>' +
      '</form>';

    var form = stage.querySelector('#word-form');
    var jumble = stage.querySelector('#word-jumble');
    var input = stage.querySelector('#word-input');
    var time = stage.querySelector('#word-time');
    var skip = stage.querySelector('#word-skip');

    function startWord() {
      current = words[index];
      locked = false;
      input.value = '';
      input.disabled = false;
      jumble.textContent = jumbleWord(current, shaker).toUpperCase().split('').join(' ');
      opts.note('Mot ' + (index + 1) + ' sur 5. 20 secondes.', false);
      deadline = Date.now() + 20000;
      updateTime();
      clearInterval(tick);
      tick = setInterval(updateTime, 250);
      try { input.focus(); } catch (e) {}
    }

    function updateTime() {
      var left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      time.textContent = left + ' s';
      if (left <= 0 && !locked) {
        locked = true;
        clearInterval(tick);
        opts.note('Temps écoulé.', true);
        opts.flash('miss');
        setTimeout(next, 750);
      }
    }

    function next() {
      index += 1;
      if (index >= words.length) {
        opts.onDone(correct * 20);
        return;
      }
      startWord();
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (locked) return;
      var answer = normalise(input.value);
      if (!answer) return;
      if (answer === normalise(current)) {
        correct += 1;
        locked = true;
        clearInterval(tick);
        opts.note('Bien.', false);
        opts.flash('hit');
        setTimeout(next, 750);
      } else {
        opts.note("Ce n'est pas le mot. Réessayez.", true);
        opts.flash('miss');
        input.select();
      }
    });

    skip.addEventListener('click', function () {
      if (locked) return;
      locked = true;
      clearInterval(tick);
      opts.note('Mot passé.', false);
      next();
    });

    startWord();
  }

  function run(kind, stage, opts) {
    if (kind === 'reaction') runReaction(stage, opts);
    else if (kind === 'memory') runMemory(stage, opts);
    else runWords(stage, opts);
  }

  window.NeuroBoostExercises = {
    run: run,
    preview: preview,
    icon: icon,
    label: function (kind) { return LABELS[kind] || ''; },
    shortLabel: function (kind) { return SHORT[kind] || ''; },
    description: function (kind) { return DESCRIPTIONS[kind] || ''; },
    previewNote: function (kind) { return PREVIEW_NOTES[kind] || ''; }
  };
})();
