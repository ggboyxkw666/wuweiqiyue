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
const mouseHint = document.getElementById('mouseHint');

const rounds = [
  { name: '甩枪定位', tag: 'ROUND 01', description: '快速点中目标，找到你的第一反应速度。', instruction: '点击出现的目标', total: 12, radius: 29, limit: 32000, type: 'static' },
  { name: '微调校准', tag: 'ROUND 02', description: '目标更小，看看你能否在速度和控制间保持平衡。', instruction: '点击小目标，保持自然节奏', total: 14, radius: 17, limit: 34000, type: 'static' },
  { name: '跟枪稳定', tag: 'ROUND 03', description: '跟住移动目标，测试你的持续控制和修正习惯。', instruction: '按住左键，跟住移动目标', total: 1, radius: 24, limit: 22000, type: 'track' },
];

const state = {
  phase: 'intro',
  roundIndex: 0,
  roundStart: 0,
  targetSpawn: 0,
  target: { x: 0, y: 0, radius: 30 },
  targetPulse: 0,
  hits: 0,
  misses: 0,
  reactionTimes: [],
  hitDistances: [],
  roundResults: [],
  pointer: { x: 0, y: 0, hasValue: false, isDown: false },
  track: { samples: 0, score: 0, totalError: 0, maxError: 0, holdMs: 0, lastTime: 0 },
  roundTimer: null,
  flash: null,
  finishTimer: null,
};

function numberValue(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function updateDerivedStats() {
  const sens = numberValue(sensitivityInput, 0.35);
  const dpi = numberValue(dpiInput, 800);
  const edpi = sens * dpi;
  const cm = 13062.86 / edpi;
  edpiValue.textContent = Math.round(edpi);
  cmValue.innerHTML = `${cm.toFixed(1)} <small>cm</small>`;
}

function resizeCanvas() {
  const rect = arenaSurface.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (!state.pointer.hasValue) {
    state.pointer.x = rect.width / 2;
    state.pointer.y = rect.height / 2;
  }
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function randomTarget(radius) {
  const width = arenaSurface.clientWidth;
  const height = arenaSurface.clientHeight;
  const pad = Math.max(42, radius + 26);
  return { x: pad + Math.random() * Math.max(1, width - pad * 2), y: pad + Math.random() * Math.max(1, height - pad * 2), radius };
}

function updateUIForRound() {
  const round = rounds[state.roundIndex];
  roundTag.textContent = round.tag;
  roundInstruction.textContent = round.instruction;
  stageTitle.innerHTML = `${round.name} <span>${state.roundIndex === 0 ? '速度' : state.roundIndex === 1 ? '控制' : '稳定'}</span>`;
  stageDescription.textContent = round.description;
  mouseHint.querySelector('span:last-child').textContent = round.type === 'track' ? '按住左键，跟住目标' : '保持自然，不要刻意修正';
  document.querySelectorAll('.round-item').forEach((item, index) => {
    item.classList.toggle('active', index === state.roundIndex);
    item.classList.toggle('done', index < state.roundIndex || state.roundResults[index]);
    const stateText = item.querySelector('.round-state');
    if (state.roundResults[index]) stateText.textContent = '已完成';
    else if (index === state.roundIndex) stateText.textContent = '进行中';
    else stateText.textContent = '锁定';
  });
}

function formatTime(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `00:${String(seconds).padStart(2, '0')}`;
}

function updateTimer(now) {
  if (state.phase !== 'round') return;
  const round = rounds[state.roundIndex];
  const left = round.limit - (now - state.roundStart);
  timerDisplay.textContent = formatTime(left);
  if (left <= 0) finishRound(true);
}

function clearRoundTimer() {
  if (state.roundTimer) window.clearInterval(state.roundTimer);
  state.roundTimer = null;
}

function startSession() {
  clearRoundTimer();
  if (state.finishTimer) window.clearTimeout(state.finishTimer);
  state.phase = 'round';
  state.roundIndex = 0;
  state.roundResults = [];
  introOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  resultModal.classList.add('hidden');
  startButtonLabel.textContent = '识别进行中';
  sessionStatus.textContent = '测试进行中';
  startButton.disabled = true;
  updateProgress();
  updateUIForRound();
  beginRound();
}

function beginRound() {
  const round = rounds[state.roundIndex];
  state.roundStart = performance.now();
  state.targetSpawn = state.roundStart;
  state.hits = 0;
  state.misses = 0;
  state.reactionTimes = [];
  state.hitDistances = [];
  state.pointer.isDown = false;
  state.track = { samples: 0, score: 0, totalError: 0, maxError: 0, holdMs: 0, lastTime: performance.now() };
  state.target = randomTarget(round.radius);
  updateMetrics();
  clearRoundTimer();
  state.roundTimer = window.setInterval(() => updateTimer(performance.now()), 80);
  timerDisplay.textContent = formatTime(round.limit);
}

function pointerDown(event) {
  const point = canvasPoint(event);
  state.pointer = { ...state.pointer, ...point, hasValue: true, isDown: true };
  if (state.phase !== 'round') return;
  if (rounds[state.roundIndex].type === 'track') {
    canvas.setPointerCapture?.(event.pointerId);
    return;
  }
  checkStaticTarget(point);
}

function pointerMove(event) {
  const point = canvasPoint(event);
  state.pointer = { ...state.pointer, ...point, hasValue: true };
}

function pointerUp(event) {
  state.pointer.isDown = false;
  if (state.phase === 'round' && rounds[state.roundIndex].type === 'track') canvas.releasePointerCapture?.(event.pointerId);
}

function checkStaticTarget(point) {
  const target = state.target;
  const distance = Math.hypot(point.x - target.x, point.y - target.y);
  if (distance <= target.radius) {
    state.hits += 1;
    state.reactionTimes.push(performance.now() - state.targetSpawn);
    state.hitDistances.push(distance / target.radius);
    state.flash = { x: target.x, y: target.y, at: performance.now() };
    if (state.hits >= rounds[state.roundIndex].total) {
      finishRound(false);
    } else {
      state.target = randomTarget(rounds[state.roundIndex].radius);
      state.targetSpawn = performance.now();
    }
  } else {
    state.misses += 1;
  }
  updateMetrics();
}

function trackPoint(now) {
  if (state.phase !== 'round' || rounds[state.roundIndex].type !== 'track') return;
  const elapsed = now - state.roundStart;
  const width = arenaSurface.clientWidth;
  const height = arenaSurface.clientHeight;
  const safeX = Math.max(60, width - 60);
  const wave = Math.sin(elapsed / 870) * 0.5 + Math.sin(elapsed / 330) * 0.16;
  state.target.x = width / 2 + wave * Math.min(width * .42, 380);
  state.target.y = height / 2 + Math.sin(elapsed / 1250) * Math.min(height * .27, 120);
  state.target.x = Math.max(42, Math.min(safeX, state.target.x));
  if (state.pointer.hasValue && state.pointer.isDown) {
    const error = Math.hypot(state.pointer.x - state.target.x, state.pointer.y - state.target.y);
    const delta = Math.min(70, now - state.track.lastTime);
    state.track.samples += 1;
    state.track.totalError += error;
    state.track.maxError = Math.max(state.track.maxError, error);
    state.track.score += Math.max(0, 1 - error / 150);
    state.track.holdMs += delta;
    if (error <= state.target.radius * 1.35) state.flash = { x: state.target.x, y: state.target.y, at: now, soft: true };
  }
  state.track.lastTime = now;
  updateMetrics();
}

function finishRound(timedOut) {
  if (state.phase !== 'round') return;
  clearRoundTimer();
  const round = rounds[state.roundIndex];
  let score = 0;
  let reaction = null;
  let control = 0;
  if (round.type === 'static') {
    const attempts = state.hits + state.misses;
    const accuracy = attempts ? state.hits / attempts : 0;
    reaction = state.reactionTimes.length ? state.reactionTimes.reduce((a, b) => a + b, 0) / state.reactionTimes.length : round.limit;
    const closeness = state.hitDistances.length ? 1 - state.hitDistances.reduce((a, b) => a + b, 0) / state.hitDistances.length : 0;
    score = Math.round(Math.max(0, Math.min(1, accuracy * .56 + closeness * .15 + Math.max(0, 1 - reaction / 1700) * .29)) * 100);
    control = Math.round(Math.max(0, Math.min(1, accuracy * .7 + closeness * .3)) * 100);
  } else {
    const tracking = state.track.samples ? state.track.score / state.track.samples : 0;
    const engagement = Math.min(1, state.track.holdMs / (round.limit * .55));
    score = Math.round(Math.max(0, Math.min(1, tracking * .75 + engagement * .25)) * 100);
    control = score;
    reaction = state.track.samples ? state.track.totalError / state.track.samples : round.limit;
  }
  const result = { round: state.roundIndex, score, control, reaction, hits: state.hits, misses: state.misses, timedOut };
  state.roundResults[state.roundIndex] = result;
  updateMetrics(result);
  document.querySelector(`.round-item[data-round="${state.roundIndex}"] .round-state`).textContent = '已完成';
  document.querySelector(`.round-item[data-round="${state.roundIndex}"]`).classList.add('done');
  if (state.roundIndex < rounds.length - 1) {
    state.phase = 'between';
    sessionStatus.textContent = `第 ${state.roundIndex + 1} 轮完成`;
    roundTag.textContent = 'NEXT UP';
    roundInstruction.textContent = '准备好后继续下一轮';
    stageTitle.innerHTML = `不错，继续找 <span>${state.roundIndex === 0 ? '控制' : '稳定'}</span>`;
    stageDescription.textContent = state.roundIndex === 0 ? '速度已经记录，下一轮我们会把目标缩小。' : '控制已经记录，最后看你的持续跟枪。';
    startButton.disabled = false;
    startButtonLabel.textContent = '下一轮';
  } else {
    completeSession();
  }
}

function nextRound() {
  if (state.phase !== 'between') return;
  state.roundIndex += 1;
  state.phase = 'round';
  startButton.disabled = true;
  startButtonLabel.textContent = '识别进行中';
  sessionStatus.textContent = '测试进行中';
  updateProgress();
  updateUIForRound();
  beginRound();
}

function completeSession() {
  state.phase = 'complete';
  startButton.disabled = false;
  startButtonLabel.textContent = '再测一次';
  sessionStatus.textContent = '识别完成';
  timerDisplay.textContent = 'DONE';
  updateProgress();
  const recommendation = calculateRecommendation();
  renderRecommendation(recommendation);
  resultOverlay.classList.remove('hidden');
  stageTitle.innerHTML = `你的手感，已经 <span>有答案</span>`;
  stageDescription.textContent = '打开完整分析，看看你的速度与控制力如何影响推荐值。';
}

function calculateRecommendation() {
  const sens = numberValue(sensitivityInput, 0.35);
  const flick = state.roundResults[0]?.score ?? 50;
  const micro = state.roundResults[1]?.score ?? 50;
  const track = state.roundResults[2]?.score ?? 50;
  const speed = flick * .38 + track * .18;
  const control = micro * .32 + track * .12;
  let adjustment = 0;
  let direction = '平衡';
  if (micro + track < flick - 8) { adjustment = -Math.min(0.14, Math.max(0.035, (flick - (micro + track) / 2) / 900)); direction = '更稳'; }
  else if (flick + 8 < micro + track) { adjustment = Math.min(0.13, Math.max(0.035, ((micro + track) / 2 - flick) / 850)); direction = '更快'; }
  else if (track < 58) { adjustment = -0.045; direction = '更稳'; }
  else if (flick < 58) { adjustment = 0.045; direction = '更快'; }
  const recommended = Math.max(0.001, sens * (1 + adjustment));
  return { sens, recommended, adjustment, flick, micro, track, speed, control, direction };
}

function renderRecommendation(data) {
  const recommended = data.recommended.toFixed(3);
  const percent = Math.abs(data.adjustment * 100).toFixed(1);
  const directionText = data.adjustment === 0 ? '保持当前' : `${data.adjustment < 0 ? '比当前低' : '比当前高'} ${percent}%`;
  document.getElementById('resultSensitivity').textContent = recommended;
  document.getElementById('resultChange').textContent = directionText;
  document.getElementById('modalSensitivity').textContent = recommended;
  document.getElementById('modalAdjustment').textContent = `${data.adjustment > 0 ? '+' : ''}${(data.adjustment * 100).toFixed(1)}%`;
  document.getElementById('modalDirection').textContent = data.direction;
  setScore('flick', data.flick, data.flick >= 70 ? '甩枪速度不错，可以保留节奏。' : '第一反应偏慢，先别急着继续降速。');
  setScore('micro', data.micro, data.micro >= 70 ? '小目标控制稳定，手感很有余量。' : '微调有些吃力，降低一点更容易稳住。');
  setScore('track', data.track, data.track >= 70 ? '持续跟枪表现很好，节奏和灵敏度匹配。' : '跟枪时修正幅度偏大，适合更稳的设置。');
  const note = data.direction === '更快' ? '当前设置的控制力足够，推荐轻微提高速度，让转身和拉枪更利落。' : data.direction === '更稳' ? '你的精细控制更突出，推荐轻微降低速度，减少过瞄并放大稳定优势。' : '三项表现比较均衡，先保留当前方向，只做非常小的微调。';
  document.getElementById('recommendationNote').textContent = `${note} 建议先用推荐值打两局，再根据第一感受做 ±0.01 的微调。`;
}

function setScore(prefix, score, note) {
  document.getElementById(`${prefix}Score`).textContent = `${score}`;
  document.getElementById(`${prefix}Bar`).style.width = `${score}%`;
  document.getElementById(`${prefix}Note`).textContent = note;
}

function updateProgress() {
  const completed = state.roundResults.filter(Boolean).length;
  document.getElementById('progressText').textContent = `${completed} / 3`;
  document.getElementById('progressFill').style.width = `${(completed / 3) * 100}%`;
}

function updateMetrics(lastResult = null) {
  const hits = lastResult ? lastResult.hits : state.hits;
  const total = lastResult ? lastResult.hits + lastResult.misses : state.hits + state.misses;
  document.getElementById('hitsValue').textContent = total ? `${hits} / ${total}` : '—';
  let reaction = lastResult?.reaction ?? (state.reactionTimes.length ? state.reactionTimes.reduce((a, b) => a + b, 0) / state.reactionTimes.length : null);
  if (rounds[state.roundIndex]?.type === 'track' && !lastResult && state.track.samples) reaction = state.track.totalError / state.track.samples;
  document.getElementById('reactionValue').textContent = reaction == null ? '—' : rounds[state.roundIndex]?.type === 'track' ? `${Math.round(reaction)} px` : `${(reaction / 1000).toFixed(2)} s`;
  let control = lastResult?.control ?? (state.reactionTimes.length ? Math.round(Math.min(99, state.hits / Math.max(1, total) * 100)) : null);
  if (rounds[state.roundIndex]?.type === 'track' && !lastResult && state.track.samples) control = Math.round((state.track.score / state.track.samples) * 100);
  document.getElementById('controlValue').textContent = control == null ? '—' : `${control}`;
}

function drawTarget(target, now) {
  const pulse = 1 + Math.sin(now / 145) * .05;
  const r = target.radius * pulse;
  ctx.save();
  ctx.translate(target.x, target.y);
  ctx.shadowColor = 'rgba(111,225,228,.65)';
  ctx.shadowBlur = 19;
  ctx.fillStyle = 'rgba(111,225,228,.13)';
  ctx.beginPath(); ctx.arc(0, 0, r * 1.55, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#70e3e5'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0b1b22'; ctx.beginPath(); ctx.arc(0, 0, r * .58, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(210,255,255,.86)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r * .25, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(180,255,255,.5)'; ctx.beginPath(); ctx.moveTo(-r * 1.3, 0); ctx.lineTo(-r * .8, 0); ctx.moveTo(r * .8, 0); ctx.lineTo(r * 1.3, 0); ctx.moveTo(0, -r * 1.3); ctx.lineTo(0, -r * .8); ctx.moveTo(0, r * .8); ctx.lineTo(0, r * 1.3); ctx.stroke();
  ctx.restore();
}

function drawPointer() {
  if (state.phase !== 'round' || !state.pointer.hasValue) return;
  ctx.save(); ctx.translate(state.pointer.x, state.pointer.y); ctx.strokeStyle = 'rgba(220,255,255,.64)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-4, 0); ctx.moveTo(4, 0); ctx.lineTo(11, 0); ctx.moveTo(0, -11); ctx.lineTo(0, -4); ctx.moveTo(0, 4); ctx.lineTo(0, 11); ctx.stroke(); ctx.restore();
}

function draw(now) {
  const width = arenaSurface.clientWidth;
  const height = arenaSurface.clientHeight;
  ctx.clearRect(0, 0, width, height);
  if (state.phase === 'round') {
    if (rounds[state.roundIndex].type === 'track') trackPoint(now);
    drawTarget(state.target, now);
    drawPointer();
  }
  if (state.flash && now - state.flash.at < 450) {
    const age = now - state.flash.at;
    const progress = age / 450;
    ctx.save(); ctx.globalAlpha = 1 - progress; ctx.strokeStyle = state.flash.soft ? '#f1c86d' : '#b3ffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(state.flash.x, state.flash.y, state.target.radius * (.8 + progress * 1.9), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  } else state.flash = null;
  requestAnimationFrame(draw);
}

function resetAll() {
  clearRoundTimer();
  state.phase = 'intro'; state.roundIndex = 0; state.roundResults = []; state.pointer.isDown = false; state.pointer.hasValue = false;
  introOverlay.classList.remove('hidden'); resultOverlay.classList.add('hidden'); resultModal.classList.add('hidden');
  startButton.disabled = false; startButtonLabel.textContent = '开始识别'; sessionStatus.textContent = '准备开始'; roundTag.textContent = '准备阶段'; roundInstruction.textContent = '输入你的设置，然后开始识别'; timerDisplay.textContent = '00:00';
  stageTitle.innerHTML = '找到你的 <span>Sweet Spot</span>'; stageDescription.textContent = '用三轮短测试，识别你的速度、控制力和稳定性。';
  updateProgress(); updateUIForRound(); updateMetrics();
}

sensitivityInput.addEventListener('input', updateDerivedStats);
dpiInput.addEventListener('input', updateDerivedStats);
startButton.addEventListener('click', () => {
  if (state.phase === 'between') nextRound();
  else startSession();
});
resetButton.addEventListener('click', resetAll);
viewResultButton.addEventListener('click', () => resultModal.classList.remove('hidden'));
closeModal.addEventListener('click', () => resultModal.classList.add('hidden'));
againButton.addEventListener('click', () => { resultModal.classList.add('hidden'); startSession(); });
resultModal.addEventListener('click', (event) => { if (event.target === resultModal) resultModal.classList.add('hidden'); });
canvas.addEventListener('pointerdown', pointerDown);
canvas.addEventListener('pointermove', pointerMove);
canvas.addEventListener('pointerup', pointerUp);
canvas.addEventListener('pointercancel', pointerUp);
window.addEventListener('resize', resizeCanvas);

updateDerivedStats(); updateUIForRound(); updateProgress(); resizeCanvas(); requestAnimationFrame(draw);
