/* ============================================================
   공용 "임무 등록" 위젯 — 번호·꽃 이름 입력 → 자동완성 → 후보 표시 → 배정.
   board.html(임무 보드)과 app.html(메인화면) 둘 다 이 스크립트를 불러와 쓴다.
   각 페이지가 이미 갖고 있는 snap/board/counts(같은 Worker 스냅샷)를 그대로
   읽기만 한다 — 여기서 따로 fetch 하지 않는다.

   페이지 쪽에서 할 일:
     <script src="mission-register.js"></script>
     var reg = new MissionRegister({
       noInputId, flowerInputId, sugBoxId, clearBtnId(선택), candBoxId,
       apiUrl,                    // Worker 주소
       imgUrl: function(name){}, // 꽃 이미지 URL 만들기
       getSnap, getBoard, getCounts,  // 그 순간의 최신 데이터를 반환하는 함수
       say: function(text, isErr){}, // 메시지 배너(선택 — 없으면 alert)
       onAssigned: function(){}      // 배정 성공 후 페이지 새로고침 등
     });
   입력창의 oninput/onkeydown 같은 인라인 속성은 필요 없다 — 이 스크립트가
   엘리먼트를 찾아서 직접 이벤트를 붙인다.
   ============================================================ */
(function (global) {
  "use strict";

  var ORDER = ["UR+", "UR", "SSR", "SR+", "SR"];
  var BASE = { "UR+": 30, UR: 28, SSR: 25, "SR+": 23, SR: 21 };
  var APPEAR = {
    "UR+": 0.0102,
    UR: 0.0435,
    SSR: 0.0511,
    "SR+": 0.0512,
    SR: 0.0413,
  };
  var GCLASS = {
    "UR+": "mr-g-ur-plus",
    UR: "mr-g-ur",
    SSR: "mr-g-ssr",
    "SR+": "mr-g-sr-plus",
    SR: "mr-g-sr",
  };
  var MAX_COUNT = 24;
  var SPARSE_MAX = 5; // 눈높이 범위(최고 등급+한 칸 아래) 보유가 이 이하면 한 칸 더 낮은 등급도 후보로
  var SUG_MIN = 2,
    SUG_MAX = 8;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var css =
      ".mr-gtag{display:inline-block;padding:1px 7px;border-radius:6px;font-size:11.5px;font-weight:bold;color:#3d3d3d}" +
      ".mr-g-ur-plus{background:#e6b8af}.mr-g-ur{background:#f4cccc}.mr-g-ssr{background:#fff2cc}" +
      ".mr-g-sr-plus{background:#b4a7d6}.mr-g-sr{background:#d9d2e9}.mr-g-none{background:#e0e0e0}" +
      ".mr-task-head{display:flex;align-items:center;gap:9px;padding-bottom:10px;border-bottom:1px solid #eceef2;margin-bottom:4px}" +
      ".mr-task-head img{width:40px;height:40px;border-radius:8px;background:#eee;object-fit:cover}" +
      ".mr-nm{font-weight:bold;font-size:15px}.mr-sub{color:#78838f;font-size:12.5px;margin-top:2px}" +
      ".mr-cand{display:flex;align-items:center;gap:8px;padding:9px 6px;border-bottom:1px solid #f1f2f5;cursor:pointer;border-radius:8px}" +
      ".mr-cand:hover{background:#f5f7fb}.mr-cand.mr-dim{opacity:.45;cursor:default}.mr-cand.mr-dim:hover{background:none}" +
      ".mr-cand.mr-unassign{border:1px dashed #cfd4dc;border-radius:8px;margin-bottom:6px}.mr-cand.mr-unassign b{color:#78838f}" +
      ".mr-who{flex:1;min-width:0}.mr-who b{font-size:14.5px}" +
      ".mr-meta{color:#78838f;font-size:12px;margin-top:2px}" +
      ".mr-warn{color:#c62828;font-weight:bold;white-space:nowrap}" +
      ".mr-num{text-align:right;font-size:13px;white-space:nowrap}" +
      ".mr-pt{font-weight:bold;color:#152c57}.mr-sc{color:#78838f;font-size:11.5px}" +
      ".mr-sortbar{display:flex;gap:6px;margin:10px 0 4px}" +
      ".mr-btn{font-family:inherit;border:none;border-radius:9px;cursor:pointer;font-weight:bold}" +
      ".mr-btn-sm{flex:1;padding:6px 10px;font-size:13px;background:#e8ebf2;color:#1f3b73}" +
      ".mr-btn-sm.mr-on{background:#1f3b73;color:#fff}" +
      ".mr-note{color:#78838f;font-size:12.5px;line-height:1.55;margin:8px 0 0}" +
      ".mr-msg-err{background:#fdecea;color:#8b1e1e;padding:10px 12px;border-radius:9px;font-size:14px;margin-top:10px}" +
      ".mr-sug{display:none;position:absolute;left:0;right:0;top:100%;z-index:30;margin-top:4px;background:#fff;" +
      "border:1px solid #cfd4dc;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,.14);max-height:232px;overflow-y:auto}" +
      ".mr-sug.mr-sug-show{display:block}" +
      ".mr-sug-item{display:flex;align-items:center;gap:8px;padding:8px 10px;font-size:14px;cursor:pointer}" +
      ".mr-sug-item:hover,.mr-sug-item.mr-sel{background:#eef2fb}" +
      ".mr-sug-item img{width:26px;height:26px;border-radius:7px;background:#f0f0f0;flex:none;object-fit:cover}" +
      ".mr-sug-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mr-sug-none{padding:10px;font-size:13px;color:#8b95a1}" +
      ".mr-clear-btn{display:none;position:absolute;right:6px;top:50%;transform:translateY(-50%);width:20px;height:20px;" +
      "border:none;border-radius:50%;background:#e3e6ec;color:#6b7480;font-size:13px;line-height:1;cursor:pointer;padding:0;" +
      "align-items:center;justify-content:center}" +
      ".mr-clear-btn.mr-clear-show{display:flex}" +
      ".mr-nr-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:13px;color:#37474f}" +
      ".mr-nr-head input{width:52px;padding:6px 8px;border:1px solid #cfd4dc;border-radius:8px;font-size:13px;text-align:center;font-family:inherit}" +
      ".mr-nr-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}" +
      ".mr-nr-card{padding:0;border:none;background:none;cursor:pointer;font-family:inherit;text-align:center}" +
      ".mr-nr-card:hover{filter:brightness(.93)}" +
      ".mr-nr-img-wrap{position:relative;width:100%;aspect-ratio:1/1;border-radius:11px;overflow:hidden;background:#f0f1f4}" +
      ".mr-nr-img-wrap img{width:100%;height:100%;object-fit:cover;display:block}" +
      ".mr-nr-fb{display:none;position:absolute;inset:0;align-items:center;justify-content:center;text-align:center;font-size:10px;line-height:1.15;color:#4a5560;padding:3px;word-break:keep-all}" +
      ".mr-nr-name{font-size:10.5px;font-weight:bold;color:#37474f;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".mr-nr-empty{color:#8b95a1;font-size:13px;padding:10px 2px}" +
      ".mr-nr-star{position:absolute;top:3px;right:3px;font-size:14px;line-height:1;filter:drop-shadow(0 0 2px rgba(0,0,0,.5))}" +
      ".mr-rank-lead{color:#1f3b73;font-weight:bold;font-size:13.5px}" +
      ".mr-rank-hint{color:#90a4ae;font-size:12px;margin:2px 0 8px}" +
      ".mr-rank-row{display:flex;align-items:center;gap:8px;padding:8px 2px;font-size:14px;font-weight:bold;color:#263238;border-bottom:1px solid #f1f2f5;cursor:pointer;border-radius:8px}" +
      ".mr-rank-row:hover{background:#f5f7fb}" +
      ".mr-rank-badge{flex:none;min-width:40px;text-align:center;font-size:11px;font-weight:bold;color:#fff;background:#1f3b73;border-radius:20px;padding:3px 6px}" +
      ".mr-rank-row-solo .mr-rank-badge{background:#c62828}" +
      ".mr-rank-row-solo .mr-rank-note{color:#c62828;font-weight:bold}" +
      ".mr-rank-name{flex:1;min-width:0}" +
      ".mr-rank-star-badge{flex:none;font-size:11px;font-weight:bold;color:#8a6100;background:#fff3cd;border-radius:20px;padding:2px 7px;white-space:nowrap}" +
      ".mr-rank-note{color:#78838f;font-size:12px;font-weight:normal;white-space:nowrap}" +
      ".mr-rest-label{font-size:12px;color:#90a4ae;margin:12px 2px 6px;font-weight:bold}" +
      ".mr-rest-list{display:flex;flex-wrap:wrap;gap:8px}" +
      ".mr-chip{background:#f0f2f5;color:#263238;font-size:13px;font-weight:bold;padding:6px 11px;border-radius:20px}";
    var tag = document.createElement("style");
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // snap/counts만으로 길드원별 통계(최고 등급, 희소도 등)를 계산한다.
  // board.html의 prepare()에서 "발견하면 등록해 주세요" 위시리스트 계산 부분만 뺀 것.
  function computeStats(snap, counts) {
    var gradeTotal = {},
      holders = [];
    snap.flowers.forEach(function (f) {
      gradeTotal[f.grade] = (gradeTotal[f.grade] || 0) + 1;
    });
    snap.flowers.forEach(function (f, i) {
      var n = 0;
      snap.members.forEach(function (m) {
        if ((snap.unlocked[m] || "").charAt(i) === "1") n++;
      });
      holders[i] = n;
    });

    var stats = {};
    snap.members.forEach(function (name) {
      var bits = snap.unlocked[name] || "";
      var ups = (snap.upgrades && snap.upgrades[name]) || {};
      var per = {},
        total = 0,
        bestScore = 0;
      snap.flowers.forEach(function (f, i) {
        if (bits.charAt(i) === "1") {
          per[f.grade] = (per[f.grade] || 0) + 1;
          total++;
          var score = (BASE[f.grade] || 0) * 2 + (ups[f.name] || 0);
          if (score > bestScore) bestScore = score;
        }
      });
      var best = "";
      for (var i = 0; i < ORDER.length; i++) {
        if (per[ORDER[i]]) {
          best = ORDER[i];
          break;
        }
      }
      var bestIdx = ORDER.indexOf(best);
      var p = 0,
        spanHeld = 0;
      if (bestIdx >= 0) {
        [ORDER[bestIdx], ORDER[bestIdx + 1]].forEach(function (g) {
          if (!g) return;
          spanHeld += per[g] || 0;
          if (!gradeTotal[g] || !per[g]) return;
          p += APPEAR[g] * (per[g] / gradeTotal[g]);
        });
      }
      var used = counts[name] || 0;
      var remain = Math.max(MAX_COUNT - used, 0);
      stats[name] = {
        unlocked: total,
        p: p,
        best: best,
        bestIdx: bestIdx,
        bestCount: bestIdx >= 0 ? per[best] || 0 : 0, // 최고 등급을 몇 개나 가졌는지 — 1개뿐이면 "유일한 최고등급"
        perGrade: per, // 등급별 보유 개수 — 최고 등급이 아닌 등급도 조회 가능(눈높이 예외 후보용)
        bestScore: bestScore, // 보유한 모든 꽃 중 가장 높은 점수(등급+개량) — "본인 최고 점수 꽃" 판별용
        spanHeld: spanHeld,
        used: used,
        remain: remain,
        scarcity: p > 0 ? remain / p : null,
      };
    });
    return { stats: stats, holders: holders, gradeTotal: gradeTotal };
  }

  // 이름 옆에 붙이는 문구 — "+개량단계 · 등급 N개 보유". 개량이 0이면 그 부분은 뺀다.
  function holderNote(st, flowerGrade, up) {
    var cnt = (st && st.perGrade && st.perGrade[flowerGrade]) || 0;
    var parts = [];
    if (up) parts.push("+" + up);
    parts.push(flowerGrade + " " + cnt + "개 보유");
    return parts.join(" · ");
  }

  // 이 꽃(grade+up)이 그 사람이 보유한 모든 꽃 중 가장 높은 점수인가 — "⭐최고점수" 배지용.
  function isPersonBestScore(st, flowerGrade, up) {
    if (!st) return false;
    return (BASE[flowerGrade] || 0) * 2 + up === st.bestScore;
  }

  /*
   * "이 꽃은 새로고침 금지" / 꽃 보유자 팝업 / 임무 등록 후보(추천순)에 같이 쓰는 정렬 기준.
   * ① 남은 임무 0회 → 맨 뒤
   * ② 이 꽃이 그 사람의 최고 등급이 아니면 → 뒤 (더 좋은 선택지가 있으므로)
   * ③ 최고 등급을 유일하게(1개만) 가진 사람 — 무조건 최우선
   * ④ 그 외에는 이 꽃의 개량 단계로만 비교 — 높은 사람 우선
   * ⑤ 이름 (동점이면 화면에서 "공동 순위"로 묶어 보여준다 — sameTier 참고)
   */
  function holderRankCompare(stats, upgrades, flowerName, flowerGrade) {
    upgrades = upgrades || {};
    return function (a, b) {
      var A = stats[a] || {},
        B = stats[b] || {};
      var ao = A.remain === 0,
        bo = B.remain === 0;
      if (ao !== bo) return ao ? 1 : -1;
      var at = A.best === flowerGrade ? 0 : 1;
      var bt = B.best === flowerGrade ? 0 : 1;
      if (at !== bt) return at - bt;
      var asolo = at === 0 && (A.bestCount || 0) === 1;
      var bsolo = bt === 0 && (B.bestCount || 0) === 1;
      if (asolo !== bsolo) return asolo ? -1 : 1;
      var upA = (upgrades[a] || {})[flowerName] || 0;
      var upB = (upgrades[b] || {})[flowerName] || 0;
      if (upA !== upB) return upB - upA;
      return String(a).localeCompare(String(b));
    };
  }

  // holderRankCompare와 같은 기준으로 봤을 때 두 사람이 완전히 동순위인지 — 이름(마지막 임의
  // 타이브레이크)만 빼고 비교한다. 화면에 "공동 N순위"를 표시할 때 쓴다.
  function sameTier(a, b, stats, upgrades, flowerName, flowerGrade) {
    upgrades = upgrades || {};
    var A = stats[a] || {},
      B = stats[b] || {};
    if ((A.remain === 0) !== (B.remain === 0)) return false;
    var at = A.best === flowerGrade ? 0 : 1;
    var bt = B.best === flowerGrade ? 0 : 1;
    if (at !== bt) return false;
    var asolo = at === 0 && (A.bestCount || 0) === 1;
    var bsolo = bt === 0 && (B.bestCount || 0) === 1;
    if (asolo !== bsolo) return false;
    var upA = (upgrades[a] || {})[flowerName] || 0;
    var upB = (upgrades[b] || {})[flowerName] || 0;
    return upA === upB;
  }

  // "이 꽃은 새로고침 금지" 목록 — 남은 임무가 minRemain 이상인 사람만 순위 계산에 넣고,
  // 그 안에서 "누군가의 최고 등급"인 꽃마다 카드를 하나씩 만든다.
  function buildNoRerollList(snap, counts, minRemain) {
    var computed = computeStats(snap, counts);
    var stats = computed.stats;
    var upgrades = snap.upgrades || {};

    var map = {};
    snap.flowers.forEach(function (f, i) {
      snap.members.forEach(function (name) {
        var st = stats[name];
        if (!st || st.remain < minRemain || st.best !== f.grade) return;
        if ((snap.unlocked[name] || "").charAt(i) !== "1") return;
        if (!map[f.name]) map[f.name] = { name: f.name, grade: f.grade, holders: [] };
        map[f.name].holders.push(name);
      });
    });

    var list = Object.keys(map).map(function (k) {
      var entry = map[k];
      entry.holders.sort(holderRankCompare(stats, upgrades, entry.name, entry.grade));
      var tie = 1;
      for (var i = 1; i < entry.holders.length; i++) {
        if (!sameTier(entry.holders[0], entry.holders[i], stats, upgrades, entry.name, entry.grade)) break;
        tie++;
      }
      entry.rank1Tie = tie;
      // 1순위가 유일 최고등급이면(=이 꽃에 유일 최고등급 보유자가 있으면) 카드에 별을 띄운다.
      entry.hasSolo = (stats[entry.holders[0]] || {}).bestCount === 1;
      return entry;
    });

    list.sort(function (a, b) {
      return ORDER.indexOf(a.grade) - ORDER.indexOf(b.grade) || a.name.localeCompare(b.name);
    });
    return { list: list, stats: stats, upgrades: upgrades };
  }

  function noRerollCardLabel(entry) {
    var first = entry.holders[0];
    if (!first) return "";
    return entry.rank1Tie > 1 ? first + " (외 " + (entry.rank1Tie - 1) + "명)" : first;
  }

  function noRerollGridHtml(list, imgUrl) {
    if (!list.length) return '<div class="mr-nr-empty">조건에 맞는 꽃이 없습니다.</div>';
    return (
      '<div class="mr-nr-grid">' +
      list
        .map(function (entry, i) {
          return (
            '<button type="button" class="mr-nr-card" data-mr-nr-idx="' + i + '" title="' + esc(entry.name) + " · " + esc(entry.grade) + '">' +
            '<div class="mr-nr-img-wrap">' +
            '<img src="' + imgUrl(entry.name) + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
            '<div class="mr-nr-fb">' + esc(entry.name) + "</div>" +
            (entry.hasSolo ? '<span class="mr-nr-star" title="유일 최고등급 보유자 있음">⭐</span>' : "") +
            "</div>" +
            '<div class="mr-nr-name">' + esc(noRerollCardLabel(entry)) + "</div>" +
            "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  // 순위 번호는 완전히 동순위(sameTier)면 같은 번호를 준다(표준 경쟁 순위 — 1,1,3,4...).
  function noRerollDetailHtml(entry, stats, upgrades) {
    upgrades = upgrades || {};
    var top = entry.holders.slice(0, 5);
    var rest = entry.holders.slice(5);
    var ranks = [];
    for (var ri = 0; ri < top.length; ri++) {
      if (ri === 0) {
        ranks.push(1);
      } else if (sameTier(top[ri - 1], top[ri], stats, upgrades, entry.name, entry.grade)) {
        ranks.push(ranks[ri - 1]);
      } else {
        ranks.push(ri + 1);
      }
    }
    var html =
      '<div class="mr-rank-lead">' + entry.holders.length + "명의 최고등급 꽃입니다</div>" +
      '<div class="mr-rank-hint">이름을 눌러 바로 임무 보드에 등록할 수 있습니다</div>';
    html += top
      .map(function (name, i) {
        var st = stats[name] || {};
        var up = (upgrades[name] || {})[entry.name] || 0;
        var note = holderNote(st, entry.grade, up);
        var solo = (st.perGrade && st.perGrade[entry.grade]) === 1;
        var star = isPersonBestScore(st, entry.grade, up);
        return (
          '<div class="mr-rank-row' + (solo ? " mr-rank-row-solo" : "") + '" data-mr-nr-name="' + esc(name) + '">' +
          '<span class="mr-rank-badge">' + ranks[i] + "순위</span>" +
          '<span class="mr-rank-name">' + esc(name) + "</span>" +
          (star ? '<span class="mr-rank-star-badge">⭐최고점수</span>' : "") +
          '<span class="mr-rank-note">' + esc(note) + "</span>" +
          "</div>"
        );
      })
      .join("");
    if (rest.length) {
      html +=
        '<div class="mr-rest-label">그외 ' + rest.length + "명</div>" +
        '<div class="mr-rest-list">' +
        rest.map(function (name) { return '<span class="mr-chip">' + esc(name) + "</span>"; }).join("") +
        "</div>";
    }
    return html;
  }

  function parseSlotNumbers(raw) {
    var seen = {};
    return String(raw || "")
      .split(/[,\s]+/)
      .map(function (s) {
        return parseInt(s, 10);
      })
      .filter(function (n) {
        if (!(n >= 1 && n <= 66) || seen[n]) return false;
        seen[n] = true;
        return true;
      });
  }

  function apiPost(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || "요청이 거부됐습니다.");
        return j;
      });
  }

  // "이 꽃은 새로고침 금지" 팝업에서 이름을 눌렀을 때 쓰는 최소 배정 흐름 — 후보 목록을
  // 다시 보여줄 필요 없이(이미 팝업에서 누가 받을지 정해졌으므로) 번호만 물어보고 바로 등록한다.
  // opts: { apiUrl, flower, grade, member, board(선택 — 있으면 충돌 확인), say(선택), onDone(선택) }
  function quickAssign(opts) {
    var raw = prompt(
      opts.flower + "을(를) " + opts.member + " 임무로 배정합니다.\n임무 번호를 적어 주세요. (여러 개면 \"15, 17\"처럼 콤마로 구분)",
    );
    if (raw === null) return;
    var nos = parseSlotNumbers(raw);
    if (!nos.length) {
      if (opts.say) opts.say("임무 번호를 1~66 사이로 넣어 주세요.", true);
      return;
    }
    var b = opts.board || {};
    var conflicts = nos
      .filter(function (no) {
        return b[String(no)];
      })
      .map(function (no) {
        var prev = b[String(no)];
        return no + "번(" + prev.flower + (prev.member ? " → " + prev.member : "") + ")";
      });
    if (conflicts.length && !confirm("이미 있는 칸이 있습니다: " + conflicts.join(", ") + "\n\n덮어쓸까요?")) return;

    Promise.all(
      nos.map(function (no) {
        return apiPost(opts.apiUrl, { action: "assign", no: no, flower: opts.flower, grade: opts.grade, member: opts.member });
      }),
    )
      .then(function () {
        if (opts.say) opts.say(nos.map(function (n) { return n + "번"; }).join(", ") + " · " + opts.flower + " → " + opts.member);
        if (opts.onDone) opts.onDone();
      })
      .catch(function (e) {
        if (opts.say) opts.say(e.message, true);
      });
  }

  function MissionRegister(opts) {
    injectStyles();
    var self = this;
    var noEl = document.getElementById(opts.noInputId);
    var flowerEl = document.getElementById(opts.flowerInputId);
    var sugEl = document.getElementById(opts.sugBoxId);
    var clearEl = opts.clearBtnId ? document.getElementById(opts.clearBtnId) : null;
    var candEl = document.getElementById(opts.candBoxId);

    function snap() {
      return opts.getSnap();
    }
    function boardData() {
      return opts.getBoard();
    }
    function countsData() {
      return opts.getCounts();
    }
    function imgUrl(name) {
      return opts.imgUrl(name);
    }
    function say(msg, isErr) {
      if (opts.say) opts.say(msg, isErr);
      else if (isErr) alert(msg);
    }

    this.sortBy = "reco";
    this.showAllCand = false;
    this.current = null;
    this.sugList = [];
    this.sugIdx = -1;
    this._lastList = [];

    this.syncClearBtn = function () {
      if (clearEl) clearEl.classList.toggle("mr-clear-show", !!flowerEl.value);
    };
    this.closeSug = function () {
      sugEl.classList.remove("mr-sug-show");
      self.sugIdx = -1;
    };
    this.clearFlower = function () {
      flowerEl.value = "";
      self.syncClearBtn();
      self.closeSug();
      self.current = null;
      candEl.innerHTML = "";
      flowerEl.focus();
    };

    this.renderSug = function () {
      if (!self.sugList.length) {
        sugEl.innerHTML = '<div class="mr-sug-none">맞는 꽃이 없습니다.</div>';
        sugEl.classList.add("mr-sug-show");
        return;
      }
      sugEl.innerHTML = self.sugList
        .map(function (f, i) {
          return (
            '<div class="mr-sug-item' + (i === self.sugIdx ? " mr-sel" : "") + '" data-idx="' + i + '">' +
            '<img src="' + imgUrl(f.name) + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
            '<span class="mr-sug-name">' + esc(f.name) + "</span>" +
            '<span class="mr-gtag ' + (GCLASS[f.grade] || "mr-g-none") + '">' + esc(f.grade) + "</span>" +
            "</div>"
          );
        })
        .join("");
      sugEl.classList.add("mr-sug-show");
    };

    this.onFlowerInput = function () {
      self.syncClearBtn();
      var s = snap();
      var q = flowerEl.value.trim().replace(/\s+/g, "");
      if (!s || q.length < SUG_MIN) {
        self.closeSug();
        return;
      }
      self.sugList = s.flowers
        .filter(function (f) {
          return f.name.replace(/\s+/g, "").indexOf(q) >= 0;
        })
        .slice(0, SUG_MAX);
      self.sugIdx = -1;
      self.renderSug();
    };

    this.pickSug = function (i) {
      var f = self.sugList[i];
      if (!f) return;
      flowerEl.value = f.name;
      self.syncClearBtn();
      self.closeSug();
      self.lookup();
    };

    this.flowerKey = function (e) {
      var open = sugEl.classList.contains("mr-sug-show");
      if (open && self.sugList.length) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          self.sugIdx = (self.sugIdx + 1) % self.sugList.length;
          self.renderSug();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          self.sugIdx = (self.sugIdx - 1 + self.sugList.length) % self.sugList.length;
          self.renderSug();
          return;
        }
        if (e.key === "Escape") {
          self.closeSug();
          return;
        }
        if (e.key === "Enter" && self.sugIdx >= 0) {
          e.preventDefault();
          self.pickSug(self.sugIdx);
          return;
        }
      }
      if (e.key === "Enter") {
        self.closeSug();
        self.lookup();
      }
    };

    // 번호는 여기서 요구하지 않는다 — 꽃 이름만으로 후보를 먼저 보여주고,
    // 번호는 실제로 등록(assign)할 때 그 시점 입력값을 읽어 확인한다.
    this.lookup = function () {
      self.closeSug();
      var s = snap();
      var name = flowerEl.value.trim();
      if (!name) {
        say("꽃 이름을 넣어 주세요.", true);
        return;
      }
      if (!s) return;
      var idx = -1;
      for (var i = 0; i < s.flowers.length; i++) {
        if (s.flowers[i].name === name) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        candEl.innerHTML = "";
        say("'" + name + "' 은 목록에 없습니다. 21점 미만 임무이거나 이름이 다릅니다.", true);
        return;
      }
      self.current = { flower: name, grade: s.flowers[idx].grade, idx: idx };
      self.showAllCand = false;
      self.renderCandidates();
    };

    // 꽃 이름을 채우고 바로 후보까지 보여준다 (다른 화면에서 "?flower=" 등으로 넘어온 경우).
    this.setFlowerAndLookup = function (name) {
      flowerEl.value = name;
      self.syncClearBtn();
      self.lookup();
    };

    /*
     * 후보 추리기 — 상한이 이 임무보다 두 단계 이상 높은 사람은 뺀다.
     * 예외 — 눈높이 범위에 꽃이 SPARSE_MAX개 이하뿐인 사람은 한 칸 더 낮은
     * 등급까지 후보로 넣는다. (자세한 이유는 board.html 원본 주석 참고)
     */
    this.candidatesFor = function () {
      var s = snap();
      var c = countsData();
      var computed = computeStats(s, c);
      var stats = computed.stats;
      var gi = ORDER.indexOf(self.current.grade);
      var holders = s.members.filter(function (name) {
        return (s.unlocked[name] || "").charAt(self.current.idx) === "1";
      });

      var pick = self.showAllCand
        ? holders
        : holders.filter(function (n) {
            var st = stats[n];
            if (st.bestIdx < 0) return true;
            var floor = st.spanHeld <= SPARSE_MAX ? gi - 2 : gi - 1;
            return st.bestIdx >= floor;
          });

      var upgrades = s.upgrades || {};
      var list = pick.map(function (name) {
        var up = (upgrades[name] || {})[self.current.flower] || 0;
        return { name: name, up: up, score: BASE[self.current.grade] * 2 + up, st: stats[name] };
      });

      var recoCmp = holderRankCompare(stats, upgrades, self.current.flower, self.current.grade);
      list.sort(function (a, b) {
        if (self.sortBy === "up") {
          if ((a.st.remain === 0) !== (b.st.remain === 0)) return a.st.remain === 0 ? 1 : -1;
          return b.up - a.up || a.name.localeCompare(b.name);
        }
        return recoCmp(a.name, b.name);
      });
      return { list: list, hidden: holders.length - pick.length, total: holders.length };
    };

    this.renderCandidates = function () {
      if (!self.current) return;
      var r = self.candidatesFor();
      var list = r.list,
        g = self.current.grade,
        total = r.total;

      var html =
        '<div class="mr-task-head">' +
        '<img src="' + imgUrl(self.current.flower) + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
        '<div style="flex:1;min-width:0;">' +
        '<div class="mr-nm">' + esc(self.current.flower) + ' <span class="mr-gtag ' + (GCLASS[g] || "mr-g-none") + '">' + esc(g) + "</span></div>" +
        '<div class="mr-sub">기본 ' + BASE[g] * 2 + "점 (업그레이드 기준) · 해금 " + total + "명</div>" +
        "</div></div>";

      html +=
        '<div class="mr-cand mr-unassign" data-mr-action="unassign">' +
        '<div class="mr-who"><b>자유 배정</b><div class="mr-meta">이름 없이 이 임무만 먼저 등록합니다</div></div></div>';

      if (!total) {
        html += '<div class="mr-msg-err">해금한 사람이 아무도 없습니다. <b>새로고침 하세요.</b></div>';
        candEl.innerHTML = html;
        return;
      }
      if (!list.length) {
        html +=
          '<div class="mr-msg-err">할 수 있는 ' + total + "명이 전부 <b>더 높은 등급도 가능한 사람</b>입니다. <b>새로고침 하세요.</b>" +
          '<div style="margin-top:8px;"><button type="button" class="mr-btn mr-btn-sm" data-mr-action="toggle-all">그래도 보기</button></div></div>';
        candEl.innerHTML = html;
        self._lastList = [];
        return;
      }

      html +=
        '<div class="mr-sortbar">' +
        '<button type="button" class="mr-btn mr-btn-sm' + (self.sortBy === "reco" ? " mr-on" : "") + '" data-mr-action="sort" data-sort="reco">추천순</button>' +
        '<button type="button" class="mr-btn mr-btn-sm' + (self.sortBy === "up" ? " mr-on" : "") + '" data-mr-action="sort" data-sort="up">순수 개량 순</button>' +
        "</div>";

      var gi = ORDER.indexOf(g);
      html += list
        .map(function (c, i) {
          var st = c.st,
            done = st.remain === 0;
          var over = st.bestIdx >= 0 && st.bestIdx < gi;
          var gradeCnt = (st.perGrade && st.perGrade[g]) || 0;
          return (
            '<div class="mr-cand' + (done ? " mr-dim" : "") + '"' +
            (done ? "" : ' data-mr-action="assign" data-idx="' + i + '"') +
            ">" +
            '<div class="mr-who"><b>' + esc(c.name) + "</b>" +
            '<div class="mr-meta">' + st.used + "/" + MAX_COUNT + " · 최고 " + (st.best || "없음") +
            (over ? ' <span class="mr-warn">! 최대 가능 등급보다 낮음</span>' : "") +
            (c.up ? " · 개량 +" + c.up : "") + "</div></div>" +
            '<div class="mr-num"><div class="mr-pt">' + c.score + "점</div>" +
            '<div class="mr-sc">' + esc(g) + " " + gradeCnt + "개 보유</div></div></div>"
          );
        })
        .join("");

      if (r.hidden) {
        html +=
          '<div style="margin-top:8px;"><button type="button" class="mr-btn mr-btn-sm" data-mr-action="toggle-all">상위 등급자 ' +
          r.hidden + "명 숨김 · 모두 보기</button></div>";
      } else if (self.showAllCand) {
        html +=
          '<div style="margin-top:8px;"><button type="button" class="mr-btn mr-btn-sm mr-on" data-mr-action="toggle-all">등급 맞는 사람만 보기</button></div>';
      }

      html +=
        '<p class="mr-note">추천순 = 이 등급이 최고 등급인 사람부터, 그중에서도 같은 등급을 적게 가진 사람부터. 개량 단계가 높을수록 그다음 우선순위입니다.<br>' +
        "이 임무보다 두 단계 이상 높은 등급이 가능한 사람은 뺍니다 — 그 사람 한 칸은 위 등급에 쓰는 게 낫습니다. " +
        "단, 눈높이 범위에 꽃이 " + SPARSE_MAX + "개 이하뿐인 사람은 한 칸 더 낮은 등급도 후보로 보여줍니다.</p>";

      candEl.innerHTML = html;
      self._lastList = list;
    };

    this.setSort = function (v) {
      self.sortBy = v;
      self.renderCandidates();
    };
    this.toggleAllCand = function () {
      self.showAllCand = !self.showAllCand;
      self.renderCandidates();
    };
    this.assignAt = function (i) {
      var c = self._lastList && self._lastList[i];
      if (c) self.assign(c.name);
    };

    this.assign = function (name) {
      if (!self.current) return;
      var nos = parseSlotNumbers(noEl.value);
      if (!nos.length) {
        say("임무 번호를 1~66 사이로 넣어 주세요. 여러 개면 '15, 17'처럼 콤마로 구분합니다.", true);
        noEl.focus();
        return;
      }
      var b = boardData();
      var conflicts = nos
        .filter(function (no) {
          return b[String(no)];
        })
        .map(function (no) {
          var prev = b[String(no)];
          return no + "번(" + prev.flower + (prev.member ? " → " + prev.member : "") + ")";
        });
      if (conflicts.length && !confirm("이미 있는 칸이 있습니다: " + conflicts.join(", ") + "\n\n덮어쓸까요?")) return;

      var flower = self.current.flower,
        grade = self.current.grade;
      Promise.all(
        nos.map(function (no) {
          return apiPost(opts.apiUrl, { action: "assign", no: no, flower: flower, grade: grade, member: name });
        }),
      )
        .then(function () {
          say(nos.map(function (n) { return n + "번"; }).join(", ") + " · " + flower + (name ? " → " + name : ""));
          noEl.value = "";
          flowerEl.value = "";
          self.syncClearBtn();
          candEl.innerHTML = "";
          self.current = null;
          if (opts.onAssigned) opts.onAssigned();
        })
        .catch(function (e) {
          say(e.message, true);
        });
    };

    /* ---------- 이벤트 연결 ---------- */
    noEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") self.lookup();
    });
    flowerEl.addEventListener("input", self.onFlowerInput);
    flowerEl.addEventListener("keydown", self.flowerKey);
    flowerEl.addEventListener("blur", function () {
      setTimeout(self.closeSug, 120);
    });
    sugEl.addEventListener("mousedown", function (ev) {
      var el = ev.target.closest(".mr-sug-item");
      if (!el) return;
      ev.preventDefault();
      self.pickSug(parseInt(el.getAttribute("data-idx"), 10));
    });
    if (clearEl) {
      clearEl.addEventListener("mousedown", function (ev) {
        ev.preventDefault();
      });
      clearEl.addEventListener("click", self.clearFlower);
    }
    candEl.addEventListener("click", function (ev) {
      var el = ev.target.closest("[data-mr-action]");
      if (!el) return;
      var action = el.getAttribute("data-mr-action");
      if (action === "unassign") self.assign("");
      else if (action === "assign") self.assignAt(parseInt(el.getAttribute("data-idx"), 10));
      else if (action === "toggle-all") self.toggleAllCand();
      else if (action === "sort") self.setSort(el.getAttribute("data-sort"));
    });
  }

  // CSS는 MissionRegister 위젯을 만들지 않는 화면(app.html의 "이 꽃은 새로고침 금지" 등,
  // static 함수만 쓰는 곳)에도 필요하므로 인스턴스 생성 여부와 상관없이 스크립트 로드 시 바로 넣는다.
  injectStyles();

  // 다른 화면(app.html의 꽃 보유자 팝업 등)에서도 같은 희소도 계산을 쓸 수 있게 노출한다.
  MissionRegister.computeStats = computeStats;
  MissionRegister.holderNote = holderNote;
  MissionRegister.isPersonBestScore = isPersonBestScore;
  MissionRegister.holderRankCompare = holderRankCompare;
  MissionRegister.sameTier = sameTier;
  MissionRegister.buildNoRerollList = buildNoRerollList;
  MissionRegister.noRerollCardLabel = noRerollCardLabel;
  MissionRegister.noRerollGridHtml = noRerollGridHtml;
  MissionRegister.noRerollDetailHtml = noRerollDetailHtml;
  MissionRegister.quickAssign = quickAssign;

  global.MissionRegister = MissionRegister;
})(window);
