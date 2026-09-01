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
      ".mr-pt{font-weight:bold;color:#152c57}.mr-sc{color:#78838f;font-size:11.5px}.mr-sc.mr-tight{color:#b45309;font-weight:bold}" +
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
      ".mr-clear-btn.mr-clear-show{display:flex}";
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
      var per = {},
        total = 0;
      snap.flowers.forEach(function (f, i) {
        if (bits.charAt(i) === "1") {
          per[f.grade] = (per[f.grade] || 0) + 1;
          total++;
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
        spanHeld: spanHeld,
        used: used,
        remain: remain,
        scarcity: p > 0 ? remain / p : null,
      };
    });
    return { stats: stats, holders: holders, gradeTotal: gradeTotal };
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

    this.sortBy = "scarce";
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

      list.sort(function (a, b) {
        if ((a.st.remain === 0) !== (b.st.remain === 0)) return a.st.remain === 0 ? 1 : -1;
        if (self.sortBy === "up") return b.up - a.up || (b.st.scarcity || 0) - (a.st.scarcity || 0);
        return (b.st.scarcity || 0) - (a.st.scarcity || 0) || b.up - a.up;
      });
      return { list: list, hidden: holders.length - pick.length, total: holders.length };
    };

    this.renderCandidates = function () {
      if (!self.current) return;
      var r = self.candidatesFor();
      var list = r.list,
        g = self.current.grade,
        total = r.total;
      var top = list.length ? list[0].st.scarcity || 0 : 0;

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
        '<button type="button" class="mr-btn mr-btn-sm' + (self.sortBy === "scarce" ? " mr-on" : "") + '" data-mr-action="sort" data-sort="scarce">기회 드문 순</button>' +
        '<button type="button" class="mr-btn mr-btn-sm' + (self.sortBy === "up" ? " mr-on" : "") + '" data-mr-action="sort" data-sort="up">개량 순</button>' +
        "</div>";

      var gi = ORDER.indexOf(g);
      html += list
        .map(function (c, i) {
          var st = c.st,
            done = st.remain === 0,
            scar = st.scarcity === null ? "—" : Math.round(st.scarcity);
          var isTight = !done && st.scarcity !== null && top > 0 && st.scarcity >= top * 0.7;
          var over = st.bestIdx >= 0 && st.bestIdx < gi;
          return (
            '<div class="mr-cand' + (done ? " mr-dim" : "") + '"' +
            (done ? "" : ' data-mr-action="assign" data-idx="' + i + '"') +
            ">" +
            '<div class="mr-who"><b>' + esc(c.name) + "</b>" +
            '<div class="mr-meta">' + st.used + "/" + MAX_COUNT + " · 최고 " + (st.best || "없음") +
            (over ? ' <span class="mr-warn">! 최대 가능 등급보다 낮음</span>' : "") +
            (c.up ? " · 개량 +" + c.up : "") + "</div></div>" +
            '<div class="mr-num"><div class="mr-pt">' + c.score + "점</div>" +
            '<div class="mr-sc' + (isTight ? " mr-tight" : "") + '">희소도 ' + scar + "</div></div></div>"
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
        '<p class="mr-note">희소도 = 남은 횟수를 채우려면 임무가 앞으로 몇 번 떠야 하는가. 높을수록 기회가 드무니 먼저 배정하는 게 이득입니다.<br>' +
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

  global.MissionRegister = MissionRegister;
})(window);
