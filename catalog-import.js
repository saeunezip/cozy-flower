/* Read-only image recognition. Only the registration page changes a member's draft. */
(function () {
  'use strict';

  const limit = 20;
  const normalize = (text) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

  function imageCanvas(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  function pixels(image, x, y, w, h, outW, outH) {
    const canvas = imageCanvas(outW, outH);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, x, y, w, h, 0, 0, outW, outH);
    return context.getImageData(0, 0, outW, outH).data;
  }

  function distance(a, b) {
    let total = 0;
    for (let i = 0; i < a.length; i++) total += (a[i] - b[i]) ** 2;
    return total;
  }

  async function openBitmap(file) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(file); } catch (error) { /* Try the platform's image decoder. */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const columns = [147, 311, 475, 640, 804];
  const rows = [788, 952, 1117, 1281, 1445];
  const tileSize = 138;
  const maxAutoMatchDistance = 26;
  const minAutoMatchGap = 5;
  const grades = [
    { top: [251, 130, 174], bottom: [255, 204, 217], names: ['UR', 'UR+'] },
    { top: [252, 218, 94], bottom: [255, 242, 163], names: ['SSR'] },
    { top: [224, 151, 242], bottom: [244, 212, 254], names: ['SR', 'SR+'] },
    { top: [143, 181, 228], bottom: [218, 236, 249], names: [] }, // R
    { top: [176, 211, 112], bottom: [229, 247, 177], names: [] }  // N
  ];
  const rimPoints = [[14, 22], [25, 11], [108, 11], [123, 22], [13, 110], [24, 124], [111, 124], [124, 110]];
  const supportedGrades = new Set(grades.flatMap((grade) => grade.names));

  function squareSample(image, x, y, w, h) {
    const data = pixels(image, x, y, w, h, 32, 32);
    const sample = [];
    for (let row = 3; row <= 28; row++) {
      for (let col = 3; col <= 28; col++) {
        // The exhibition number can cover the top-right corner.
        if (row <= 11 && col >= 21) continue;
        const i = (row * 32 + col) * 4;
        sample.push(data[i], data[i + 1], data[i + 2]);
      }
    }
    return Uint8Array.from(sample);
  }

  function squareDistance(a, b) {
    let score = 0;
    for (let i = 0; i < a.length; i++) score += Math.abs(a[i] - b[i]);
    return score / a.length;
  }

  function cardGrade(pixel, x, y) {
    const votes = grades.map(() => 0);
    for (const [i, [dx, dy]] of rimPoints.entries()) {
      const rgb = pixel(x + dx, y + dy);
      let best = 24 ** 2;
      let index = -1;
      for (const [j, grade] of grades.entries()) {
        const difference = distance(rgb, i < 4 ? grade.top : grade.bottom);
        if (difference < best) { index = j; best = difference; }
      }
      if (index !== -1) votes[index]++;
    }
    const maximum = Math.max(...votes);
    if (maximum < 2 || votes.filter((vote) => vote === maximum).length !== 1) return null;
    return grades[votes.indexOf(maximum)];
  }

  async function readCards(file, references, stopped) {
    const bitmap = await openBitmap(file);
    try {
      const ratio = bitmap.width / bitmap.height;
      if (ratio < .40 || ratio > .54) return null;
      const scaledHeight = Math.round(bitmap.height * 1080 / bitmap.width);
      const canvas = imageCanvas(1080, scaledHeight);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, 1080, scaledHeight);
      const pixel = (x, y) => context.getImageData(x, y, 1, 1).data.subarray(0, 3);
      const center = Math.round((scaledHeight - 2340) / 2);
      let grid;
      for (const shift of [0, -6, 6, -12, 12, -24, 24, -40, 40]) {
        const offset = center + shift;
        const sides = [pixel(83, 710 + offset), pixel(990, 730 + offset)];
        if (!sides.every((rgb) => distance(rgb, [254, 246, 227]) < 28 ** 2)) continue;
        if (distance(pixel(539, 1719 + offset), [246, 234, 208]) > 24 ** 2) continue;
        const tabs = distance(pixel(350, 658 + offset), [169, 223, 247]) < 35 ** 2 ||
          distance(pixel(429, 658 + offset), [202, 175, 254]) < 35 ** 2;
        if (!tabs) continue;
        const slots = rows.flatMap((row) => columns.map((x) => {
          const y = row + offset;
          return { x, y, grade: cardGrade(pixel, x, y) };
        })).filter((slot) => slot.grade);
        if (!grid || slots.length > grid.length) grid = slots;
        if (grid.length === rows.length * columns.length) break;
      }
      if (!grid) return null;

      const cards = [];
      let excluded = 0;
      for (const { x, y, grade } of grid) {
        if (!grade.names.length) {
          excluded++;
          continue;
        }
        const sample = squareSample(canvas, x, y, tileSize, tileSize);
        const ordered = references.map(({ flower, squares }) => ({
          flower,
          score: Math.min(...squares.map((image) => squareDistance(sample, image))) +
            (grade.names.includes(flower.grade) ? 0 : 12)
        })).sort((a, b) => a.score - b.score);
        const preview = imageCanvas(tileSize, tileSize);
        preview.getContext('2d').drawImage(canvas, x, y, tileSize, tileSize, 0, 0, tileSize, tileSize);
        const [first, second] = ordered;
        const choice = first && second && grade.names.includes(first.flower.grade) &&
          first.score <= maxAutoMatchDistance && second.score - first.score >= minAutoMatchGap ? first.flower : null;
        cards.push({ preview: preview.toDataURL('image/jpeg', .85), ordered: ordered.slice(0, 3), choice, skipped: false });
        if (cards.length % columns.length === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (stopped()) return null;
        }
      }
      return { cards, excluded };
    } finally {
      if (bitmap.close) bitmap.close();
    }
  }

  function element(tag, value, className) {
    const node = document.createElement(tag);
    if (value) node.textContent = value;
    if (className) node.className = className;
    return node;
  }

  function button(label, action, className = 'catalog-action') {
    const node = element('button', label, className);
    node.type = 'button';
    node.onclick = action;
    return node;
  }

  window.createCatalogImport = function ({ imageUrl, apply }) {
    const get = (id) => document.getElementById(id);
    const dialog = get('catalogImport');
    const input = get('catalogImportFiles');
    const pick = get('catalogImportPick');
    const status = get('catalogImportStatus');
    const errors = get('catalogImportErrors');
    const matches = get('catalogImportMatches');
    const review = get('catalogImportReview');
    const chooser = get('catalogImportChooser');
    const chooserContent = get('catalogImportChooserContent');
    const count = get('catalogImportCount');
    const applyButton = get('catalogImportApply');
    const cache = new Map();
    let session;
    function reset() {
      if (session) session.abort.abort();
      session = null;
      if (chooser.open) chooser.close();
      if (dialog.open) dialog.close();
    }

    function open(flowers) {
      if (dialog.open) return;
      session = { flowers: flowers.filter((flower) => supportedGrades.has(flower.grade)),
        cards: [], files: new Set(), errors: [], filter: false, excluded: 0,
        scanning: false, message: '', abort: new AbortController() };
      render();
      dialog.showModal();
    }

    async function loadReferences(current) {
      let cursor = 0;
      let loaded = 0;
      const references = [];
      const signal = current.abort.signal;
      async function load() {
        while (cursor < current.flowers.length && !signal.aborted) {
          const flower = current.flowers[cursor++];
          const url = imageUrl(flower);
          let signatures = cache.get(url);
          try {
            if (!signatures) {
              const response = await fetch(url, { signal });
              if (response.ok) {
                const bitmap = await openBitmap(await response.blob());
                try {
                  const crop = (read, margin) => read(bitmap, bitmap.width * margin, bitmap.height * margin,
                    bitmap.width * (1 - 2 * margin), bitmap.height * (1 - 2 * margin));
                  signatures = {
                    squares: [0, .035, .055, .075, .10].map((margin) => crop(squareSample, margin))
                  };
                  cache.set(url, signatures);
                } finally {
                  if (bitmap.close) bitmap.close();
                }
              }
            }
          } catch (error) {
            // A missing reference still allows the flower to be found by name.
          }
          if (signatures) references.push({ flower, ...signatures });
          if (!signal.aborted && (++loaded % 8 === 0 || loaded === current.flowers.length)) {
            status.textContent = '도감 그림 불러오는 중… ' + loaded + ' / ' + current.flowers.length;
          }
        }
      }
      await Promise.all(Array.from({ length: 6 }, load));
      return references;
    }

    function selected(current) {
      return new Map(current.cards.filter((card) => card.choice && !card.choice.unlocked)
        .map((card) => [card.choice.flowerId, card.choice]));
    }

    function pending(current) {
      return current.cards.filter((card) => !card.choice && !card.skipped).length;
    }

    function choose(card, flower) {
      card.choice = flower;
      card.skipped = !flower;
      const index = session.cards.indexOf(card);
      chooser.close();
      render();
      (review.querySelector('[data-card-index="' + index + '"] button') ||
        review.querySelector('input') || applyButton).focus();
    }

    function renderOptions(container, flowers, card) {
      container.replaceChildren();
      for (const flower of flowers) {
        const option = button('', () => choose(card, flower), 'catalog-option');
        option.setAttribute('aria-pressed', String(card.choice?.flowerId === flower.flowerId));
        const img = element('img');
        img.alt = '';
        img.src = imageUrl(flower);
        const label = flower.name + (flower.unlocked ? ' (보유 중)' : '');
        option.append(img, element('span', label), element('small', flower.grade));
        container.append(option);
      }
      if (!flowers.length) container.append(element('p', '일치하는 꽃이 없습니다.'));
    }

    function createSearch(results, card, current, ranked) {
      const search = element('input', '', 'search');
      search.type = 'search';
      search.placeholder = '꽃 이름 일부 입력';
      search.autocomplete = 'off';
      search.setAttribute('aria-label', '도감에서 꽃 이름 검색');
      search.oninput = () => {
        const query = normalize(search.value);
        const flowers = query ? current.flowers.filter((f) => normalize(f.name).includes(query)).slice(0, 12) : ranked;
        renderOptions(results, flowers, card);
      };
      return search;
    }

    function renderCard(card, current) {
      const panel = element('section', '', 'catalog-review');
      const img = element('img');
      img.src = card.preview;
      img.alt = '캡처에서 잘라낸 원본 꽃 카드';
      const right = element('div');
      const heading = element('h3', card.choice ? '선택한 꽃 · ' + card.choice.name :
        card.skipped ? '건너뛴 카드' : '원본과 같은 꽃을 골라 주세요.');
      heading.tabIndex = -1;
      const options = element('div', '', 'catalog-options');
      const controls = element('div', '', 'catalog-review-controls');
      const ranked = card.ordered.map((entry) => entry.flower);
      if (card.choice && !ranked.includes(card.choice)) ranked.unshift(card.choice);
      const suggestions = ranked.slice(0, 3);
      renderOptions(options, suggestions, card);
      const search = createSearch(options, card, current, suggestions);
      controls.append(button('건너뛰기', () => choose(card, null)));
      right.append(heading, search, options, controls);
      panel.append(img, right);
      chooserContent.replaceChildren(panel);
    }

    function renderGrid(current) {
      const controls = element('div', '', 'catalog-grid-tools');
      const label = element('label');
      const filter = document.createElement('input');
      filter.type = 'checkbox';
      filter.checked = current.filter;
      filter.onchange = () => { current.filter = filter.checked; render(); review.querySelector('input').focus(); };
      label.append(filter, element('span', '확인할 꽃만 보기'));
      controls.append(label);
      const grid = element('div', '', 'catalog-grid');
      for (const [index, card] of current.cards.entries()) {
        const needsReview = !card.choice && !card.skipped;
        if (current.filter && !needsReview) continue;
        const tile = element('div', '', 'catalog-tile');
        tile.dataset.cardIndex = String(index);
        tile.dataset.review = String(needsReview);
        tile.dataset.skipped = String(card.skipped);
        const img = element('img');
        img.src = card.preview;
        img.alt = '원본 꽃 카드 ' + (index + 1);
        img.loading = 'lazy';
        const name = card.skipped ? '건너뜀' : (card.choice || card.ordered[0]?.flower)?.name || '꽃 이름 선택';
        const select = button('', () => {
          renderCard(card, current);
          chooser.showModal();
          chooserContent.querySelector('h3').focus();
        }, 'catalog-action catalog-select');
        select.setAttribute('aria-haspopup', 'dialog');
        select.setAttribute('aria-label', (needsReview ? '확인 필요 · ' : '') + name + ' · 이름 변경');
        const arrow = element('span', needsReview ? '?' : '▾', 'catalog-select-arrow');
        arrow.setAttribute('aria-hidden', 'true');
        select.append(element('span', name), arrow);
        tile.append(img, select);
        grid.append(tile);
      }
      review.replaceChildren(controls, grid);
      if (!grid.childElementCount) review.append(element('p', '확인할 꽃이 없습니다.'));
    }

    function render() {
      const current = session;
      if (!current) return;
      const choices = selected(current);
      status.textContent = current.message;
      errors.replaceChildren(...current.errors.map((message) => element('p', message)));
      matches.hidden = !choices.size;
      matches.querySelector('summary').textContent = '새로 보유 체크할 꽃 ' + choices.size + '종';
      matches.querySelector('ul').replaceChildren(...[...choices.values()].map((flower) => element('li', flower.name)));
      count.replaceChildren(element('span', '보유 체크 ' + choices.size + '종'),
        element('span', '확인할 카드 ' + pending(current) + '개'));
      applyButton.disabled = current.scanning || !choices.size;
      pick.disabled = current.scanning;
      pick.textContent = current.files.size ? '이미지 더 추가' : '이미지 선택';
      review.replaceChildren();
      if (current.cards.length) renderGrid(current);
    }

    pick.onclick = () => input.click();
    input.onchange = async () => {
      const files = [...input.files];
      input.value = '';
      const current = session;
      if (!current || !files.length || current.scanning) return;
      current.errors = [];
      if (files.length > limit) {
        current.errors = ['한 번에 최대 ' + limit + '장까지 선택할 수 있습니다.'];
        render();
        return;
      }
      const batch = new Map(files.map((file) => [[file.name, file.size, file.lastModified].join('/'), file]));
      const entries = [...batch].filter(([key]) => !current.files.has(key));
      if (!entries.length) {
        current.errors = ['이미 추가한 이미지입니다.'];
        render();
        return;
      }
      current.scanning = true;
      current.message = '도감 그림 불러오는 중…';
      render();
      try {
        const references = current.references || await loadReferences(current);
        current.references = references;
        for (let i = 0; i < entries.length && session === current; i++) {
          const [key, file] = entries[i];
          status.textContent = '이미지 확인 중… ' + (i + 1) + ' / ' + entries.length;
          try {
            const result = await readCards(file, references, () => session !== current);
            if (session !== current) break;
            if (!result || (!result.cards.length && !result.excluded)) {
              current.errors.push(file.name + ' · 전시할 꽃 선택 화면의 꽃 카드를 찾지 못했습니다.');
            } else {
              current.cards.push(...result.cards);
              current.excluded += result.excluded;
              current.files.add(key);
            }
          } catch (error) {
            current.errors.push(file.name + ' · 파일을 열지 못했습니다.');
          }
        }
        current.message = current.files.size + '장 추가됨 · ' + current.cards.length + '개 카드' +
          (current.excluded ? ' · R/N ' + current.excluded + '개 제외' : '');
        if (!references.length) current.errors.push('비교할 그림을 불러오지 못했습니다. 꽃 이름으로 검색할 수 있습니다.');
      } finally {
        current.scanning = false;
        if (session === current) render();
      }
    };

    applyButton.onclick = () => {
      if (!session || session.scanning) return;
      apply(new Set(selected(session).keys()));
      reset();
    };
    dialog.onclose = () => { if (!dialog.open && session) reset(); };
    return { open, reset };
  };
})();
