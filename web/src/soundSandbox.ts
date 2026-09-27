// Отладочная страница /galaxy/sound.html: в сборку не попадает.
// Тот же синтез, что на бою, только без неба: слышно каждый звук по отдельности
// и видно, какой нотой звучит звезда с таким числом связей.
import { createLayoutPanel, type Bag, type Control, type Section } from './layoutPanel';
import {
	linkNotes,
	playBirth,
	playClick,
	playLink,
	SCALE_OPTIONS,
	soundTuning,
	SPARK_OPTIONS,
	starNote,
	VOICE_OPTIONS,
} from './sound';

const view: Bag = { mine: 12, theirs: 3 };

const bag = soundTuning as unknown as Bag;

const range = (key: string, label: string, min: number, max: number, step: number): Control => ({
	kind: 'range',
	key,
	label,
	min,
	max,
	step,
});

const mine = (): number => Math.round(view.mine as number);
const theirs = (): number => Math.round(view.theirs as number);

function click(): void {
	playClick(mine());
	status('клик');
}

function birth(): void {
	playBirth(mine());
	status('рождение');
}

function link(): void {
	playLink(mine(), theirs());
	status('связь');
}

const sections: Section[] = [
	{
		// Лад и тембр живут в soundTuning, а не в view: панель сохраняет
		// только bag своей секции, иначе выбор не пережил бы перезагрузку.
		title: 'Лад и тембр',
		bag,
		controls: [
			{
				kind: 'choice',
				label: 'лад',
				options: SCALE_OPTIONS,
				get: () => soundTuning.scale,
				set: (value) => (soundTuning.scale = value as typeof soundTuning.scale),
			},
			{
				kind: 'choice',
				label: 'тембр',
				options: VOICE_OPTIONS,
				get: () => soundTuning.voice,
				set: (value) => (soundTuning.voice = value as typeof soundTuning.voice),
			},
		],
	},
	{
		title: 'Что слушаем',
		bag: view,
		controls: [
			range('mine', 'связей у моей звезды', 0, 150, 1),
			range('theirs', 'связей у звезды друга', 0, 150, 1),
		],
	},
	{
		title: 'Общее',
		bag,
		controls: [
			range('volume', 'громкость', 0, 1, 0.01),
			range('wet', 'сколько реверба', 0, 1, 0.01),
			range('reverb', 'секунд хвоста', 0.2, 6, 0.1),
			range('root', 'нота самой крупной звезды, Гц', 80, 500, 1),
			range('span', 'полутонов до одиночки', 0, 48, 1),
		],
	},
	{
		title: 'Клик',
		bag,
		controls: [
			range('clickLevel', 'громкость', 0, 1, 0.01),
			range('clickDecay', 'секунд звона', 0.05, 4, 0.05),
			range('clickPartials', 'громкость обертонов', 0, 1, 0.01),
			range('clickTick', 'щелчок атаки', 0, 1, 0.01),
			range('clickTone', 'срез, Гц', 400, 8000, 50),
		],
	},
	{
		title: 'Рождение',
		bag,
		controls: [
			range('birthSweep', 'секунд разгона', 0.2, 4, 0.05),
			range('birthFrom', 'срез в начале, Гц', 60, 2000, 10),
			range('birthTo', 'срез у вспышки, Гц', 1000, 16000, 100),
			range('birthSwoosh', 'громкость разгона', 0, 1, 0.01),
			range('birthSub', 'удар в момент вспышки', 0, 1, 0.01),
			range('birthChord', 'громкость аккорда', 0, 1, 0.01),
			range('birthTail', 'секунд на аккорд', 0.5, 8, 0.1),
			range('birthDrop', 'аккорд ниже на полутонов', 0, 24, 1),
		],
	},
	{
		title: 'Связь',
		bag,
		controls: [
			{
				kind: 'choice',
				label: 'искра',
				options: SPARK_OPTIONS,
				get: () => soundTuning.spark,
				set: (value) => (soundTuning.spark = value as typeof soundTuning.spark),
			},
			range('linkLevel', 'громкость', 0, 1, 0.01),
			range('linkGap', 'секунд летит искра', 0.05, 1.5, 0.01),
			range('linkLift', 'ответная нота выше на полутонов', 0, 12, 1),
			range('linkSpark', 'громкость искры', 0, 1, 0.01),
			range('linkDecay', 'секунд звона', 0.05, 4, 0.05),
		],
	},
];

const panel = createLayoutPanel({
	sections,
	snapshot: () => ({ ...soundTuning }),
	onChange: () => status(),
	// -2: прошлый набор мерил высоту ступенями лада, а не полутонами.
	storageKey: 'galaxy:sound-sandbox-2',
});

function status(what = 'готов'): void {
	const hz = (value: number): string => String(Math.round(value));
	const [ours, answer] = linkNotes(mine(), theirs());
	panel.setStatus(
		`${what} · клик ${hz(starNote(mine()))} · связь ${hz(ours)} → ${hz(answer)} Гц`,
	);
}

const pads: [string, () => void, string][] = [
	['play-click', click, '1'],
	['play-birth', birth, '2'],
	['play-link', link, '3'],
];

for (const [id, run] of pads) {
	document.getElementById(id)?.addEventListener('click', run);
}

window.addEventListener('keydown', (event) => {
	const pad = pads.find(([, , key]) => key === event.key);
	pad?.[1]();
});

status();
