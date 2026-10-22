(function (global) {
  'use strict';
  global.createFlowerUpdates = function (options) {
    const el = function (id) { return document.getElementById(id); };
    const button = el('flowerUpdatesButton'), modal = el('flowerUpdatesModal');
    let data = null, loading = false, importing = false, tab = 'ready', previousFocus = null, previousOverflow = '';
    const selected = new Set(), errors = new Map(), operations = new Map();
    const grades = { 'UR+': 'grade-ur-plus', UR: 'grade-ur', SSR: 'grade-ssr', 'SR+': 'grade-sr-plus', SR: 'grade-sr' };
    function node(tag, className, text) {
      const n = document.createElement(tag);
      if (className) n.className = className;
      if (text !== undefined) n.textContent = text;
      return n;
    }
    function message(text, bad) {
      const box = el('flowerUpdatesMessage');
      box.hidden = !text; box.textContent = text || ''; box.classList.toggle('bad', !!bad);
    }
    function ready() { return data ? data.candidates.filter(function (item) { return item.kind === 'ready'; }) : []; }
    function syncControls() {
      const blocked = loading || importing || options.isBusy();
      button.disabled = importing || options.isBusy();
      el('refreshFlowerUpdates').disabled = blocked;
      el('closeFlowerUpdates').disabled = importing;
      modal.querySelectorAll('input, [data-link-flower]').forEach(function (n) { n.disabled = blocked; });
      el('selectAllFlowerUpdates').disabled = blocked || !ready().length;
      el('importFlowerUpdates').disabled = blocked || !selected.size || tab !== 'ready';
      el('importFlowerUpdates').textContent = importing ? '등록 중…' : '선택한 ' + selected.size + '개 등록';
      el('flowerUpdatesSelection').textContent = selected.size + '개 선택';
      const all = el('selectAllFlowerUpdates');
      all.checked = !!ready().length && selected.size === ready().length;
      all.indeterminate = selected.size > 0 && selected.size < ready().length;
    }
    function render() {
      const count = data ? data.count : null;
      button.textContent = '꽃 업데이트 - ' + (count === null ? (loading ? '확인 중' : '확인 필요') : count + '개');
      button.title = data && data.error ? '마지막 확인에 실패했습니다. 팝업에서 다시 확인해 주세요.' : '새 꽃을 선택해 등록';
      const items = data ? data.candidates : [];
      const available = ready(), review = items.filter(function (item) { return item.kind !== 'ready'; });
      const currentIds = new Set(available.map(function (item) { return item.sourceId; }));
      selected.forEach(function (id) { if (!currentIds.has(id)) selected.delete(id); });
      el('flowerUpdatesReadyTab').textContent = '등록 가능 ' + available.length;
      el('flowerUpdatesReviewTab').textContent = '확인·예정 ' + review.length;
      el('flowerUpdatesTime').textContent = data && data.checkedAt ? '마지막 확인 ' + new Date(data.checkedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '마지막 확인 기록 없음';
      el('flowerUpdatesList').replaceChildren(); el('flowerUpdatesReviewList').replaceChildren();
      available.forEach(function (item) { renderItem(item, el('flowerUpdatesList'), true); });
      review.forEach(function (item) { renderItem(item, el('flowerUpdatesReviewList'), false); });
      if (!available.length) el('flowerUpdatesList').appendChild(node('div', 'empty', loading ? '새 꽃을 확인하고 있습니다…' : !data || !data.checkedAt ? '아직 꽃 목록을 확인하지 못했습니다.' : '새로 등록할 꽃이 없습니다.'));
      if (!review.length) el('flowerUpdatesReviewList').appendChild(node('div', 'empty', '확인이 필요한 꽃이 없습니다.'));
      setTab(tab); syncControls();
    }
    function renderItem(item, list, selectable) {
      const row = node('div', 'flower-update-row'), content = node('div', 'flower-update-content');
      const label = node(selectable ? 'label' : 'div', 'flower-update-label');
      if (selectable) {
        const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.id = 'source-' + item.sourceId;
        checkbox.checked = selected.has(item.sourceId); checkbox.dataset.sourceId = item.sourceId;
        checkbox.onchange = function () { if (checkbox.checked) selected.add(item.sourceId); else selected.delete(item.sourceId); syncControls(); };
        label.htmlFor = checkbox.id; row.appendChild(checkbox);
      }
      label.appendChild(node('span', 'grade ' + (grades[item.grade] || ''), item.grade));
      label.appendChild(node('span', 'flower-update-name', item.name)); content.appendChild(label);
      const detail = node('div', 'flower-update-detail');
      detail.appendChild(node('span', '', selectable ? item.score + '점 · 현재 획득 가능' : item.reason));
      const link = node('a', '', '원본 보기 ↗'); link.href = item.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; detail.appendChild(link); content.appendChild(detail);
      if (item.kind === 'alias') item.matches.forEach(function (match) {
        const alias = node('div', 'flower-update-alias'); alias.appendChild(node('span', '', '기존: ' + match.name));
        const connect = node('button', 'ghost', '이 꽃으로 연결'); connect.type = 'button'; connect.dataset.linkFlower = item.sourceId;
        connect.onclick = function () { linkExisting(item, match); }; alias.appendChild(connect); content.appendChild(alias);
      });
      if (errors.has(item.sourceId)) content.appendChild(node('div', 'flower-update-error', errors.get(item.sourceId)));
      row.appendChild(content); list.appendChild(row);
    }
    function setTab(next) {
      tab = next;
      el('flowerUpdatesReady').hidden = tab !== 'ready'; el('flowerUpdatesReview').hidden = tab !== 'review';
      el('flowerUpdatesReadyTab').setAttribute('aria-selected', String(tab === 'ready'));
      el('flowerUpdatesReviewTab').setAttribute('aria-selected', String(tab === 'review'));
      syncControls();
    }
    async function load(force) {
      if (loading || importing) return;
      loading = true; message('새 꽃을 확인하고 있습니다.'); render();
      try {
        data = await options.api(force ? 'refreshFlowerUpdates' : 'adminFlowerUpdates');
        selected.clear();
        errors.clear();
        message(data.error ? '마지막 확인에 실패했습니다. ' + data.error + (data.checkedAt ? '\n이전 확인 목록을 표시합니다.' : '') : '', !!data.error);
      } catch (error) { message(error.message, true); }
      finally { loading = false; render(); }
    }
    function open() {
      if (options.isBusy()) return;
      previousFocus = document.activeElement; previousOverflow = document.body.style.overflow;
      modal.classList.add('show'); document.body.style.overflow = 'hidden';
      button.setAttribute('aria-expanded', 'true');
      el('closeFlowerUpdates').focus();
      if (!data && !loading) load();
    }
    function close() {
      if (importing) return;
      modal.classList.remove('show'); document.body.style.overflow = previousOverflow;
      button.setAttribute('aria-expanded', 'false');
      if (previousFocus) previousFocus.focus();
    }
    async function linkExisting(item, match) {
      if (loading || importing || options.isBusy()) return;
      importing = true; options.setBusy(true); syncControls();
      try {
        await options.api('linkFlowerUpdate', { sourceId: item.sourceId, fingerprint: item.fingerprint, flowerId: match.flowerId });
        data = await options.api('adminFlowerUpdates');
        message('‘' + item.name + '’을 기존 ‘' + match.name + '’과 연결했습니다. 기존 이름과 보유 정보는 유지됩니다.');
      } catch (error) { message(error.message, true); }
      finally { importing = false; options.setBusy(false); render(); }
    }
    async function importSelected() {
      if (loading || importing || options.isBusy() || !selected.size) return;
      const items = ready().filter(function (item) { return selected.has(item.sourceId); });
      let succeeded = 0;
      importing = true; options.setBusy(true); errors.clear(); syncControls(); message('선택한 꽃과 이미지를 등록하고 있습니다.');
      for (let i = 0; i < items.length; i++) {
        const item = items[i], key = item.sourceId + ':' + item.fingerprint;
        if (!operations.has(key)) operations.set(key, crypto.randomUUID());
        el('flowerUpdatesProgress').textContent = (i + 1) + ' / ' + items.length + ' · ' + item.name + ' 등록 중';
        try {
          const result = await options.api('importFlowerUpdate', { sourceId: item.sourceId, fingerprint: item.fingerprint,
            expectedRevision: data.revision, operationId: operations.get(key) });
          data.revision = result.revision; selected.delete(item.sourceId); succeeded++;
          data.candidates = data.candidates.filter(function (f) { return f.sourceId !== item.sourceId; });
          data.count = ready().length;
        } catch (error) {
          errors.set(item.sourceId, error.message);
          // A lost response may have committed successfully. Reconcile before
          // continuing so the next flower uses the actual catalog revision.
          try {
            data = await options.api('adminFlowerUpdates');
            if (!data.candidates.some(function (f) { return f.sourceId === item.sourceId; })) {
              errors.delete(item.sourceId); selected.delete(item.sourceId); succeeded++;
            }
          } catch (refreshError) { break; }
        }
      }
      try {
        data = await options.api('adminFlowerUpdates');
        if (succeeded) await options.reloadFlowers();
        message(succeeded + '개 등록 완료' + (errors.size ? ' · ' + errors.size + '개는 등록하지 못했습니다. 항목의 안내를 확인하고 다시 시도해 주세요.' : '. 이미지도 함께 저장했습니다.'), !!errors.size);
      } catch (error) { message('등록 결과를 다시 확인해 주세요. ' + error.message, true); }
      finally {
        importing = false; options.setBusy(false);
        el('flowerUpdatesProgress').textContent = '이미지는 서버에 저장됩니다.'; render();
      }
    }
    button.onclick = open; el('closeFlowerUpdates').onclick = close;
    el('refreshFlowerUpdates').onclick = function () { load(true); };
    el('flowerUpdatesReadyTab').onclick = function () { setTab('ready'); };
    el('flowerUpdatesReviewTab').onclick = function () { setTab('review'); };
    el('selectAllFlowerUpdates').onchange = function (event) {
      ready().forEach(function (item) { if (event.target.checked) selected.add(item.sourceId); else selected.delete(item.sourceId); }); render();
    };
    el('importFlowerUpdates').onclick = importSelected;
    modal.onclick = function (event) { if (event.target === modal) close(); };
    document.addEventListener('keydown', function (event) {
      if (!modal.classList.contains('show')) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key !== 'Tab') return;
      const controls = [...modal.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]')].filter(function (n) { return n.getClientRects().length; });
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); modal.querySelector('[role="dialog"]').focus(); return; }
      if (!modal.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    return { load: load, syncControls: syncControls };
  };
})(window);
