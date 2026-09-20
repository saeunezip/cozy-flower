(function (global) {
  "use strict";

  var HISTORY_KEY = "cozyMarketHistoryV1";
  var TAGS = ["오전반", "오후반", "저녁반", "새벽반", "종일반"];
  var state = { loaded: false, available: false, profiles: {}, requests: [], viewer: null, profileMember: "", expanded: false, draft: null, saving: false, activityTimer: null };
  var SCHEDULE = [
    { tag: "새벽반", start: 0, end: 6 }, { tag: "오전반", start: 6, end: 12 },
    { tag: "오후반", start: 12, end: 18 }, { tag: "저녁반", start: 18, end: 24 }
  ];

  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
  function members() { return global.snap && Array.isArray(global.snap.members) ? global.snap.members : []; }
  function flowersOf(name) { return global.memberFlowersFromSnapshot && global.memberFlowersFromSnapshot(name) || []; }
  function ownName() { return global.meName || ""; }
  function image(name) { return global.imgUrl(name); }
  function showOnly(id) {
    ["homeView", "recoView", "profileView", "marketView"].forEach(function (x) { var el = document.getElementById(x); if (el) el.classList.toggle(x === id ? "show" : "hide", x !== "homeView" && x === id); });
    document.getElementById("homeView").style.display = id === "homeView" ? "block" : "none";
    document.getElementById("recoView").style.display = id === "recoView" ? "block" : "none";
    ["profileView", "marketView"].forEach(function (x) { document.getElementById(x).classList.toggle("show", x === id); });
    scrollTo(0, 0);
  }
  function options(selected, placeholder) {
    return (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : "") + members().map(function (n) { return '<option value="' + esc(n) + '"' + (n === selected ? " selected" : "") + '>' + esc(n) + '</option>'; }).join("");
  }
  function api(body) {
    var init = { cache: "no-store", headers: { "Accept": "application/json" } };
    var url = global.API + "/features" + (!body && ownName() ? "?viewer=" + encodeURIComponent(ownName()) : "");
    if (body) { init.method = "POST"; init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(url, init).then(function (r) { if (!r.ok) throw new Error("새 기능 서버가 아직 연결되지 않았습니다."); return r.json(); }).then(function (j) { if (!j.ok) throw new Error(j.error || "요청이 거부됐습니다."); return j; });
  }
  function loadShared() {
    return api().then(function (j) {
      if (!j.profiles || !Array.isArray(j.requests) || !("viewer" in j)) throw new Error("새 기능 서버 응답이 아직 배포되지 않았습니다.");
      state.available = true; state.profiles = j.profiles || {}; state.requests = j.requests || []; state.viewer = j.viewer || null;
    }).catch(function () { state.available = false; state.profiles = {}; state.requests = []; state.viewer = null; }).then(function () {
      state.loaded = true; renderActivity();
    });
  }
  function note() { return state.available ? "" : '<div class="feature-note">공용 저장 서버 원본이 아직 없어 접속 시간과 거래소 저장은 비활성화되어 있습니다. 화면과 요청 계약은 준비됐지만 이 상태를 공용 기능 완료로 보지 않습니다.</div>'; }

  function onDataLoaded() { loadShared(); }
  function onIdentityChanged() { loadShared().then(function () { if (document.getElementById("profileView").classList.contains("show")) showProfile(ownName()); if (document.getElementById("marketView").classList.contains("show")) renderMarket(); }); }
  function renderActivity() {
    var box = document.getElementById("activityMembers"); if (!box) return;
    var current = currentBand();
    document.getElementById("activityRange").textContent = pad(current.start) + "–" + pad(current.end) + "시 · " + current.tag;
    var active = members().filter(function (name) { var tags = state.profiles[name] && state.profiles[name].timeTags || []; return tags.indexOf(current.tag) >= 0 || tags.indexOf("종일반") >= 0; });
    box.innerHTML = active.length ? active.map(function (name) { var all=(state.profiles[name].timeTags||[]).indexOf("종일반")>=0; return '<span class="activity-chip">'+esc(name)+(all?' · 종일반':'')+'</span>'; }).join("") : '<span class="muted">이 시간대에 등록된 길드원이 없습니다.</span>';
    clearTimeout(state.activityTimer);
    var now = new Date(), kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    var delay = ((current.end - kst.getHours()) * 60 - kst.getMinutes()) * 60000 - kst.getSeconds() * 1000 + 500;
    state.activityTimer = setTimeout(renderActivity, Math.max(1000, delay));
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function currentBand() { var h=parseInt(new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Seoul",hour:"2-digit",hourCycle:"h23"}).format(new Date()),10); return SCHEDULE.filter(function(s){return h>=s.start&&h<s.end;})[0] || SCHEDULE[0]; }
  function memberTagsHtml(name) {
    var tags = state.profiles[name] && state.profiles[name].timeTags || [];
    var current=currentBand().tag;
    return tags.map(function (t) { return '<span class="activity-chip' + (t===current||t==="종일반"?' current':'') + '">' + esc(t) + '</span>'; }).join("");
  }
  function decorateCandidateTags(root) {
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-mr-nr-name]'), function (row) {
      var slot = row.querySelector('.mr-rank-name');
      if (slot && !slot.querySelector('.activity-chip')) slot.insertAdjacentHTML('beforeend', memberTagsHtml(row.getAttribute('data-mr-nr-name')));
    });
  }

  function showProfile(name) { state.profileMember = name || ownName(); state.expanded = false; renderProfile(); showOnly("profileView"); }
  function renderProfile() {
    var name = state.profileMember || ownName(); var mine = name === ownName(); var p = state.profiles[name] || {}; var fs = flowersOf(name);
    var tags = Array.isArray(p.timeTags) ? p.timeTags : [];
    var tagHtml = TAGS.map(function (t) { return '<button type="button" class="time-tag' + (tags.indexOf(t) >= 0 ? " selected" : "") + '" data-tag="' + t + '"' + (!state.available ? " disabled" : "") + '>' + t + "</button>"; }).join("");
    var icons = fs.map(function (f) { return '<div class="flower-icon"><img src="' + image(f.name) + '" alt=""><span>' + esc(f.name) + "</span></div>"; }).join("");
    var title = mine ? "내 정보" : "길드원 정보";
    document.getElementById("profileView").innerHTML = '<div class="feature-panel"><div class="feature-head"><div class="feature-title"><button class="feature-back" data-act="home">← 뒤로</button><h2>' + title + '</h2></div></div>' + note() +
      '<label class="field-label">다른 길드원 보기</label><select class="profile-switch" data-act="switch-profile">' + options(name) + '</select>' +
      (!mine ? '<button class="feature-secondary" data-act="my-profile" style="margin-top:8px">내 정보로 돌아가기</button>' : "") +
      '<div class="profile-name-row"><div class="profile-name-tags"><div class="profile-name">' + esc(name || "이름 미선택") + '</div>' + (tags.length ? tags.map(function(t){return '<span class="activity-chip">'+t+'</span>';}).join("") : '<span class="muted">접속 시간 미등록</span>') + '</div></div><div class="profile-count"><span>임무 횟수:</span><button data-count="-1">−</button><b>' + (global.counts && global.counts[name] || 0) + '</b><button data-count="1">+</button></div>' +
      '<div><b>접속 시간 변경</b><div class="tag-list" data-role="tags">' + tagHtml + '</div></div>' +
      '<div class="flower-summary"><div class="flower-summary-head"><b>꽃 보유 현황 · 등록 ' + fs.length + '개</b><a class="feature-secondary" href="app.html?page=register&member=' + encodeURIComponent(name) + '">' + (fs.length ? "꽃 도감 수정 →" : "내 꽃 등록하기") + '</a></div><div class="flower-icons' + (state.expanded ? "" : " collapsed") + '">' + icons + '</div>' + (fs.length > 18 ? '<button class="feature-secondary" data-act="expand" style="margin-top:9px">' + (state.expanded ? "접기" : "전체 펼치기") + '</button>' : "") + '</div><hr><a href="app.html?page=admin" class="muted">관리자 메뉴 →</a></div>';
  }
  function setTags(name, tags) {
    if (!state.available) return;
    api({ action: "profile.setTimeTags", member: name, timeTags: tags }).then(loadShared).then(renderProfile).catch(function(e){alert(e.message);});
  }
  function bumpProfileCount(delta) {
    var name = state.profileMember; if (!name) return;
    var next = Math.min(24, Math.max(0, (global.counts[name] || 0) + delta));
    fetch(global.API, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({action:"setCount",member:name,count:next}) }).then(function(r){return r.json();}).then(function(j){if(!j.ok) throw new Error(j.error||"저장 실패"); global.counts[name]=next; renderProfile();}).catch(function(e){alert(e.message);});
  }

  function history() { try { var v = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); return Array.isArray(v) ? v.slice(0,5) : []; } catch(e) { return []; } }
  function saveHistory(item) { try { var h = history(); h.unshift(item); localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0,5))); } catch(e) {} }
  function showMarket() { renderMarket(); showOnly("marketView"); }
  function renderMarket() {
    var hs = history(); var grouped = {};
    state.requests.forEach(function (r) { (grouped[r.target] || (grouped[r.target] = [])).push(r); });
    var hist = hs.length ? hs.map(function (h,i) { var first=h.items[0]; return '<button class="history-card" data-history="'+i+'"><b>' + esc((h.requester===ownName()?"(나)":h.requester)+" → "+h.target) + '</b><div class="muted">'+esc(first.flower)+(h.items.length>1?" 외 "+(h.items.length-1)+"건":"")+'</div></button>'; }).join("") : '<div class="feature-empty">이 브라우저의 최근 등록이 없습니다.</div>';
    var groups = Object.keys(grouped).sort().map(function (target) { return '<section class="market-group"><h3>'+esc(target)+'</h3>'+grouped[target].map(requestCard).join("")+'</section>'; }).join("") || '<div class="feature-empty">등록된 공용 의뢰가 없습니다.</div>';
    document.getElementById("marketView").innerHTML='<div class="feature-panel"><div class="feature-head"><div class="feature-title"><button class="feature-back" data-act="home">← 뒤로</button><h2>거래소 의뢰</h2></div><button class="feature-primary" data-act="new-request">꽃 의뢰하기 →</button></div>'+note()+'<h3>이전 기록</h3><div class="history-row">'+hist+'</div><h3>거래소 의뢰 목록</h3><div class="market-groups">'+groups+'</div></div>';
  }
  function requestCard(r) {
    var can = state.viewer && state.viewer.member && (state.viewer.member===r.requester || state.viewer.member===r.target) && r.canMutate !== false;
    var items=(r.items||[]).map(function(i){return '<div class="market-item"><img src="'+image(i.flower)+'" alt=""><strong>'+esc(i.flower)+'</strong><span>'+esc(i.quantity)+'개</span></div>';}).join("");
    return '<article class="market-card'+(r.completedAt?' completed':'')+'"><div class="market-card-head"><b>'+esc(r.requester+' → '+r.target)+'</b>'+(can?'<button class="feature-secondary" data-toggle-request="'+esc(r.id)+'">'+(r.completedAt?'완료 취소':'완료')+'</button>':'')+'</div><div class="market-items">'+items+'</div>'+(r.completedAt?'<div class="muted">완료됨 · 완료 시각부터 1시간 뒤 서버에서 삭제</div>':'')+'</article>';
  }
  function freshDraft(seed) { return { requester: seed&&seed.requester || ownName(), target: seed&&seed.target || "", items: seed&&seed.items ? seed.items.map(function(i){return {flower:i.flower,quantity:String(i.quantity)};}) : [], search:"", error:"" }; }
  function openForm(seed) { state.draft=freshDraft(seed); renderForm(); }
  function flowerGridHtml(d) {
    var owned=d.target?flowersOf(d.target):[], selected={}; d.items.forEach(function(i){selected[i.flower]=true;});
    var q=d.search.toLowerCase();
    return owned.filter(function(f){return f.name.toLowerCase().indexOf(q)>=0;}).map(function(f){return '<button type="button" class="flower-icon" data-add-flower="'+esc(f.name)+'"'+(selected[f.name]?' disabled':'')+'><img src="'+image(f.name)+'" alt=""><span>'+esc(f.name)+'</span></button>';}).join("");
  }
  function renderForm() {
    var d=state.draft, grid=flowerGridHtml(d);
    var chosen=d.items.map(function(i,idx){return '<div class="selected-flower"><img src="'+image(i.flower)+'" alt=""><b>'+esc(i.flower)+'</b><div class="qty-control"><button class="qty-step" data-qty-step="'+idx+'" data-delta="-1">−</button><input class="qty-input" data-qty="'+idx+'" inputmode="numeric" value="'+esc(i.quantity)+'" placeholder="수량"><button class="qty-step" data-qty-step="'+idx+'" data-delta="1">+</button></div><button data-remove="'+idx+'">×</button></div>';}).join("") || '<div class="feature-empty">꽃을 선택해 주세요.</div>';
    var html='<div class="market-form-overlay"><div class="market-form"><div class="market-form-head"><h2>꽃 의뢰하기</h2><div class="market-form-actions"><button class="feature-primary" data-act="submit"'+(!state.available||state.saving?' disabled':'')+'>등록하기</button><button class="feature-secondary" data-act="close-form">닫기</button></div></div>'+note()+'<div class="form-grid"><label><span class="field-label">의뢰인</span><select class="market-select" data-field="requester">'+options(d.requester,d.requester?"":"의뢰인 선택")+'</select></label><label><span class="field-label">대상자</span><select class="market-select" data-field="target">'+options(d.target,"대상자 선택")+'</select></label></div><input class="market-search" data-field="search" value="'+esc(d.search)+'" placeholder="꽃 이름 검색" '+(!d.target?'disabled':'')+'><h3>선택한 꽃</h3><div>'+chosen+'</div><h3>선택한 대상자가 보유한 꽃</h3><div class="market-flower-grid">'+(d.target?(grid||'<div class="feature-empty">검색 결과가 없습니다.</div>'):'<div class="feature-empty">대상자를 먼저 선택해 주세요.</div>')+'</div>'+(d.error?'<div class="feature-error">'+esc(d.error)+'</div>':'')+'</div></div>';
    var old=document.querySelector('.market-form-overlay'); if(old) old.remove(); document.body.insertAdjacentHTML('beforeend',html);
  }
  function validateDraft() {
    var d=state.draft; if(!d.requester) return "의뢰인을 선택해 주세요."; if(!d.target) return "대상자를 선택해 주세요."; if(!d.items.length) return "꽃을 한 종류 이상 선택해 주세요."; var owned={}; flowersOf(d.target).forEach(function(f){owned[f.name]=true;});
    for(var i=0;i<d.items.length;i++){var raw=String(d.items[i].quantity).trim();if(!owned[d.items[i].flower]) return "대상자가 현재 보유한 꽃만 선택할 수 있습니다.";if(!/^[1-9]\d*$/.test(raw)) return "수량은 1 이상의 정수로 입력해 주세요.";}
    return "";
  }
  function submitDraft() {
    var err=validateDraft(); if(err){state.draft.error=err;renderForm();return;} state.saving=true;renderForm();
    var payload={action:"market.create",requester:state.draft.requester,target:state.draft.target,items:state.draft.items.map(function(i){return {flower:i.flower,quantity:i.quantity};})};
    api(payload).then(function(){saveHistory({requester:payload.requester,target:payload.target,items:payload.items});state.draft=null;document.querySelector('.market-form-overlay').remove();return loadShared();}).then(renderMarket).catch(function(e){state.saving=false;state.draft.error=e.message;renderForm();});
  }
  function stepDecimal(raw, delta) {
    var s=String(raw||"").trim(); if(!/^[1-9]\d*$/.test(s)) s="1";
    if(delta>0){var a=s.split(""),carry=1;for(var i=a.length-1;i>=0&&carry;i--){var n=(a[i].charCodeAt(0)-48)+carry;a[i]=String(n%10);carry=n>9?1:0;}if(carry)a.unshift("1");return a.join("");}
    if(s==="1")return "1";var b=s.split(""),borrow=1;for(var j=b.length-1;j>=0&&borrow;j--){var x=(b[j].charCodeAt(0)-48)-borrow;if(x<0){b[j]="9";}else{b[j]=String(x);borrow=0;}}return b.join("").replace(/^0+/,"")||"1";
  }

  document.addEventListener("click", function (ev) {
    var act=ev.target.closest("[data-act]"); if(act){var a=act.getAttribute("data-act");if(a==="home"){showOnly("homeView");return;}if(a==="my-profile"){showProfile(ownName());return;}if(a==="expand"){state.expanded=!state.expanded;renderProfile();return;}if(a==="new-request"){openForm();return;}if(a==="close-form"){state.draft=null;document.querySelector('.market-form-overlay').remove();return;}if(a==="submit"){submitDraft();return;}}
    var count=ev.target.closest("[data-count]");if(count){bumpProfileCount(parseInt(count.getAttribute("data-count"),10));return;}
    var tag=ev.target.closest("[data-tag]");if(tag){var p=state.profiles[state.profileMember]||{}, ts=(p.timeTags||[]).slice(), t=tag.getAttribute("data-tag"), pos=ts.indexOf(t);if(t==="종일반")ts=pos>=0?[]:[t];else{ts=ts.filter(function(x){return x!=="종일반";});if(pos>=0)ts.splice(ts.indexOf(t),1);else ts.push(t);}setTags(state.profileMember,ts);return;}
    var h=ev.target.closest("[data-history]");if(h){openForm(history()[parseInt(h.getAttribute("data-history"),10)]);return;}
    var add=ev.target.closest("[data-add-flower]");if(add){if(state.draft.items.length>=4){state.draft.error="서로 다른 꽃은 최대 4종까지 선택할 수 있습니다.";}else{state.draft.items.push({flower:add.getAttribute("data-add-flower"),quantity:"1"});state.draft.error="";}renderForm();return;}
    var rem=ev.target.closest("[data-remove]");if(rem){state.draft.items.splice(parseInt(rem.getAttribute("data-remove"),10),1);renderForm();return;}
    var step=ev.target.closest("[data-qty-step]");if(step){var qi=parseInt(step.getAttribute("data-qty-step"),10);state.draft.items[qi].quantity=stepDecimal(state.draft.items[qi].quantity,parseInt(step.getAttribute("data-delta"),10));renderForm();return;}
    var toggle=ev.target.closest("[data-toggle-request]");if(toggle){api({action:"market.toggleComplete",id:toggle.getAttribute("data-toggle-request"),actor:ownName()}).then(loadShared).then(renderMarket).catch(function(e){alert(e.message);});}
  });
  document.addEventListener("change",function(ev){if(ev.target.matches('[data-act="switch-profile"]')){showProfile(ev.target.value);return;}if(!state.draft)return;if(ev.target.matches('[data-field="requester"]')){state.draft.requester=ev.target.value;}if(ev.target.matches('[data-field="target"]')){state.draft.target=ev.target.value;state.draft.items=[];state.draft.error="대상자가 바뀌어 선택한 꽃을 비웠습니다.";renderForm();}if(ev.target.matches('[data-qty]'))state.draft.items[parseInt(ev.target.getAttribute('data-qty'),10)].quantity=ev.target.value;});
  document.addEventListener("input",function(ev){if(state.draft&&ev.target.matches('[data-field="search"]')){state.draft.search=ev.target.value;var grid=document.querySelector('.market-flower-grid');if(grid)grid.innerHTML=flowerGridHtml(state.draft)||'<div class="feature-empty">검색 결과가 없습니다.</div>';}});

  global.CozyFeatures={onDataLoaded:onDataLoaded,onIdentityChanged:onIdentityChanged,showProfile:showProfile,showMarket:showMarket,memberTagsHtml:memberTagsHtml,decorateCandidateTags:decorateCandidateTags};
})(window);
