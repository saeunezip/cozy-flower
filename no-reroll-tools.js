(function (root) {
  'use strict';
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function upgrade(snap, member, flower) { return Number(((snap.upgrades || {})[member] || {})[flower]) || 0; }
  function owned(snap, member, flower) { var i = snap.flowers.findIndex(function (f) { return f.name === flower; }); return i >= 0 && (snap.unlocked[member] || '').charAt(i) === '1'; }
  function mergeEntries(snap, computed, designated, minRemain) {
    var entries = new Map(), order = [];
    function entry(f) {
      if (!entries.has(f.name)) entries.set(f.name, { name:f.name, grade:f.grade, holders:[], designated:[], autoFirst:[], autoHolders:[], hasSolo:false });
      return entries.get(f.name);
    }
    (designated || []).forEach(function (item) {
      var f = snap.flowers.find(function (f) { return f.flowerId === item.flowerId; });
      var st = computed.stats[item.member];
      if (!f || !st || st.remain < minRemain || !owned(snap, item.member, f.name)) return;
      var e = entry(f);
      if (!e.designated.length) order.push(e);
      if (e.designated.indexOf(item.member) < 0) { e.designated.push(item.member); e.holders.push(item.member); }
    });
    computed.list.forEach(function (original) {
      var e = entry(original);
      if (!e.designated.length) order.push(e);
      e.autoHolders = original.holders.slice(); e.autoFirst = original.holders.slice(0, original.rank1Tie || 1); e.hasSolo = original.hasSolo;
      original.holders.forEach(function (name) { if (e.holders.indexOf(name) < 0) e.holders.push(name); });
    });
    return order;
  }
  function candidateLabel(entry, name, snap, stats, flowerMode) {
    var isDesignated = entry.designated.indexOf(name) >= 0;
    var st = stats[name] || {}, solo = st.best === entry.grade && st.bestCount === 1;
    var prefix = isDesignated ? '✔️' : flowerMode && solo ? '⭐' : '';
    var up = upgrade(snap, name, entry.name);
    return prefix + (flowerMode ? name : entry.name) + (up ? '(+' + up + ')' : '');
  }
  function exportText(entries, snap, stats, options) {
    var active = entries.map(function (e) {
      var names = e.holders.filter(function (name) {
        return (!options.first || e.designated.indexOf(name) >= 0 || e.autoFirst.indexOf(name) >= 0) && options.members.has(name);
      });
      return { entry:e, names:names };
    }).filter(function (r) { return r.names.length && options.flowers.has(r.entry.name) && options.grades.has(r.entry.grade); });
    var lines = [];
    if (options.format === 'member') {
      snap.members.forEach(function (name) {
        var list = active.filter(function (r) { return r.names.indexOf(name) >= 0; });
        if (list.length) lines.push(name + ' - ' + list.map(function (r) { return candidateLabel(r.entry, name, snap, stats, false); }).join(', '));
      });
    } else {
      var groups = new Map();
      active.forEach(function (r) {
        // Compare the complete name/upgrade/marker set, without changing the displayed recommendation order.
        var labels = r.names.map(function (n) { return candidateLabel(r.entry, n, snap, stats, true); });
        var key = JSON.stringify(labels.slice().sort());
        if (!groups.has(key)) groups.set(key, { flowers:[], labels:labels });
        groups.get(key).flowers.push(r.entry.name);
      });
      groups.forEach(function (g) { lines.push(g.flowers.join(', ') + ' - ' + g.labels.join(', ')); });
    }
    return { text:lines.join('\n'), flowers:active.length, members:new Set(active.flatMap(function (r) { return r.names; })).size, lines:lines.length };
  }
  function gridHtml(list, image) {
    if (!list.length) return '<div class="mr-nr-empty">조건에 맞는 꽃이 없습니다.</div>';
    return '<div class="mr-nr-grid">' + list.map(function (e, i) {
      return '<button type="button" class="mr-nr-card" data-mr-nr-idx="'+i+'" title="'+esc(e.name)+' · '+esc(e.grade)+'"><div class="mr-nr-img-wrap"><img src="'+esc(image(e.name))+'" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="mr-nr-fb">'+esc(e.name)+'</div>' + (e.designated.length ? '<span class="mr-nr-star" title="지정 임무">✔️</span>' : e.hasSolo ? '<span class="mr-nr-star" title="유일 최고등급 보유자 있음">⭐</span>' : '') + '</div><div class="mr-nr-name">'+esc(e.holders[0])+(e.holders.length>1?' (외 '+(e.holders.length-1)+'명)':'')+'</div></button>';
    }).join('')+'</div>';
  }
  function detailHtml(entry, stats, upgrades, mr) {
    if (!entry.designated.length) return mr.noRerollDetailHtml(entry, stats, upgrades);
    var autoRanks = {}, rank = 1;
    entry.autoHolders.forEach(function (name, i, list) {
      if (i && !mr.sameTier(list[i-1], name, stats, upgrades, entry.name, entry.grade)) rank=i+1;
      autoRanks[name]=rank;
    });
    return '<div class="mr-rank-lead">지정 임무 '+entry.designated.length+'명 · 전체 대상 '+entry.holders.length+'명</div><div class="mr-rank-hint">지정 대상 우선 · 이름을 누르면 임무 보드에 등록할 수 있습니다</div>'+entry.holders.map(function (name) {
      var manual = entry.designated.indexOf(name)>=0, st=stats[name]||{}, up=(upgrades[name]||{})[entry.name]||0;
      return '<div class="mr-rank-row" data-mr-nr-name="'+esc(name)+'"><span class="mr-rank-badge">'+(manual?'✔️ 지정':autoRanks[name]+'순위')+'</span><span class="mr-rank-name">'+esc(name)+'</span><span class="mr-rank-note">'+esc(mr.holderNote(st,entry.grade,up))+'</span></div>';
    }).join('');
  }
  function init(config) {
    var doc=root.document, overlay=doc.createElement('div'), returnFocus=null, view='', snapshot=null, selection=null, chosen=null, busy=false, matches=[], highlighted=-1, clearRevision=0;
    overlay.className='nrt-overlay'; overlay.hidden=true;
    overlay.innerHTML='<section class="nrt-dialog" role="dialog" aria-modal="true" aria-labelledby="nrt-title"><header class="nrt-head"><h2 id="nrt-title"></h2><button type="button" data-nrt="close" aria-label="닫기">✕</button></header><div class="nrt-body" id="nrt-body"></div><footer class="nrt-footer" id="nrt-footer"></footer></section>';
    doc.body.appendChild(overlay);
    function byId(id) { return overlay.querySelector('#'+id); }
    function image(name) { return '<img src="'+esc(config.image(name))+'" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">'; }
    function get() { return config.getData(); }
    function notice(text, error) { var el=byId('nrt-message'); if(el){el.textContent=text;el.classList.toggle('is-error',!!error);} }
    async function open(kind) {
      if(busy)return;
      returnFocus=doc.activeElement;busy=true;view=kind;overlay.hidden=false;doc.body.classList.add('nrt-open');
      byId('nrt-title').textContent=kind==='export'?'새로고침 금지 목록 공유':'지정 임무 추가';
      byId('nrt-body').innerHTML='<p class="nrt-note" role="status">최신 데이터를 불러오는 중…</p>';byId('nrt-footer').hidden=true;
      overlay.querySelector('[data-nrt=close]').focus();
      try {
        await config.refresh();var data=get();if(!data.snap)throw new Error('데이터를 받지 못했습니다.');
        if(kind==='export'){byId('nrt-footer').hidden=false;renderExport(data);}else renderDesignated();
      }catch(error){byId('nrt-body').innerHTML='<p class="nrt-note is-error">최신 데이터를 불러오지 못했습니다. 창을 닫고 다시 시도해 주세요.</p>';}
      finally {busy=false;if(kind==='designated'&&byId('nrt-designated-member')){updateChosen();renderRegistered();}}
    }
    function close() { if(busy)return;overlay.hidden=true;doc.body.classList.remove('nrt-open');if(returnFocus&&returnFocus.isConnected)returnFocus.focus(); }
    function renderExport(data) {
      snapshot={snap:data.snap,stats:data.stats,entries:data.entries,at:new Date()};
      selection={format:'flower',first:false,members:new Set(data.entries.flatMap(function(e){return e.holders;})),flowers:new Set(data.entries.map(function(e){return e.name;})),grades:new Set(['UR+','UR','SSR'])};
      byId('nrt-body').innerHTML='<p class="nrt-note">현재 화면 기준 · '+esc(data.threshold)+'회 미만 · '+snapshot.at.toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'})+'</p><div class="nrt-segment"><button type="button" data-format="flower" aria-pressed="true">꽃별</button><button type="button" data-format="member" aria-pressed="false">길드원별</button></div><details><summary>길드원 편집 <span id="nrt-member-count"></span></summary><input type="search" id="nrt-member-search" aria-label="길드원 검색" placeholder="길드원 검색"><div class="nrt-members" id="nrt-members"></div></details><details><summary>꽃 편집 <span id="nrt-flower-count"></span></summary><div class="nrt-label">포함할 등급</div><div class="nrt-grades"><button type="button" data-grade="UR+" aria-pressed="true">UR(30)</button><button type="button" data-grade="UR" aria-pressed="true">UR(28)</button><button type="button" data-grade="SSR" aria-pressed="true">SSR</button></div><input type="search" id="nrt-flower-search" aria-label="꽃 검색" placeholder="꽃 이름 검색"><div class="nrt-flowers" id="nrt-flowers"></div></details><details><summary>추가 옵션</summary><label class="nrt-radio"><input type="radio" name="nrt-rank" value="all" checked> 대상자 전체</label><label class="nrt-radio"><input type="radio" name="nrt-rank" value="first"> 1순위만 · 공동 1순위 포함</label></details><div class="nrt-preview-head">미리보기 <span id="nrt-stats" aria-live="polite"></span></div><textarea id="nrt-text" readonly aria-label="복사할 텍스트"></textarea><div id="nrt-message" class="nrt-message" aria-live="polite"></div>';
      byId('nrt-footer').innerHTML='<button type="button" class="nrt-primary" data-nrt="copy">텍스트 복사</button>';
      byId('nrt-members').innerHTML=data.snap.members.filter(function(n){return selection.members.has(n);}).map(function(n){return '<button type="button" data-member="'+esc(n)+'" aria-pressed="true">'+esc(n)+'</button>';}).join('');
      byId('nrt-flowers').innerHTML=data.entries.map(function(e){return '<button type="button" data-flower="'+esc(e.name)+'" data-flower-grade="'+esc(e.grade)+'" aria-pressed="true" aria-label="'+esc(e.name)+'">'+image(e.name)+'<span>'+esc(e.name)+'</span></button>';}).join('');
      updateExport();
    }
    function updateExport() {
      var r=exportText(snapshot.entries,snapshot.snap,snapshot.stats,selection);
      byId('nrt-text').value=r.text;byId('nrt-stats').textContent='꽃 '+r.flowers+'종 · 길드원 '+r.members+'명 · '+r.lines+'줄 · '+r.text.length+'자';
      byId('nrt-member-count').textContent=selection.members.size+'명';byId('nrt-flower-count').textContent=r.flowers+'종';
      overlay.querySelector('[data-nrt=copy]').disabled=!r.text;
      byId('nrt-members').querySelectorAll('[data-member]').forEach(function(b){b.setAttribute('aria-pressed',String(selection.members.has(b.dataset.member)));b.hidden=b.dataset.member.indexOf(byId('nrt-member-search').value.trim())<0;});
      byId('nrt-flowers').querySelectorAll('[data-flower]').forEach(function(b){b.setAttribute('aria-pressed',String(selection.flowers.has(b.dataset.flower)));b.hidden=!selection.grades.has(b.dataset.flowerGrade)||b.dataset.flower.indexOf(byId('nrt-flower-search').value.trim())<0;});
      overlay.querySelectorAll('[data-grade]').forEach(function(b){b.setAttribute('aria-pressed',String(selection.grades.has(b.dataset.grade)));});
      overlay.querySelectorAll('[data-format]').forEach(function(b){b.setAttribute('aria-pressed',String(selection.format===b.dataset.format));});
    }
    function renderDesignated() {
      var data=get(),previous=byId('nrt-designated-member'),member=previous?previous.value:config.currentMember();chosen=null;
      byId('nrt-body').innerHTML='<p class="nrt-note">보유한 꽃을 지정하면 최고점수가 아니어도 목록 맨 앞에 표시됩니다.</p><label class="nrt-label" for="nrt-designated-member">길드원 선택</label><select id="nrt-designated-member"><option value="">길드원을 선택하세요</option>'+data.snap.members.map(function(n){return '<option value="'+esc(n)+'">'+esc(n)+'</option>';}).join('')+'</select><label class="nrt-label" for="nrt-designated-flower">꽃 지정</label><input id="nrt-designated-flower" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="nrt-suggestions" autocomplete="off" placeholder="꽃 이름을 입력하세요"><div id="nrt-suggestions" role="listbox" aria-label="꽃 검색 결과" hidden></div><div id="nrt-chosen" class="nrt-chosen" hidden></div><button type="button" class="nrt-primary nrt-register" data-nrt="register" disabled>지정 임무 등록</button><div id="nrt-message" class="nrt-message" aria-live="polite"></div><div class="nrt-list-head"><h3>등록된 임무 <span id="nrt-designated-count"></span></h3><button type="button" class="nrt-danger" data-nrt="clear">임무 전체 삭제</button></div><div id="nrt-designated-list"></div>';
      var confirmation=doc.createElement('div');confirmation.id='nrt-confirm';confirmation.className='nrt-confirm';confirmation.hidden=true;
      confirmation.innerHTML='<p>등록된 지정 임무를 모두 삭제할까요?</p><div class="nrt-note">자동 추천과 임무 보드는 그대로 유지됩니다.</div><div class="nrt-confirm-actions"><button type="button" data-nrt="cancel-clear">취소</button><button type="button" class="nrt-danger" data-nrt="confirm-clear">전체 삭제</button></div>';
      byId('nrt-designated-list').before(confirmation);
      byId('nrt-footer').innerHTML='';byId('nrt-footer').hidden=true;byId('nrt-designated-member').value=member||'';renderRegistered();
    }
    function renderRegistered() {
      var data=get(),groups=new Map();
      data.designated.forEach(function(r){if(!groups.has(r.flower))groups.set(r.flower,[]);groups.get(r.flower).push(r.member);});
      byId('nrt-designated-count').textContent=groups.size+'종';
      byId('nrt-designated-list').innerHTML=groups.size?Array.from(groups).map(function(pair){return '<div class="nrt-registered-row">'+image(pair[0])+'<div><div>'+esc(pair[0])+'</div><div class="nrt-assignees">'+pair[1].map(function(n){var up=upgrade(data.snap,n,pair[0]);return '✔️'+esc(n)+(up?'(+'+up+')':'');}).join(', ')+'</div></div></div>';}).join(''):'<p class="nrt-note">등록된 지정 임무가 없습니다.</p>';
      overlay.querySelector('[data-nrt=clear]').disabled=!data.designated.length||busy;
    }
    function findFlowers() {
      var data=get(),member=byId('nrt-designated-member').value,q=byId('nrt-designated-flower').value.trim();highlighted=-1;
      matches=q?data.snap.flowers.filter(function(f){return f.name.indexOf(q)>=0&&(!member||owned(data.snap,member,f.name));}):[];
      var show=!!q&&!chosen;byId('nrt-suggestions').hidden=!show;byId('nrt-designated-flower').setAttribute('aria-expanded',String(show));byId('nrt-designated-flower').removeAttribute('aria-activedescendant');
      byId('nrt-suggestions').innerHTML=matches.length?matches.map(function(f,i){return '<button type="button" role="option" aria-selected="false" id="nrt-option-'+i+'" data-suggestion="'+i+'">'+image(f.name)+'<span>'+esc(f.name)+'</span></button>';}).join(''):'<div class="nrt-note">'+(member?'보유한 꽃 중 검색 결과가 없습니다.':'검색 결과가 없습니다.')+'</div>';
      updateChosen();
    }
    function updateChosen() {
      var data=get(),member=byId('nrt-designated-member').value,valid=chosen&&member&&owned(data.snap,member,chosen.name);
      byId('nrt-chosen').hidden=!chosen;
      if(chosen)byId('nrt-chosen').innerHTML=image(chosen.name)+'<div>'+esc(chosen.name)+'<div class="nrt-note">'+(valid?'개량 +'+upgrade(data.snap,member,chosen.name)+' · 보유 기록 기준':'보유한 길드원을 선택해 주세요.')+'</div></div>';
      overlay.querySelector('[data-nrt=register]').disabled=!valid||busy;
    }
    function choose(index) { chosen=matches[index];if(!chosen)return;byId('nrt-designated-flower').value=chosen.name;findFlowers(); }
    async function mutate(action) {
      if(busy)return;var data=get(),body={action:action};
      if(action==='clearDesignatedMissions') { body.expectedRevision=clearRevision;byId('nrt-confirm').hidden=true; }
      else { if(!chosen)return;body.member=byId('nrt-designated-member').value;body.flowerId=chosen.flowerId; }
      busy=true;updateChosen();renderRegistered();notice('처리 중…');
      try {
        var response=await root.fetch(config.api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();
        if(Array.isArray(result.designatedMissions))config.setDesignated(result.designatedMissions,result.designatedRevision);
        if(!response.ok||!result.ok)throw new Error(result.error||'저장하지 못했습니다.');
        if(action==='addDesignatedMission'){chosen=null;byId('nrt-designated-flower').value='';findFlowers();}
        notice(action==='clearDesignatedMissions'?'지정 임무를 모두 삭제했습니다.':result.duplicate?'이미 등록된 지정 임무입니다.':'지정 임무를 등록했습니다.');
      } catch(error) { notice(error.message,true); }
      finally {busy=false;updateChosen();renderRegistered();}
    }
    overlay.addEventListener('click',function(ev){
      if(ev.target===overlay){close();return;}var b=ev.target.closest('button');if(!b)return;
      if(b.dataset.nrt==='close'){close();return;}if(view==='export') {
        if(b.dataset.format)selection.format=b.dataset.format;
        ['member','flower','grade'].forEach(function(key){if(b.dataset[key]!==undefined){var set=selection[key==='grade'?'grades':key+'s'],value=b.dataset[key];if(set.has(value))set.delete(value);else set.add(value);}});
        if(b.dataset.nrt==='copy') { copyText();return; }updateExport();
      } else {if(b.dataset.suggestion!==undefined)choose(Number(b.dataset.suggestion));if(b.dataset.nrt==='register')mutate('addDesignatedMission');if(b.dataset.nrt==='clear'){clearRevision=get().revision;byId('nrt-confirm').hidden=false;overlay.querySelector('[data-nrt=cancel-clear]').focus();}if(b.dataset.nrt==='cancel-clear')byId('nrt-confirm').hidden=true;if(b.dataset.nrt==='confirm-clear')mutate('clearDesignatedMissions');}
    });
    overlay.addEventListener('input',function(ev){if(view==='export')updateExport();else if(ev.target.id==='nrt-designated-flower'){chosen=null;notice('');findFlowers();}});
    overlay.addEventListener('change',function(ev){if(view==='export'){selection.first=overlay.querySelector('[name=nrt-rank]:checked').value==='first';updateExport();}else if(ev.target.id==='nrt-designated-member'){if(chosen&&!owned(get().snap,ev.target.value,chosen.name))chosen=null;findFlowers();}});
    overlay.addEventListener('keydown',function(ev){
      if(ev.key==='Escape'){ev.stopPropagation();if(view==='designated'&&!byId('nrt-suggestions').hidden){byId('nrt-suggestions').hidden=true;byId('nrt-designated-flower').setAttribute('aria-expanded','false');}else close();return;}
      if(view==='designated'&&ev.target.id==='nrt-designated-flower'&&!byId('nrt-suggestions').hidden&&matches.length){
        if(ev.key==='ArrowDown'||ev.key==='ArrowUp'){ev.preventDefault();highlighted=ev.key==='ArrowDown'?(highlighted+1)%matches.length:(highlighted-1+matches.length)%matches.length;byId('nrt-suggestions').querySelectorAll('[data-suggestion]').forEach(function(b,i){b.classList.toggle('is-active',i===highlighted);b.setAttribute('aria-selected',String(i===highlighted));if(i===highlighted)b.scrollIntoView({block:'nearest'});});ev.target.setAttribute('aria-activedescendant','nrt-option-'+highlighted);}else if(ev.key==='Enter'&&highlighted>=0){ev.preventDefault();choose(highlighted);}
      }
      if(ev.key==='Tab'){var focus=Array.from(overlay.querySelectorAll('button:not(:disabled),input,select,textarea,summary')).filter(function(el){return el.getClientRects().length&&!el.closest('[hidden]');});var first=focus[0],last=focus[focus.length-1];if(ev.shiftKey&&doc.activeElement===first){ev.preventDefault();last.focus();}else if(!ev.shiftKey&&doc.activeElement===last){ev.preventDefault();first.focus();}}
    });
    async function copyText() { var input=byId('nrt-text');try {if(root.navigator.clipboard&&root.navigator.clipboard.writeText)await root.navigator.clipboard.writeText(input.value);else {input.focus();input.select();if(!doc.execCommand('copy'))throw new Error();}notice('복사했습니다.');}catch(error){input.focus();input.select();notice('복사하지 못했습니다. 선택된 텍스트를 직접 복사해 주세요.',true);} }
    return { openExport:function(){byId('nrt-footer').hidden=false;open('export');},openDesignated:function(){open('designated');} };
  }
  var api={mergeEntries:mergeEntries,exportText:exportText,gridHtml:gridHtml,detailHtml:detailHtml,init:init};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.NoRerollTools=api;
})(typeof window==='object'?window:globalThis);
