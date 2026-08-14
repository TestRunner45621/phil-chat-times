/* library.js — renders the archive grid from editions.json. */

(function () {
  'use strict';

  var grid = document.getElementById('grid');

  function longDate(iso) {
    var d = new Date(iso + 'T12:00:00');
    return isNaN(d)
      ? iso
      : d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
  }

  function card(ed) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.className = 'card';
    a.href = 'read.html#/' + ed.slug + '/1';

    var frame = document.createElement('div');
    frame.className = 'card__frame';

    var img = document.createElement('img');
    img.className = 'card__img';
    img.src = ed.cover;
    img.alt = 'Front page of ' + ed.title;
    img.loading = 'lazy';
    img.decoding = 'async';
    frame.appendChild(img);

    var badge = document.createElement('span');
    badge.className = 'card__badge';
    badge.textContent = ed.pages + ' pages';
    frame.appendChild(badge);

    var meta = document.createElement('div');
    meta.className = 'card__meta';
    meta.innerHTML =
      '<div class="card__no"></div><p class="card__date"></p>' +
      '<p class="card__headline"></p>';
    meta.querySelector('.card__no').textContent =
      'Vol ' + ed.romanVolume + ' · No ' + ed.number;
    meta.querySelector('.card__date').textContent = longDate(ed.date);
    meta.querySelector('.card__headline').textContent = ed.headline || '';

    a.appendChild(frame);
    a.appendChild(meta);
    li.appendChild(a);
    return li;
  }

  /* An issue that is written but not yet printed still gets a slot, so the run
   * reads continuously and the next one is visibly on its way. */
  function pendingCard(ed) {
    var li = document.createElement('li');
    li.innerHTML =
      '<div class="card card--pending"><div class="card__frame">' +
      '<span>In production</span></div><div class="card__meta">' +
      '<div class="card__no"></div><p class="card__date"></p></div></div>';
    li.querySelector('.card__no').textContent =
      'Vol ' + ed.romanVolume + ' · No ' + ed.number;
    li.querySelector('.card__date').textContent = longDate(ed.date);
    return li;
  }

  fetch('editions.json', { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (data) {
      var editions = (data.editions || []).slice().reverse(); // newest first
      grid.innerHTML = '';

      if (!editions.length) {
        grid.innerHTML = '<li class="notice">No editions published yet.</li>';
        return;
      }

      (data.upcoming || [])
        .slice()
        .reverse()
        .forEach(function (ed) {
          grid.appendChild(pendingCard(ed));
        });

      editions.forEach(function (ed) {
        grid.appendChild(card(ed));
      });

      var latest = editions[0];
      document.getElementById('dateline-run').textContent =
        longDate(editions[editions.length - 1].date) +
        ' — ' +
        longDate(latest.date);
      document.getElementById('dateline-count').textContent =
        editions.length +
        ' edition' +
        (editions.length === 1 ? '' : 's') +
        ' · ' +
        editions.reduce(function (n, e) {
          return n + e.pages;
        }, 0) +
        ' pages';
    })
    .catch(function (err) {
      grid.innerHTML =
        '<li class="notice">Could not load the archive (' +
        err.message +
        ').<br />If you opened this file directly, serve the folder over ' +
        'HTTP instead — see the README.</li>';
    });
})();
