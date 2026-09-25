// Звук синтезируется на лету: ассетов нет ни байта, а высота тона берётся
// от размера звезды — по той же starRadius, что и её радиус на небе, чтобы
// крупная звезда звучала ниже ровно настолько, насколько она больше.
import { starRadius } from '../../shared/layout/params';
import { birthTuning } from './canvas/birth';

// Лад — набор полутонов, куда притягивается любая нота. Звуки накладываются
// друг на друга (клик по звезде, пока рядом идёт рождение), и в ладу без
// полутоновых трений любые две ноты складываются без грязи.
const SCALES = {
	minor: { label: 'минор', steps: [0, 3, 5, 7, 10] },
	major: { label: 'мажор', steps: [0, 2, 4, 7, 9] },
	whole: { label: 'целотон', steps: [0, 2, 4, 6, 8, 10] },
	lydian: { label: 'лидийский', steps: [0, 2, 4, 6, 7, 9, 11] },
	hira: { label: 'японский', steps: [0, 2, 3, 7, 8] },
};

// Тембр — обертоны [во сколько раз выше основного, громкость, доля затухания].
// Негармоничные кратные дают звон, целые — струну; в них вся разница.
const VOICES = {
	bell: {
		label: 'колокол',
		type: 'sine' as OscillatorType,
		attack: 0.004,
		tick: 1,
		life: 1,
		partials: [
			[1, 1, 1],
			[2.76, 0.55, 0.62],
			[5.4, 0.3, 0.38],
		],
	},
	glass: {
		label: 'стекло',
		type: 'sine' as OscillatorType,
		attack: 0.002,
		tick: 1.4,
		life: 0.7,
		partials: [
			[1, 1, 1],
			[3.01, 0.4, 0.5],
			[7.2, 0.22, 0.3],
			[11.3, 0.1, 0.18],
		],
	},
	wood: {
		label: 'дерево',
		type: 'sine' as OscillatorType,
		attack: 0.002,
		tick: 0.6,
		life: 0.28,
		partials: [
			[1, 1, 1],
			[3.9, 0.35, 0.3],
			[10.2, 0.12, 0.16],
		],
	},
	string: {
		label: 'струна',
		type: 'triangle' as OscillatorType,
		attack: 0.006,
		tick: 0.8,
		life: 0.85,
		partials: [
			[1, 1, 1],
			[2, 0.5, 0.8],
			[3, 0.33, 0.62],
			[4, 0.25, 0.48],
			[5, 0.2, 0.36],
		],
	},
	pad: {
		label: 'подушка',
		type: 'sine' as OscillatorType,
		attack: 0.35,
		tick: 0,
		life: 1.8,
		partials: [
			[1, 1, 1],
			[2, 0.3, 1],
			[3, 0.15, 0.9],
		],
	},
};

// Чем звучит искра, пока летит от карточки к звезде.
const SPARKS = {
	dust: 'искорки',
	glide: 'глиссандо',
	run: 'пробежка',
	shimmer: 'шиммер',
	noise: 'шум',
	off: 'тишина',
};

type ScaleKey = keyof typeof SCALES;
type VoiceKey = keyof typeof VOICES;
type SparkKey = keyof typeof SPARKS;

export const SCALE_OPTIONS = Object.entries(SCALES).map(([key, s]) => ({ key, label: s.label }));
export const VOICE_OPTIONS = Object.entries(VOICES).map(([key, v]) => ({ key, label: v.label }));
export const SPARK_OPTIONS = Object.entries(SPARKS).map(([key, label]) => ({ key, label }));

const MAX_DEGREE = 150;

export const soundTuning = {
	scale: 'hira' as ScaleKey,
	voice: 'pad' as VoiceKey,
	spark: 'shimmer' as SparkKey,

	volume: 0.3,
	reverb: 0.2, // секунд хвоста
	wet: 0.35,
	root: 220, // Гц, нота самой крупной звезды
	span: 29, // полутонов между звездой на 150 связей и одиночкой

	clickLevel: 0.1,
	clickDecay: 0.5,
	clickPartials: 0.55,
	clickTick: 0.22, // щелчок атаки: без него удар неотличим от свиста
	clickTone: 3000, // Гц, срез поверх обертонов

	birthSweep: 1.3, // секунд разгона до вспышки
	birthFrom: 260,
	birthTo: 6500,
	birthSwoosh: 0.5,
	birthSub: 0.7,
	birthChord: 0.5,
	birthTail: 5,
	birthDrop: 18, // на сколько полутонов аккорд ниже ноты самой звезды

	linkLevel: 0.1,
	linkGap: 0.4, // секунд до ответной ноты: столько летит искра
	linkLift: 0, // полутонов вверх у ответной ноты
	linkSpark: 0.5,
	linkDecay: 0.6,
};

type Engine = {
	ctx: AudioContext;
	bus: GainNode;
	master: GainNode;
	wet: GainNode;
	convolver: ConvolverNode;
	noise: AudioBuffer;
};

let engine: Engine | null = null;
let irSeconds = 0;

function start(): Engine | null {
	if (engine) return engine;
	const Ctor =
		window.AudioContext ??
		(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Ctor) return null;

	const ctx = new Ctor();
	const master = ctx.createGain();
	master.connect(ctx.destination);

	const convolver = ctx.createConvolver();
	const wet = ctx.createGain();
	convolver.connect(wet).connect(master);

	const bus = ctx.createGain();
	bus.connect(master);
	bus.connect(convolver);

	const length = Math.floor(ctx.sampleRate * 2);
	const noise = ctx.createBuffer(1, length, ctx.sampleRate);
	const data = noise.getChannelData(0);
	for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;

	engine = { ctx, bus, master, wet, convolver, noise };
	return engine;
}

// Хвост не из файла: шум с экспоненциальным спадом звучит как большой зал
// и весит ноль. Пересобирается, только когда ползунок сменил длину.
function reverb(e: Engine): void {
	if (irSeconds === soundTuning.reverb) return;
	irSeconds = soundTuning.reverb;
	const length = Math.max(1, Math.floor(e.ctx.sampleRate * irSeconds));
	const ir = e.ctx.createBuffer(2, length, e.ctx.sampleRate);
	for (let ch = 0; ch < 2; ch += 1) {
		const data = ir.getChannelData(ch);
		for (let i = 0; i < length; i += 1) {
			data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
		}
	}
	e.convolver.buffer = ir;
}

function ready(): Engine | null {
	const e = start();
	if (!e) return null;
	reverb(e);
	e.master.gain.value = soundTuning.volume;
	e.wet.gain.value = soundTuning.wet;
	return e;
}

// iOS и Android не заводят звук без жеста человека, а Telegram открывает
// приложение сразу на небе — поэтому контекст будит первое же касание.
function wake(): void {
	const e = start();
	if (!e) return;
	if (e.ctx.state !== 'running') void e.ctx.resume();
	if (e.ctx.state === 'running') {
		for (const event of WAKE_EVENTS) window.removeEventListener(event, wake);
	}
}

const WAKE_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const;
if (typeof window !== 'undefined') {
	for (const event of WAKE_EVENTS) window.addEventListener(event, wake, { passive: true });
}

// Высота считается в полутонах и лишь потом притягивается к ладу: так смена
// лада не растягивает диапазон, а только меняет, на какие ноты он ложится.
function semisFor(degree: number): number {
	const lo = starRadius(0);
	const hi = starRadius(MAX_DEGREE);
	const t = (starRadius(Math.min(Math.max(degree, 0), MAX_DEGREE)) - lo) / (hi - lo);
	return (1 - t) * soundTuning.span;
}

function scaleSteps(): number[] {
	return (SCALES[soundTuning.scale] ?? SCALES.minor).steps;
}

function snap(semis: number): number {
	const octave = Math.floor(semis / 12);
	const within = semis - octave * 12;
	let best = 12;
	for (const step of scaleSteps()) {
		if (Math.abs(step - within) < Math.abs(best - within)) best = step;
	}
	return octave * 12 + best;
}

function nextStep(semis: number): number {
	const steps = scaleSteps();
	const octave = Math.floor(semis / 12);
	const within = semis - octave * 12;
	for (const step of steps) {
		if (step > within + 0.001) return octave * 12 + step;
	}
	return (octave + 1) * 12 + steps[0];
}

function freq(semis: number): number {
	return soundTuning.root * Math.pow(2, semis / 12);
}

// Для песочницы: какой нотой звучит звезда с таким числом связей.
export function starNote(degree: number): number {
	return freq(snap(semisFor(degree)));
}

// Пара нот новой связи, в герцах: своя и нота друга как есть. У близких по
// числу связей звёзд обе ложатся на одну ступень лада — это десятая часть всех
// пар, — и связь звучит повтором вместо отклика. Тогда отклик уходит на ступень
// вверх: на 0…150 связей ступеней всего тринадцать, реже совпадать они не могут.
export function linkNotes(mine: number, theirs: number): [number, number] {
	const ours = snap(semisFor(mine));
	const answer = snap(semisFor(theirs) + soundTuning.linkLift);
	return [freq(ours), freq(answer === ours ? nextStep(answer) : answer)];
}

function pluck(e: Engine, hz: number, at: number, level: number, decay: number): void {
	const T = soundTuning;
	const voice = VOICES[T.voice] ?? VOICES.bell;

	const tone = e.ctx.createBiquadFilter();
	tone.type = 'lowpass';
	tone.frequency.value = T.clickTone;
	tone.connect(e.bus);

	voice.partials.forEach(([ratio, gain, share], i) => {
		const peak = level * (i === 0 ? 1 : gain * T.clickPartials);
		// Ползунок обертонов доходит до нуля, а экспоненциальный спад из нуля не считается.
		if (peak <= 0.0005) return;
		const life = decay * voice.life * share;
		const attack = Math.min(voice.attack, life * 0.4);
		const osc = e.ctx.createOscillator();
		osc.type = voice.type;
		osc.frequency.value = hz * ratio;
		const g = e.ctx.createGain();
		g.gain.setValueAtTime(0.0001, at);
		g.gain.linearRampToValueAtTime(peak, at + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, at + life);
		osc.connect(g).connect(tone);
		osc.start(at);
		osc.stop(at + life + 0.05);
	});

	tick(e, at, T.clickTick * voice.tick);
}

function tick(e: Engine, at: number, level: number): void {
	if (level <= 0.001) return;
	const src = e.ctx.createBufferSource();
	src.buffer = e.noise;
	const band = e.ctx.createBiquadFilter();
	band.type = 'bandpass';
	band.frequency.value = 3200;
	band.Q.value = 1.2;
	const gain = e.ctx.createGain();
	gain.gain.setValueAtTime(level, at);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
	src.connect(band).connect(gain).connect(e.bus);
	src.start(at, Math.random() * 1.5);
	src.stop(at + 0.06);
}

function swoosh(e: Engine, at: number, len: number, from: number, to: number, level: number): void {
	if (level <= 0.001 || len <= 0.01) return;
	const src = e.ctx.createBufferSource();
	src.buffer = e.noise;
	src.loop = true;
	const filter = e.ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.Q.value = 6;
	filter.frequency.setValueAtTime(from, at);
	filter.frequency.exponentialRampToValueAtTime(to, at + len);
	const gain = e.ctx.createGain();
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(level, at + len);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.35);
	src.connect(filter).connect(gain).connect(e.bus);
	src.start(at);
	src.stop(at + len + 0.4);
}

function semisOf(hz: number): number {
	return 12 * Math.log2(hz / soundTuning.root);
}

// Искра летит между двумя нотами связи, и все варианты, кроме шума, звучат
// октавой и выше над ними: в диапазоне самих нот искра читается третьим
// голосом, а не полётом.
function spark(e: Engine, at: number, len: number, from: number, to: number, level: number): void {
	if (level <= 0.001 || len <= 0.01) return;
	const kind = soundTuning.spark;
	if (kind === 'off') return;
	if (kind === 'noise') return swoosh(e, at, len, 700, 4200, level);
	if (kind === 'shimmer') return shimmer(e, at, len, level);
	if (kind === 'glide') return glide(e, at, len, from * 2, to * 2, level);
	if (kind === 'run') return run(e, at, len, from, level);
	return dust(e, at, len, to, level);
}

// Узкий резонанс высоко: тот же шум, но «тс-с» вместо «ш-ш».
function shimmer(e: Engine, at: number, len: number, level: number): void {
	const src = e.ctx.createBufferSource();
	src.buffer = e.noise;
	src.loop = true;
	const band = e.ctx.createBiquadFilter();
	band.type = 'bandpass';
	band.Q.value = 18;
	band.frequency.setValueAtTime(2500, at);
	band.frequency.exponentialRampToValueAtTime(9000, at + len);
	const gain = e.ctx.createGain();
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(level * 0.9, at + len * 0.7);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.25);
	src.connect(band).connect(gain).connect(e.bus);
	src.start(at);
	src.stop(at + len + 0.3);
}

function glide(e: Engine, at: number, len: number, from: number, to: number, level: number): void {
	const osc = e.ctx.createOscillator();
	osc.frequency.setValueAtTime(from, at);
	osc.frequency.exponentialRampToValueAtTime(to, at + len);
	const gain = e.ctx.createGain();
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(level * 0.45, at + len * 0.4);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.2);
	osc.connect(gain).connect(e.bus);
	osc.start(at);
	osc.stop(at + len + 0.25);
}

// Россыпь коротких писков: высота гуляет по ступеням лада двумя октавами выше,
// поэтому рассыпается, но не мимо.
function dust(e: Engine, at: number, len: number, to: number, level: number): void {
	const COUNT = 14;
	const steps = scaleSteps();
	// Октавная точка, а не ступень: к ступени ступень не прибавишь — уедет мимо лада.
	const base = 12 * Math.round(semisOf(to) / 12) + 24;
	for (let i = 0; i < COUNT; i += 1) {
		const when = at + len * (i / COUNT) + Math.random() * (len / COUNT);
		const step = steps[Math.floor(Math.random() * steps.length)];
		const octave = 12 * Math.floor(Math.random() * 2);
		const osc = e.ctx.createOscillator();
		osc.frequency.value = freq(base + step + octave);
		const gain = e.ctx.createGain();
		gain.gain.setValueAtTime(0.0001, when);
		gain.gain.linearRampToValueAtTime((level * 1.2) / Math.sqrt(COUNT), when + 0.004);
		gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
		osc.connect(gain).connect(e.bus);
		osc.start(when);
		osc.stop(when + 0.15);
	}
}

// Пробежка вверх по ступеням лада от своей ноты: связь слышна как путь.
function run(e: Engine, at: number, len: number, from: number, level: number): void {
	const COUNT = 5;
	let semis = snap(semisOf(from)) + 12;
	for (let i = 0; i < COUNT; i += 1) {
		const when = at + (len * i) / COUNT;
		const osc = e.ctx.createOscillator();
		osc.type = 'triangle';
		osc.frequency.value = freq(semis);
		const gain = e.ctx.createGain();
		gain.gain.setValueAtTime(0.0001, when);
		gain.gain.linearRampToValueAtTime((level * 0.9) / Math.sqrt(COUNT), when + 0.005);
		gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
		osc.connect(gain).connect(e.bus);
		osc.start(when);
		osc.stop(when + 0.25);
		semis = nextStep(semis);
	}
}

function sub(e: Engine, at: number, level: number): void {
	if (level <= 0.001) return;
	const osc = e.ctx.createOscillator();
	osc.frequency.setValueAtTime(70, at);
	osc.frequency.exponentialRampToValueAtTime(38, at + 0.5);
	const gain = e.ctx.createGain();
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.linearRampToValueAtTime(level, at + 0.012);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.8);
	// Мимо реверба: низ в хвосте превращается в гул.
	osc.connect(gain).connect(e.master);
	osc.start(at);
	osc.stop(at + 0.9);
}

// Аккорд рождения звучит не выбранным тембром, а чистыми синусами: вспышке
// нужен ровный свет, а обертоны колокола или струны читаются как удар.
function chord(e: Engine, at: number, semis: number, level: number, tail: number): void {
	if (level <= 0.001) return;
	const OFFSETS = [0, 7, 12, 19];
	OFFSETS.forEach((offset, i) => {
		const osc = e.ctx.createOscillator();
		// Расстройка в несколько центов: в унисон четыре синуса дают один
		// плоский тон, вразнобой — ширину.
		osc.frequency.value = freq(snap(semis + offset)) * Math.pow(2, ((i - 1.5) * 4) / 1200);
		const gain = e.ctx.createGain();
		gain.gain.setValueAtTime(0.0001, at);
		gain.gain.linearRampToValueAtTime(level / OFFSETS.length, at + 0.25);
		gain.gain.exponentialRampToValueAtTime(0.0001, at + tail);
		osc.connect(gain).connect(e.bus);
		osc.start(at);
		osc.stop(at + tail + 0.1);
	});
}

export function playClick(degree: number): void {
	const e = ready();
	if (!e) return;
	pluck(e, starNote(degree), e.ctx.currentTime, soundTuning.clickLevel, soundTuning.clickDecay);
}

export function playBirth(degree = 0): void {
	const e = ready();
	if (!e) return;
	const T = soundTuning;
	// Вспышка звучит там же, где видна: время берётся из настроек анимации.
	const flash = e.ctx.currentTime + (birthTuning.gather * birthTuning.duration) / 1000;
	// Разгон длиннее самой анимации начинался бы в прошлом, и его срезало бы.
	const sweep = Math.min(T.birthSweep, flash - e.ctx.currentTime);
	swoosh(e, flash - sweep, sweep, T.birthFrom, T.birthTo, T.birthSwoosh);
	sub(e, flash, T.birthSub);
	chord(e, flash + 0.04, Math.max(0, semisFor(degree) - T.birthDrop), T.birthChord, T.birthTail);
}

export function playLink(mine: number, theirs: number): void {
	const e = ready();
	if (!e) return;
	const T = soundTuning;
	const at = e.ctx.currentTime;
	const [ours, answer] = linkNotes(mine, theirs);
	pluck(e, ours, at, T.linkLevel, T.linkDecay);
	spark(e, at + 0.06, Math.max(0.05, T.linkGap - 0.1), ours, answer, T.linkSpark);
	pluck(e, answer, at + T.linkGap, T.linkLevel, T.linkDecay);
}
