/* StudieHub demo, offline prototype */

const $ = (sel) => document.querySelector(sel);

const state = {
  online: false,
  mode: "until", // until | duration
  subjects: new Set(),
  session: {
    running: false,
    paused: false,
    startTs: null,
    endTs: null,
    totalMs: 0,
    pauseStartTs: null,
    pausedMs: 0,
    tickId: null,
    breakWorkMin: 50,
    breakRestMin: 10,
    lastNudgeAtMin: -999
  },
  chat: {
    selectedId: null,
    messagesById: {}
  }
};

const SUBJECTS = ["Matematikk", "Norsk", "Engelsk", "Naturfag", "Samfunnsfag", "Historie", "Programmering", "Pedagogikk"];

const PEOPLE = [
  { id: "p1", name: "Mina", subjects: ["Norsk", "Pedagogikk"], status: "Online" },
  { id: "p2", name: "Jonas", subjects: ["Matematikk", "Programmering"], status: "Offline" },
  { id: "p3", name: "Aisha", subjects: ["Naturfag", "Engelsk"], status: "Online" },
  { id: "p4", name: "Sander", subjects: ["Samfunnsfag", "Historie"], status: "Online" }
];

const NUDGES = [
  {
    title: "Mikropauser løfter ytelse",
    text: "Korte pauser underveis kan redusere mental utmattelse og hjelpe deg å holde stabil kvalitet i arbeidet.",
    foot: "Bakgrunn: ergonomi og fatigue forskning, samt psykologisk forskning på pauser."
  },
  {
    title: "Bytt fokus i 60 sekunder",
    text: "Se bort fra skjermen og slapp av i øynene. Små avbrekk kan hjelpe oppmerksomheten å hente seg inn igjen.",
    foot: "Bakgrunn: studier på oppmerksomhet og vigilance effekter."
  },
  {
    title: "Planlegg neste lille steg",
    text: "Når du tar pause, bestem deg for første handling når du er tilbake. Det gjør det lettere å starte igjen.",
    foot: "Bakgrunn: vaner, friksjon og gjennomføring."
  }
];

function save(){
  const data = {
    online: state.online,
    mode: state.mode,
    subjects: Array.from(state.subjects),
    username: $("#username").value || "",
    chat: state.chat
  };
  localStorage.setItem("studiehub_demo", JSON.stringify(data));
}

function load(){
  const raw = localStorage.getItem("studiehub_demo");
  if(!raw) return;
  try{
    const data = JSON.parse(raw);
    state.online = !!data.online;
    state.mode = data.mode === "duration" ? "duration" : "until";
    state.subjects = new Set(Array.isArray(data.subjects) ? data.subjects : []);
    if(typeof data.username === "string") $("#username").value = data.username;
    if(data.chat && typeof data.chat === "object"){
      state.chat = data.chat;
      if(!state.chat.messagesById) state.chat.messagesById = {};
    }
  }catch(e){
    // ignore
  }
}

function pad2(n){ return String(n).padStart(2,"0"); }

function fmtHMS(ms){
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

function fmtClock(ts){
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function setOnline(val){
  state.online = val;
  $("#statusText").textContent = val ? "Online" : "Offline";
  $("#statusDot").style.background = val ? "var(--good)" : "var(--bad)";
  $("#statusDot").style.boxShadow = val ? "0 0 0 4px rgba(34,197,94,.12)" : "0 0 0 4px rgba(239,68,68,.12)";
  save();
}

function initSubjects(){
  const wrap = $("#subjectChips");
  wrap.innerHTML = "";
  SUBJECTS.forEach((s) => {
    const chip = document.createElement("div");
    chip.className = "chip" + (state.subjects.has(s) ? " active" : "");
    chip.textContent = s;
    chip.addEventListener("click", () => {
      if(state.subjects.has(s)) state.subjects.delete(s);
      else state.subjects.add(s);
      chip.classList.toggle("active");
      renderMatch();
      save();
    });
    wrap.appendChild(chip);
  });
}

function renderMatch(){
  const chosen = Array.from(state.subjects);
  if(chosen.length === 0){
    $("#matchText").textContent = "Velg minst ett fag for å se forslag.";
    return;
  }
  const matches = PEOPLE.filter(p => p.subjects.some(x => state.subjects.has(x)));
  if(matches.length === 0){
    $("#matchText").textContent = "Ingen i demo listen matcher fagene dine. Dette løses med backend senere.";
    return;
  }
  const top = matches.slice(0,3).map(p => p.name).join(", ");
  $("#matchText").textContent = `Folk i demoen som matcher: ${top}.`;
}

function setMode(mode){
  state.mode = mode;
  $("#tabUntil").classList.toggle("active", mode === "until");
  $("#tabDuration").classList.toggle("active", mode === "duration");
  $("#modeUntil").classList.toggle("hidden", mode !== "until");
  $("#modeDuration").classList.toggle("hidden", mode !== "duration");
  save();
}

function readBreakPreset(){
  const sel = state.mode === "until" ? $("#breakPreset") : $("#breakPreset2");
  const [work, rest] = sel.value.split("|").map(x => parseInt(x,10));
  state.session.breakWorkMin = work;
  state.session.breakRestMin = rest;
}

function setControls(running, paused){
  $("#startBtn").disabled = running;
  $("#pauseBtn").disabled = !running || paused;
  $("#resumeBtn").disabled = !running || !paused;
  $("#resetBtn").disabled = !running;
}

function setNudge(title, text, foot){
  $("#nudgeTitle").textContent = title;
  $("#nudgeText").textContent = text;
  $("#nudgeFoot").textContent = foot;
}

function pickNudge(){
  const i = Math.floor(Math.random() * NUDGES.length);
  return NUDGES[i];
}

function computeEndTs(){
  const now = Date.now();
  if(state.mode === "until"){
    const val = $("#endTime").value;
    if(!val){
      // default til 22:00
      $("#endTime").value = "22:00";
    }
    const [hh, mm] = ($("#endTime").value || "22:00").split(":").map(x => parseInt(x,10));
    const end = new Date();
    end.setSeconds(0,0);
    end.setHours(hh, mm, 0, 0);
    // hvis sluttid er tidligere enn nå, bruk neste dag
    if(end.getTime() <= now) end.setDate(end.getDate() + 1);
    return end.getTime();
  }else{
    const mins = Math.max(5, Math.min(600, parseInt($("#durationMinutes").value || "90", 10)));
    return now + mins * 60 * 1000;
  }
}

function sessionStart(){
  if(state.session.running) return;

  readBreakPreset();

  const now = Date.now();
  const endTs = computeEndTs();
  const totalMs = Math.max(0, endTs - now);

  state.session.running = true;
  state.session.paused = false;
  state.session.startTs = now;
  state.session.endTs = endTs;
  state.session.totalMs = totalMs;
  state.session.pauseStartTs = null;
  state.session.pausedMs = 0;
  state.session.lastNudgeAtMin = -999;

  setControls(true, false);

  $("#endAt").textContent = fmtClock(endTs);
  setNudge("Fokus tips", "Du er i gang. Hold det enkelt: én oppgave, ett steg av gangen.", "Tipsene oppdateres underveis.");

  tick();
  state.session.tickId = window.setInterval(tick, 250);
}

function sessionPause(){
  if(!state.session.running || state.session.paused) return;
  state.session.paused = true;
  state.session.pauseStartTs = Date.now();
  setControls(true, true);
  setNudge("Pause", "Pust rolig i 30 sekunder. Slapp av i skuldre og kjeve.", "Korte pauser kan gi bedre utholdenhet.");
}

function sessionResume(){
  if(!state.session.running || !state.session.paused) return;
  const now = Date.now();
  const pauseDur = now - (state.session.pauseStartTs || now);
  state.session.pausedMs += Math.max(0, pauseDur);
  state.session.pauseStartTs = null;
  state.session.paused = false;
  setControls(true, false);

  const n = pickNudge();
  setNudge(n.title, n.text, n.foot);
}

function sessionReset(){
  if(state.session.tickId) window.clearInterval(state.session.tickId);

  state.session.running = false;
  state.session.paused = false;
  state.session.startTs = null;
  state.session.endTs = null;
  state.session.totalMs = 0;
  state.session.pauseStartTs = null;
  state.session.pausedMs = 0;
  state.session.tickId = null;
  state.session.lastNudgeAtMin = -999;

  $("#timeLeft").textContent = "00:00:00";
  $("#pctLeft").textContent = "0%";
  $("#endAt").textContent = "–";
  $("#progressFill").style.width = "0%";
  $("#progressCaption").textContent = "Klar når du er.";
  $("#elapsedCaption").textContent = "0 min brukt";

  setControls(false, false);
  $("#pauseBtn").disabled = true;
  $("#resumeBtn").disabled = true;
  $("#resetBtn").disabled = true;

  setNudge("Fokus tips", "Start en økt for å få smarte påminnelser underveis.", "Kilder: vises under.");
}

function tick(){
  if(!state.session.running) return;

  const now = Date.now();
  const endTs = state.session.endTs;
  const startTs = state.session.startTs;

  const pausedNow = state.session.paused ? (now - (state.session.pauseStartTs || now)) : 0;
  const pausedTotal = state.session.pausedMs + Math.max(0, pausedNow);

  const effectiveElapsed = Math.max(0, now - startTs - pausedTotal);
  const remaining = Math.max(0, endTs - now + pausedNow); // når paused, frys nedtelling
  const total = Math.max(1, state.session.totalMs);

  const pctLeft = Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
  const pctDone = 100 - pctLeft;

  $("#timeLeft").textContent = fmtHMS(remaining);
  $("#pctLeft").textContent = `${pctLeft}%`;
  $("#progressFill").style.width = `${pctDone}%`;

  const elapsedMin = Math.floor(effectiveElapsed / 60000);
  $("#elapsedCaption").textContent = `${elapsedMin} min brukt`;

  if(remaining <= 0){
    const n = { title: "Ferdig", text: "Bra jobba. Logg en kort oppsummering av hva du fikk gjort, og velg neste steg.", foot: "Dette blir til statistikk i fullversjonen." };
    setNudge(n.title, n.text, n.foot);
    sessionReset();
    return;
  }

  if(state.session.paused){
    $("#progressCaption").textContent = "Pauset";
    return;
  }else{
    $("#progressCaption").textContent = "I flyt";
  }

  // Pausepåminnelse basert på valgt mønster
  const work = state.session.breakWorkMin;
  const rest = state.session.breakRestMin;
  const cycle = work + rest;
  const minsIntoCycle = elapsedMin % cycle;

  // Påminnelse når work perioden er ferdig, men ikke spam
  if(minsIntoCycle === work && state.session.lastNudgeAtMin !== elapsedMin){
    state.session.lastNudgeAtMin = elapsedMin;
    const n = pickNudge();
    setNudge("Pausepåminnelse", `Det er tid for en pause på cirka ${rest} min. ${n.text}`, n.foot);
  }

  // Mild påminnelse litt før slutt på work periode
  if(minsIntoCycle === Math.max(0, work - 3) && state.session.lastNudgeAtMin !== elapsedMin){
    state.session.lastNudgeAtMin = elapsedMin;
    setNudge("Snart pause", "Tre minutter igjen til planlagt pause. Avslutt setningen og klargjør neste steg.", "Bedre overgang gjør det lettere å fortsette.");
  }
}

/* Chat mock */

function seedMessages(){
  PEOPLE.forEach(p => {
    if(!state.chat.messagesById[p.id]){
      state.chat.messagesById[p.id] = [
        { me:false, text:`Hei, jeg jobber med ${p.subjects[0]}. Hva jobber du med i dag?`, ts: Date.now() - 3600_000 },
      ];
    }
  });
}

function renderPeople(filter=""){
  const wrap = $("#peopleList");
  wrap.innerHTML = "";
  const q = (filter || "").trim().toLowerCase();

  PEOPLE
    .filter(p => p.name.toLowerCase().includes(q) || p.subjects.join(" ").toLowerCase().includes(q))
    .forEach(p => {
      const el = document.createElement("div");
      el.className = "person" + (state.chat.selectedId === p.id ? " active" : "");
      el.innerHTML = `
        <div class="avatar" aria-hidden="true"></div>
        <div class="person-meta">
          <div class="person-name">${p.name}</div>
          <div class="person-sub">${p.subjects.join(", ")} • ${p.status}</div>
        </div>
      `;
      el.addEventListener("click", () => selectPerson(p.id));
      wrap.appendChild(el);
    });
}

function selectPerson(id){
  state.chat.selectedId = id;
  const p = PEOPLE.find(x => x.id === id);
  $("#peerName").textContent = p ? p.name : "Velg en person";
  $("#peerSub").textContent = p ? `${p.subjects.join(", ")} • ${p.status}` : "Fag og status vises her";
  $("#messageInput").disabled = !p;
  $("#sendBtn").disabled = !p;
  renderPeople($("#chatSearch").value || "");
  renderMessages();
  save();
}

function renderMessages(){
  const wrap = $("#messages");
  wrap.innerHTML = "";
  const id = state.chat.selectedId;
  if(!id){
    const empty = document.createElement("div");
    empty.className = "msg";
    empty.textContent = "Velg en person til venstre for å åpne chat.";
    wrap.appendChild(empty);
    return;
  }
  const msgs = state.chat.messagesById[id] || [];
  msgs.forEach(m => {
    const el = document.createElement("div");
    el.className = "msg" + (m.me ? " me" : "");
    const d = new Date(m.ts);
    const meta = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    el.innerHTML = `<div>${escapeHtml(m.text)}</div><div class="meta">${meta}</div>`;
    wrap.appendChild(el);
  });
  wrap.scrollTop = wrap.scrollHeight;
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function sendMessage(text){
  const id = state.chat.selectedId;
  if(!id) return;
  const t = text.trim();
  if(!t) return;

  const list = state.chat.messagesById[id] || [];
  list.push({ me:true, text:t, ts: Date.now() });
  state.chat.messagesById[id] = list;

  // Enkel auto reply for demo
  window.setTimeout(() => {
    const p = PEOPLE.find(x => x.id === id);
    const reply = p ? `Skjønner. Vil du jobbe sammen og sjekke inn klokka ${fmtClock(Date.now() + 30*60000)}?` : "Ok.";
    const l2 = state.chat.messagesById[id] || [];
    l2.push({ me:false, text: reply, ts: Date.now() });
    state.chat.messagesById[id] = l2;
    renderMessages();
    save();
  }, 600);

  renderMessages();
  save();
}

/* Init */

function initDefaults(){
  // default sluttid til 22:00
  if(!$("#endTime").value) $("#endTime").value = "22:00";
}

function wire(){
  $("#statusPill").addEventListener("click", () => setOnline(!state.online));
  $("#statusPill").addEventListener("keydown", (e) => {
    if(e.key === "Enter" || e.key === " ") setOnline(!state.online);
  });

  $("#username").addEventListener("input", save);

  $("#tabUntil").addEventListener("click", () => setMode("until"));
  $("#tabDuration").addEventListener("click", () => setMode("duration"));

  $("#breakPreset").addEventListener("change", save);
  $("#breakPreset2").addEventListener("change", save);

  $("#startBtn").addEventListener("click", sessionStart);
  $("#pauseBtn").addEventListener("click", sessionPause);
  $("#resumeBtn").addEventListener("click", sessionResume);
  $("#resetBtn").addEventListener("click", sessionReset);

  $("#chatSearch").addEventListener("input", (e) => renderPeople(e.target.value));

  $("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#messageInput");
    sendMessage(input.value);
    input.value = "";
  });
}

function main(){
  load();
  initDefaults();
  setOnline(state.online);
  setMode(state.mode);
  initSubjects();
  renderMatch();

  seedMessages();
  renderPeople("");
  if(state.chat.selectedId) selectPerson(state.chat.selectedId);
  else renderMessages();

  setControls(false, false);
  $("#pauseBtn").disabled = true;
  $("#resumeBtn").disabled = true;
  $("#resetBtn").disabled = true;

  wire();
}

main();
