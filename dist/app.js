const canvas = document.getElementById('aimCanvas');
const ctx = canvas.getContext('2d');
const arenaSurface = document.getElementById('arenaSurface');

const sensitivityInput = document.getElementById('sensitivityInput');
const dpiInput = document.getElementById('dpiInput');
const edpiValue = document.getElementById('edpiValue');
const cmValue = document.getElementById('cmValue');
const startButton = document.getElementById('startButton');
const startButtonLabel = document.getElementById('startButtonLabel');
const resetButton = document.getElementById('resetButton');
const sessionStatus = document.getElementById('sessionStatus');
const stageTitle = document.getElementById('stageTitle');
const stageDescription = document.getElementById('stageDescription');
const roundTag = document.getElementById('roundTag');
const roundInstruction = document.getElementById('roundInstruction');
const timerDisplay = document.getElementById('timerDisplay');
const introOverlay = document.getElementById('introOverlay');
const resultOverlay = document.getElementById('resultOverlay');
const resultModal = document.getElementById('resultModal');
const viewResultButton = document.getElementById('viewResultButton');
const closeModal = document.getElementById('closeModal');
const againButton = document.getElementById('againButton');
const copyButton = document.getElementById('copyButton');
const mouseHint = document.getElementById('mouseHint');
const pauseButton = document.getElementById('pauseButton');
const pauseOverlay = document.getElementById('pauseOverlay');
const resumeButton = document.getElementById('resumeButton');
const historyList = document.getElementById('historyList');
const modeCaption = document.getElementById('modeCaption');
const difficultyCaption = document.getElementById('difficultyCaption');
const difficultyNote = document.getElementById('difficultyNote');

const baseRounds = [
  { name: '甩枪定位', tag: 'ROUND 01', description: '快速点中目标，找到你的第一反应速度。', instruction: '点击出现的目标', type: 'static' },
  { name: '微调校准', tag: 'ROUND 02', description: '目标更小，看看你能否在速度和控制间保持平衡。', instruction: '点击小目标，避开诱导点', type: 'static' },
  { name: '跟枪稳定', tag: 'ROUND 03', description: '跟住变速目标，测试持续控制和临场修正。', instruction: '按住左键，跟住变速目标', type: 'track' },
];

const difficultyProfiles = {
  standard: {
    label: '标准', caption: '标准参数', note: '适合第一次测试，目标大小和速度更接近常规训练。',
    rounds: [
      { total: 14, radius: 31, limit: 36000, decoys: 0 },
      { total: 16, radius: 18, limit: 40000, decoys: 0 },
      { radius: 26, limit: 24000, speed: 1.05, changeEvery: 1250 },
    ],
  },
  hard: {
    label: '困难', caption: '加入诱导', note: '目标更小、更密，第二轮加入诱导点，第三轮会随机变速。',
    rounds: [
      { total: 18, radius: 24, limit: 42000, decoys: 1 },
      { total: 20, radius: 14, limit: 44000, decoys: 2 },
      { radius: 23, limit: 28000, speed: 1.5, changeEvery: 860 },
    ],
  },
  pro: {
    label: '特训', caption: '极限控制', note: '小目标、高频变向、多个诱导点，适合已经熟悉自己手感的玩家。',
    rounds: [
      { total: 22, radius: 19, limit: 48000, decoys: 2 },
      { total: 24, radius: 11, limit: 52000, decoys: 3 },
      { radius: 20, limit: 32000, speed: 2.0, changeEvery: 580 },
    ],
  },
};

const modeProfiles = {
  full: { label: '完整识别', caption: '建议首次使用', rounds: [0, 1, 2] },
  speed: { label: '速度专项', caption: '单轮快速校准', rounds: [0] },
  control: { label: '控制专项', caption: '微调 + 跟枪', rounds: [1, 2] },
};

const HISTORY_KEY = 'senslab-run-history-v2';
const state = {
  phase: 'intro', mode: 'full', difficulty: 'standard', plan: [0, 1, 2], planPosition: 0, roundIndex: 0,
  roundStart: 0, targetSpawn: 0, target: { x: 0, y: 0, radius: 30 }, decoys: [], hits: 0, misses: 0,
  reactionTimes: [], hitDistances: [], roundResults: [], pointer: { x: 0, y: 0, hasValue: false, isDown: false },
  track: { samples: 0, score: 0, totalError: 0, maxError: 0, holdMs: 0, lastTime: 0, vx: 0, vy: 0, nextChange: 0 },
  roundTimer: null, flash: null, pauseStarted: 0, history: loadHistory(),
};

function numberValue(input, fallback) { const value = Number(input.value); return Number.isFinite(value) && value > 0 ? value : fallback; }
function getRoundConfig(index = state.roundIndex) { return { ...baseRounds[index], ...difficultyProfiles[state.difficulty].rounds[index] }; }

function updateDerivedStats() {
  const sens = numberValue(sensitivityInput, 0.35); const dpi = numberValue(dpiInput, 800); const edpi = sens * dpi; const cm = 13062.86 / edpi;
  edpiValue.textContent = Math.round(edpi); cmValue.innerHTML = `${cm.toFixed(1)} <small>cm</small>`;
}

function resizeCanvas() {
  const rect = arenaSurface.getBoundingClientRect(); const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio)); canvas.height = Math.max(1, Math.floor(rect.height * ratio)); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (!state.pointer.hasValue) { state.pointer.x = rect.width / 2; state.pointer.y = rect.height / 2; }
}

function canvasPoint(event) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }

function randomPoint(radius) {
  const width = arenaSurface.clientWidth; const height = arenaSurface.clientHeight; const edgeBias = state.difficulty === 'pro' ? 34 : 46; const pad = Math.max(edgeBias, radius + 24);
  return { x: pad + Math.random() * Math.max(1, width - pad * 2), y: pad + Math.random() * Math.max(1, height - pad * 2) };
}

function spawnStaticSet() {
  const round = getRoundConfig(); state.target = { ...randomPoint(round.radius), radius: round.radius }; state.decoys = [];
  for (let index = 0; index < (round.decoys || 0); index += 1) {
    let candidate = randomPoint(round.radius * 0.72); let attempts = 0;
    while (Math.hypot(candidate.x - state.target.x, candidate.y - state.target.y) < round.radius * 3.3 && attempts < 20) { candidate = randomPoint(round.radius * 0.72); attempts += 1; }
    state.decoys.push({ ...candidate, radius: round.radius * 0.72, phase: Math.random() * Math.PI * 2 });
  }
}

function updateSettingsUI() {
  const mode = modeProfiles[state.mode]; const difficulty = difficultyProfiles[state.difficulty]; modeCaption.textContent = mode.caption; difficultyCaption.textContent = difficulty.caption; difficultyNote.textContent = difficulty.note;
  document.querySelectorAll('#modeSwitch .segment').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.mode));
  document.querySelectorAll('#difficultySwitch .segment').forEach((button) => button.classList.toggle('active', button.dataset.difficulty === state.difficulty));
  const locked = ['round', 'paused', 'between'].includes(state.phase); document.querySelectorAll('#modeSwitch .segment, #difficultySwitch .segment').forEach((button) => { button.disabled = locked; });
}

function updateRouteUI() {
  document.querySelectorAll('.round-item').forEach((item, index) => {
    const isPlanned = state.plan.includes(index); const result = state.roundResults[index]; item.classList.toggle('active', index === state.roundIndex && isPlanned && state.phase !== 'intro'); item.classList.toggle('done', Boolean(result)); item.classList.toggle('locked', !isPlanned);
    const stateText = item.querySelector('.round-state');
    if (result) stateText.textContent = '已完成'; else if (!isPlanned) stateText.textContent = '未选择'; else if (index === state.roundIndex && state.phase === 'round') stateText.textContent = '进行中'; else if (index === state.roundIndex && state.phase === 'paused') stateText.textContent = '已暂停'; else stateText.textContent = '待测';
  });
}

function formatTime(ms) { const seconds = Math.max(0, Math.ceil(ms / 1000)); return `00:${String(seconds).padStart(2, '0')}`; }
function updateTimer(now) { if (state.phase !== 'round') return; const left = getRoundConfig().limit - (now - state.roundStart); timerDisplay.textContent = formatTime(left); if (left <= 0) finishRound(true); }
function clearRoundTimer() { if (state.roundTimer) window.clearInterval(state.roundTimer); state.roundTimer = null; }

function startSession() {
  clearRoundTimer(); state.phase = 'round'; state.plan = [...modeProfiles[state.mode].rounds]; state.planPosition = 0; state.roundIndex = state.plan[0]; state.roundResults = []; state.flash = null;
  introOverlay.classList.add('hidden'); resultOverlay.classList.add('hidden'); pauseOverlay.classList.add('hidden'); resultModal.classList.add('hidden'); startButtonLabel.textContent = '识别进行中'; sessionStatus.textContent = `${difficultyProfiles[state.difficulty].label} · 测试进行中`; startButton.disabled = true; pauseButton.classList.remove('hidden');
  updateProgress(); updateSettingsUI(); updateRouteUI(); beginRound();
}

function beginRound() {
  const round = getRoundConfig(); state.roundStart = performance.now(); state.targetSpawn = state.roundStart; state.hits = 0; state.misses = 0; state.reactionTimes = []; state.hitDistances = []; state.pointer.isDown = false; state.pauseStarted = 0; state.track = { samples: 0, score: 0, totalError: 0, maxError: 0, holdMs: 0, lastTime: performance.now(), vx: 0, vy: 0, nextChange: performance.now() + 300 }; state.decoys = [];
  if (round.type === 'static') spawnStaticSet(); else { state.target = { x: arenaSurface.clientWidth / 2, y: arenaSurface.clientHeight / 2, radius: round.radius }; state.track.vx = (Math.random() > .5 ? 1 : -1) * (110 + Math.random() * 70) * round.speed; state.track.vy = (Math.random() > .5 ? 1 : -1) * (55 + Math.random() * 45) * round.speed; }
  roundTag.textContent = round.tag; roundInstruction.textContent = round.instruction; mouseHint.querySelector('span:last-child').textContent = round.type === 'track' ? '按住左键，跟住变速目标' : (round.decoys ? '避开橙色诱导点' : '保持自然，不要刻意修正'); timerDisplay.textContent = formatTime(round.limit); updateMetrics(); clearRoundTimer(); state.roundTimer = window.setInterval(() => updateTimer(performance.now()), 80);
}

function pointerDown(event) { const point = canvasPoint(event); state.pointer = { ...state.pointer, ...point, hasValue: true, isDown: true }; if (state.phase !== 'round') return; if (getRoundConfig().type === 'track') { canvas.setPointerCapture?.(event.pointerId); return; } checkStaticTarget(point); }
function pointerMove(event) { const point = canvasPoint(event); state.pointer = { ...state.pointer, ...point, hasValue: true }; }
function pointerUp(event) { state.pointer.isDown = false; if (state.phase === 'round' && getRoundConfig().type === 'track') canvas.releasePointerCapture?.(event.pointerId); }

function checkStaticTarget(point) {
  const target = state.target; const distance = Math.hypot(point.x - target.x, point.y - target.y); const decoy = state.decoys.find((item) => Math.hypot(point.x - item.x, point.y - item.y) <= item.radius);
  if (distance <= target.radius) { state.hits += 1; state.reactionTimes.push(performance.now() - state.targetSpawn); state.hitDistances.push(distance / target.radius); state.flash = { x: target.x, y: target.y, at: performance.now() }; if (state.hits >= getRoundConfig().total) finishRound(false); else { spawnStaticSet(); state.targetSpawn = performance.now(); } }
  else { state.misses += 1; state.flash = { x: decoy?.x ?? point.x, y: decoy?.y ?? point.y, at: performance.now(), bad: true }; }
  updateMetrics();
}

function trackPoint(now) {
  if (state.phase !== 'round' || getRoundConfig().type !== 'track') return; const round = getRoundConfig(); const elapsed = now - state.roundStart; const dt = Math.min(60, Math.max(0, now - state.track.lastTime)) / 1000; const width = arenaSurface.clientWidth; const height = arenaSurface.clientHeight;
  if (now >= state.track.nextChange) { const angle = Math.random() * Math.PI * 2; const speed = (110 + Math.random() * 115) * round.speed; state.track.vx = Math.cos(angle) * speed; state.track.vy = Math.sin(angle) * speed * .72; state.track.nextChange = now + round.changeEvery * (.62 + Math.random() * .8); }
  state.target.x += state.track.vx * dt; state.target.y += state.track.vy * dt + Math.sin(elapsed / 400) * .22; const margin = 38;
  if (state.target.x < margin || state.target.x > width - margin) { state.target.x = Math.max(margin, Math.min(width - margin, state.target.x)); state.track.vx *= -1; }
  if (state.target.y < margin || state.target.y > height - margin) { state.target.y = Math.max(margin, Math.min(height - margin, state.target.y)); state.track.vy *= -1; }
  if (state.pointer.hasValue && state.pointer.isDown) { const error = Math.hypot(state.pointer.x - state.target.x, state.pointer.y - state.target.y); const delta = Math.min(70, now - state.track.lastTime); state.track.samples += 1; state.track.totalError += error; state.track.maxError = Math.max(state.track.maxError, error); state.track.score += Math.max(0, 1 - error / (state.target.radius * 4.2)); state.track.holdMs += delta; if (error <= state.target.radius * 1.35) state.flash = { x: state.target.x, y: state.target.y, at: now, soft: true }; }
  state.track.lastTime = now; updateMetrics();
}

function finishRound(timedOut) {
  if (state.phase !== 'round') return; clearRoundTimer(); const round = getRoundConfig(); let score = 0; let reaction = null; let control = 0;
  if (round.type === 'static') { const attempts = state.hits + state.misses; const accuracy = attempts ? state.hits / attempts : 0; reaction = state.reactionTimes.length ? state.reactionTimes.reduce((a, b) => a + b, 0) / state.reactionTimes.length : round.limit; const closeness = state.hitDistances.length ? 1 - state.hitDistances.reduce((a, b) => a + b, 0) / state.hitDistances.length : 0; const reactionScore = Math.max(0, 1 - reaction / 1850); score = Math.round(Math.max(0, Math.min(1, accuracy * .56 + closeness * .16 + reactionScore * .28)) * 100); control = Math.round(Math.max(0, Math.min(1, accuracy * .7 + closeness * .3)) * 100); }
  else { const tracking = state.track.samples ? state.track.score / state.track.samples : 0; const engagement = Math.min(1, state.track.holdMs / (round.limit * .55)); score = Math.round(Math.max(0, Math.min(1, tracking * .74 + engagement * .26)) * 100); control = score; reaction = state.track.samples ? state.track.totalError / state.track.samples : round.limit; }
  state.roundResults[state.roundIndex] = { round: state.roundIndex, score, control, reaction, hits: state.hits, misses: state.misses, timedOut }; updateMetrics(state.roundResults[state.roundIndex]); updateProgress(); updateRouteUI();
  if (state.planPosition < state.plan.length - 1) { state.phase = 'between'; pauseButton.classList.add('hidden'); sessionStatus.textContent = `${round.name}完成`; roundTag.textContent = 'NEXT UP'; roundInstruction.textContent = '准备好后继续下一轮'; stageTitle.innerHTML = `不错，继续找 <span>${state.plan[state.planPosition + 1] === 1 ? '控制' : '稳定'}</span>`; stageDescription.textContent = state.plan[state.planPosition + 1] === 1 ? '速度已经记录，下一轮会把目标缩小并加入更多精细修正。' : '控制已经记录，最后看你的持续跟枪与变向反应。'; startButton.disabled = false; startButtonLabel.textContent = '下一轮'; updateSettingsUI(); }
  else completeSession();
}

function nextRound() { if (state.phase !== 'between') return; state.planPosition += 1; state.roundIndex = state.plan[state.planPosition]; state.phase = 'round'; startButton.disabled = true; startButtonLabel.textContent = '识别进行中'; pauseButton.classList.remove('hidden'); sessionStatus.textContent = `${difficultyProfiles[state.difficulty].label} · 测试进行中`; updateProgress(); updateSettingsUI(); updateRouteUI(); beginRound(); }

function completeSession() { state.phase = 'complete'; startButton.disabled = false; startButtonLabel.textContent = '再测一次'; sessionStatus.textContent = '识别完成'; timerDisplay.textContent = 'DONE'; pauseButton.classList.add('hidden'); updateProgress(); updateSettingsUI(); const recommendation = calculateRecommendation(); saveHistory(recommendation); renderRecommendation(recommendation); resultOverlay.classList.remove('hidden'); stageTitle.innerHTML = `你的手感，已经 <span>有答案</span>`; stageDescription.textContent = '打开完整分析，看看你的速度、控制力和稳定性如何影响推荐值。'; }

function calculateRecommendation() {
  const sens = numberValue(sensitivityInput, 0.35); const flick = state.roundResults[0]?.score ?? null; const micro = state.roundResults[1]?.score ?? null; const track = state.roundResults[2]?.score ?? null; const values = [flick, micro, track].filter((value) => value != null); const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 50; let adjustment = 0; let direction = '平衡';
  if (state.mode === 'speed' && flick != null) { adjustment = flick >= 74 ? .045 : flick < 58 ? -.035 : .01; direction = adjustment > .02 ? '更快' : adjustment < 0 ? '更稳' : '平衡'; }
  else if (state.mode === 'control' && (micro != null || track != null)) { const controlValues = [micro, track].filter((value) => value != null); const controlAverage = controlValues.reduce((a, b) => a + b, 0) / controlValues.length; adjustment = controlAverage >= 76 ? .018 : -.055; direction = adjustment > 0 ? '保留速度' : '更稳'; }
  else if (flick != null && (micro != null || track != null)) { const controlValues = [micro, track].filter((value) => value != null); const controlAverage = controlValues.reduce((a, b) => a + b, 0) / controlValues.length; if (controlAverage < flick - 8) { adjustment = -Math.min(.14, Math.max(.035, (flick - controlAverage) / 900)); direction = '更稳'; } else if (flick < controlAverage - 8) { adjustment = Math.min(.13, Math.max(.035, (controlAverage - flick) / 850)); direction = '更快'; } else if (track != null && track < 58) { adjustment = -.045; direction = '更稳'; } }
  else if (average < 58) { adjustment = -.045; direction = '更稳'; }
  return { sens, recommended: Math.max(.001, sens * (1 + adjustment)), adjustment, flick, micro, track, average, direction };
}

function renderRecommendation(data) {
  const recommended = data.recommended.toFixed(3); const percent = Math.abs(data.adjustment * 100).toFixed(1); const directionText = data.adjustment === 0 ? '保持当前' : `${data.adjustment < 0 ? '比当前低' : '比当前高'} ${percent}%`;
  document.getElementById('resultSensitivity').textContent = recommended; document.getElementById('resultChange').textContent = directionText; document.getElementById('modalSensitivity').textContent = recommended; document.getElementById('modalAdjustment').textContent = `${data.adjustment > 0 ? '+' : ''}${(data.adjustment * 100).toFixed(1)}%`; document.getElementById('modalDirection').textContent = data.direction;
  setScore('flick', data.flick, data.flick == null ? '本次模式未测试' : data.flick >= 70 ? '甩枪速度不错，可以保留节奏。' : '第一反应偏慢，先别急着继续降速。'); setScore('micro', data.micro, data.micro == null ? '本次模式未测试' : data.micro >= 70 ? '小目标控制稳定，手感很有余量。' : '微调有些吃力，降低一点更容易稳住。'); setScore('track', data.track, data.track == null ? '本次模式未测试' : data.track >= 70 ? '持续跟枪表现很好，节奏和灵敏度匹配。' : '跟枪时修正幅度偏大，适合更稳的设置。');
  const note = data.direction === '更快' ? '当前设置的控制力足够，推荐轻微提高速度，让转身和拉枪更利落。' : data.direction === '更稳' ? '你的精细控制更突出，推荐轻微降低速度，减少过瞄并放大稳定优势。' : '三项表现比较均衡，先保留当前方向，只做非常小的微调。'; document.getElementById('recommendationNote').textContent = `${note} 建议先用推荐值打两局，再根据第一感受做 ±0.01 的微调。`;
}

function setScore(prefix, score, note) { document.getElementById(`${prefix}Score`).textContent = score == null ? '—' : `${score}`; document.getElementById(`${prefix}Bar`).style.width = `${score ?? 0}%`; document.getElementById(`${prefix}Note`).textContent = note; }
function updateProgress() { const completed = state.plan.filter((index) => state.roundResults[index]).length; document.getElementById('progressText').textContent = `${completed} / ${state.plan.length}`; document.getElementById('progressFill').style.width = `${state.plan.length ? (completed / state.plan.length) * 100 : 0}%`; }

function updateMetrics(lastResult = null) {
  const hits = lastResult ? lastResult.hits : state.hits; const total = lastResult ? lastResult.hits + lastResult.misses : state.hits + state.misses; document.getElementById('hitsValue').textContent = total ? `${hits} / ${total}` : '—'; let reaction = lastResult?.reaction ?? (state.reactionTimes.length ? state.reactionTimes.reduce((a, b) => a + b, 0) / state.reactionTimes.length : null); if (getRoundConfig().type === 'track' && !lastResult && state.track.samples) reaction = state.track.totalError / state.track.samples; document.getElementById('reactionValue').textContent = reaction == null ? '—' : getRoundConfig().type === 'track' ? `${Math.round(reaction)} px` : `${(reaction / 1000).toFixed(2)} s`; let control = lastResult?.control ?? (state.reactionTimes.length ? Math.round(Math.min(99, state.hits / Math.max(1, total) * 100)) : null); if (getRoundConfig().type === 'track' && !lastResult && state.track.samples) control = Math.round((state.track.score / state.track.samples) * 100); document.getElementById('controlValue').textContent = control == null ? '—' : `${control}`;
}

function drawTarget(target, now) { const pulse = 1 + Math.sin(now / 145) * .05; const r = target.radius * pulse; ctx.save(); ctx.translate(target.x, target.y); ctx.shadowColor = 'rgba(111,225,228,.65)'; ctx.shadowBlur = 19; ctx.fillStyle = 'rgba(111,225,228,.13)'; ctx.beginPath(); ctx.arc(0, 0, r * 1.55, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.fillStyle = '#70e3e5'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#0b1b22'; ctx.beginPath(); ctx.arc(0, 0, r * .58, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(210,255,255,.86)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r * .25, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = 'rgba(180,255,255,.5)'; ctx.beginPath(); ctx.moveTo(-r * 1.3, 0); ctx.lineTo(-r * .8, 0); ctx.moveTo(r * .8, 0); ctx.lineTo(r * 1.3, 0); ctx.moveTo(0, -r * 1.3); ctx.lineTo(0, -r * .8); ctx.moveTo(0, r * .8); ctx.lineTo(0, r * 1.3); ctx.stroke(); ctx.restore(); }
function drawDecoys(now) { state.decoys.forEach((decoy) => { const pulse = 1 + Math.sin(now / 220 + decoy.phase) * .08; const r = decoy.radius * pulse; ctx.save(); ctx.translate(decoy.x, decoy.y); ctx.globalAlpha = .7; ctx.strokeStyle = 'rgba(250,128,110,.73)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * .35, 0, Math.PI * 2); ctx.stroke(); ctx.strokeStyle = 'rgba(250,128,110,.35)'; ctx.beginPath(); ctx.moveTo(-r * 1.18, 0); ctx.lineTo(r * 1.18, 0); ctx.moveTo(0, -r * 1.18); ctx.lineTo(0, r * 1.18); ctx.stroke(); ctx.restore(); }); }
function drawPointer() { if (!['round', 'paused'].includes(state.phase) || !state.pointer.hasValue) return; ctx.save(); ctx.translate(state.pointer.x, state.pointer.y); ctx.strokeStyle = 'rgba(220,255,255,.64)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-4, 0); ctx.moveTo(4, 0); ctx.lineTo(11, 0); ctx.moveTo(0, -11); ctx.lineTo(0, -4); ctx.moveTo(0, 4); ctx.lineTo(0, 11); ctx.stroke(); ctx.restore(); }
function draw(now) { const width = arenaSurface.clientWidth; const height = arenaSurface.clientHeight; ctx.clearRect(0, 0, width, height); if (['round', 'paused'].includes(state.phase)) { if (state.phase === 'round' && getRoundConfig().type === 'track') trackPoint(now); drawDecoys(now); drawTarget(state.target, now); drawPointer(); } if (state.flash && now - state.flash.at < 450) { const progress = (now - state.flash.at) / 450; ctx.save(); ctx.globalAlpha = 1 - progress; ctx.strokeStyle = state.flash.bad ? '#fa806e' : state.flash.soft ? '#f1c86d' : '#b3ffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(state.flash.x, state.flash.y, state.target.radius * (.8 + progress * 1.9), 0, Math.PI * 2); ctx.stroke(); ctx.restore(); } else state.flash = null; requestAnimationFrame(draw); }

function togglePause() { if (state.phase === 'round') { state.phase = 'paused'; state.pauseStarted = performance.now(); clearRoundTimer(); pauseButton.textContent = '继续'; pauseOverlay.classList.remove('hidden'); sessionStatus.textContent = '已暂停'; updateRouteUI(); } else if (state.phase === 'paused') resumeTest(); }
function resumeTest() { if (state.phase !== 'paused') return; const gap = performance.now() - state.pauseStarted; state.roundStart += gap; state.targetSpawn += gap; state.track.nextChange += gap; state.track.lastTime = performance.now(); state.phase = 'round'; pauseButton.textContent = '暂停'; pauseOverlay.classList.add('hidden'); sessionStatus.textContent = `${difficultyProfiles[state.difficulty].label} · 测试进行中`; state.roundTimer = window.setInterval(() => updateTimer(performance.now()), 80); updateRouteUI(); }

function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
function saveHistory(data) { const record = { time: new Date().toISOString(), mode: state.mode, difficulty: state.difficulty, recommended: data.recommended, adjustment: data.adjustment, average: data.average }; state.history = [record, ...state.history].slice(0, 5); localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history)); renderHistory(); }
function renderHistory() { if (!state.history.length) { historyList.innerHTML = '<div class="history-empty">完成一次测试后，这里会保留最近结果。</div>'; return; } historyList.innerHTML = state.history.slice(0, 3).map((record) => { const date = new Date(record.time); const dateText = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; return `<div class="history-row"><div><strong>${modeProfiles[record.mode]?.label || '完整识别'} · ${difficultyProfiles[record.difficulty]?.label || '标准'}</strong><span>${dateText} · 平均 ${Math.round(record.average || 0)} 分</span></div><div class="history-value">${Number(record.recommended).toFixed(3)}<small>推荐值</small></div></div>`; }).join(''); }

async function copyResult() { const data = calculateRecommendation(); const text = `SENS LAB 灵敏度识别\n推荐灵敏度：${data.recommended.toFixed(3)}\n调整：${data.adjustment > 0 ? '+' : ''}${(data.adjustment * 100).toFixed(1)}%\n模式：${modeProfiles[state.mode].label} / ${difficultyProfiles[state.difficulty].label}`; try { await navigator.clipboard.writeText(text); copyButton.innerHTML = '已复制 <span>✓</span>'; } catch { copyButton.innerHTML = '请手动复制 <span>!</span>'; } window.setTimeout(() => { copyButton.innerHTML = '复制结果 <span>⌘C</span>'; }, 1800); }

function resetAll() { clearRoundTimer(); state.phase = 'intro'; state.plan = [...modeProfiles[state.mode].rounds]; state.planPosition = 0; state.roundIndex = state.plan[0] || 0; state.roundResults = []; state.pointer.isDown = false; state.pointer.hasValue = false; state.decoys = []; state.flash = null; introOverlay.classList.remove('hidden'); resultOverlay.classList.add('hidden'); pauseOverlay.classList.add('hidden'); resultModal.classList.add('hidden'); startButton.disabled = false; startButtonLabel.textContent = '开始识别'; sessionStatus.textContent = '准备开始'; roundTag.textContent = '准备阶段'; roundInstruction.textContent = '输入你的设置，然后开始识别'; timerDisplay.textContent = '00:00'; pauseButton.classList.add('hidden'); stageTitle.innerHTML = '找到你的 <span>Sweet Spot</span>'; stageDescription.textContent = '选择模式和难度，用一组更接近实战的测试找到适合你的灵敏度。'; updateProgress(); updateSettingsUI(); updateRouteUI(); updateMetrics(); }

document.querySelectorAll('#modeSwitch .segment').forEach((button) => button.addEventListener('click', () => { if (['round', 'paused', 'between'].includes(state.phase)) return; state.mode = button.dataset.mode; resetAll(); }));
document.querySelectorAll('#difficultySwitch .segment').forEach((button) => button.addEventListener('click', () => { if (['round', 'paused', 'between'].includes(state.phase)) return; state.difficulty = button.dataset.difficulty; resetAll(); }));
sensitivityInput.addEventListener('input', updateDerivedStats); dpiInput.addEventListener('input', updateDerivedStats);
startButton.addEventListener('click', () => { if (state.phase === 'between') nextRound(); else if (state.phase === 'paused') resumeTest(); else startSession(); });
resetButton.addEventListener('click', resetAll); pauseButton.addEventListener('click', togglePause); resumeButton.addEventListener('click', resumeTest); viewResultButton.addEventListener('click', () => resultModal.classList.remove('hidden')); closeModal.addEventListener('click', () => resultModal.classList.add('hidden')); againButton.addEventListener('click', () => { resultModal.classList.add('hidden'); startSession(); }); copyButton.addEventListener('click', copyResult); resultModal.addEventListener('click', (event) => { if (event.target === resultModal) resultModal.classList.add('hidden'); });
canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointercancel', pointerUp); window.addEventListener('resize', resizeCanvas);
window.addEventListener('keydown', (event) => { if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return; if (event.key === 'Escape' && ['round', 'paused'].includes(state.phase)) { event.preventDefault(); togglePause(); } if (event.code === 'Space' && ['intro', 'between', 'complete', 'paused'].includes(state.phase)) { event.preventDefault(); if (state.phase === 'paused') resumeTest(); else if (state.phase === 'between') nextRound(); else startSession(); } });

updateDerivedStats(); renderHistory(); updateSettingsUI(); updateRouteUI(); updateProgress(); resizeCanvas(); requestAnimationFrame(draw);
