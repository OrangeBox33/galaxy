// Отладочная панель ползунков: в сборку не попадает (её тянет sandbox.ts).
import { tuning } from './canvas/renderer';

type Field = { key: string; label: string; min: number; max: number; step: number };

const range = (key: string, label: string, min: number, max: number, step: number): Field => ({
	key,
	label,
	min,
	max,
	step,
});

const FLAME_FIELDS: Field[] = [
	range('tongues', 'сколько языков (множитель)', 0.55, 1, 0.05),
	range('from', 'начало от центра', 0, 2, 0.01),
	range('length', 'длина', 0.01, 8, 0.01),
	range('width', 'ширина', 0.02, 2, 0.01),
	range('taper', 'пузатость', 0, 1, 0.01),
	range('sweep', 'подворот', -1.2, 1.2, 0.01),
	range('bow', 'где изгиб', 0, 1, 0.01),
	range('alpha', 'яркость', 0, 1, 0.01),
	range('plateau', 'докуда держит яркость', 0.02, 0.98, 0.01),
	range('flicker', 'мерцание длины', 0, 1, 0.01),
	range('flickerSpeed', 'секунд на мерцание', 0.2, 12, 0.1),
	range('spin', 'секунд на оборот (0 — стоит)', 0, 300, 1),
	range('soft', 'свечение от языков', 0, 1, 0.01),
	range('softWidth', 'во сколько раз оно шире', 1, 4, 0.05),
	range('softShift', 'сдвинуть свечение к центру', 0, 1.5, 0.01),
	range('softFrom', 'начало свечения (0 — как у языков)', 0, 1.5, 0.01),
];

const CORE_FIELDS: Field[] = [
	range('coreSize', 'размер диска', 0.1, 1.5, 0.01),
	range('coreTint', 'цвет в середине', 0, 1, 0.01),
	range('coreSharp', 'резкость перехода', 0, 0.99, 0.01),
	range('coreRim', 'где начинается кромка', 0.3, 1, 0.01),
	range('coreGlow', 'ореол за краем', 0, 1, 0.01),
	range('coreGlowAlpha', 'его яркость', 0, 1, 0.01),
	range('corePulse', 'сила дыхания: на сколько меняется', 0, 0.8, 0.01),
	range('corePulsePeriod', 'секунд на вдох-выдох', 0.2, 12, 0.1),
];

const SKY_FIELDS: Field[] = [range('dustAlpha', 'пыль (выше 1 — гуще)', 0, 4, 0.05)];

const STORAGE_KEY = 'galaxy:sandbox-tuning-2';

type Bag = Record<string, unknown>;

export function createPanel(): void {
	restore();

	const style = document.createElement('style');
	style.textContent = `
		.tune { position: fixed; top: 0; right: 0; bottom: 0; width: 330px; overflow-y: auto;
			background: rgba(8, 11, 22, 0.94); color: #dbe4f7; font: 12px/1.35 -apple-system, sans-serif;
			padding: 10px 12px 40px; box-shadow: -1px 0 0 rgba(255,255,255,0.08); z-index: 10; }
		.tune.hidden { width: auto; bottom: auto; overflow: visible; padding: 8px 10px; }
		.tune.hidden .tune__body { display: none; }
		.tune h2 { font-size: 12px; margin: 14px 0 6px; color: #8fa3c8; text-transform: uppercase;
			letter-spacing: 0.08em; }
		.tune__row { display: grid; grid-template-columns: 1fr 48px; gap: 6px; align-items: center;
			margin: 3px 0; }
		.tune__row label { color: #b6c4e0; }
		.tune__row input[type=range] { grid-column: 1 / -1; width: 100%; margin: 0; }
		.tune__row .value { text-align: right; color: #7fe0c0; font-variant-numeric: tabular-nums; }
		.tune__row input[type=color] { width: 100%; height: 22px; padding: 0; border: 0; background: none; }
		.tune__row.flag { grid-template-columns: 18px 1fr; }
		.tune__buttons { display: flex; gap: 6px; margin-top: 12px; position: sticky; bottom: 0;
			background: rgba(8, 11, 22, 0.94); padding: 8px 0; }
		.tune button { flex: 1; padding: 6px 8px; border-radius: 6px; border: 1px solid #2a3652;
			background: #141c30; color: #dbe4f7; cursor: pointer; font: inherit; }
		.tune button:hover { background: #1c2540; }
		.tune__out { width: 100%; height: 120px; margin-top: 8px; background: #0b111f; color: #9fb3d8;
			border: 1px solid #22304c; border-radius: 6px; font: 11px/1.3 monospace; display: none; }
	`;
	document.head.append(style);

	const panel = document.createElement('div');
	panel.className = 'tune';

	const toggle = document.createElement('button');
	toggle.textContent = 'Свернуть';
	toggle.style.width = '100%';
	toggle.onclick = () => {
		panel.classList.toggle('hidden');
		toggle.textContent = panel.classList.contains('hidden') ? 'Настройки' : 'Свернуть';
	};
	panel.append(toggle);

	const body = document.createElement('div');
	body.className = 'tune__body';
	panel.append(body);

	body.append(section('Языки пламени', FLAME_FIELDS, tuning.flame as unknown as Bag));
	body.append(section('Ядро', CORE_FIELDS, tuning as unknown as Bag));
	body.append(section('Небо', SKY_FIELDS, tuning as unknown as Bag));

	const out = document.createElement('textarea');
	out.className = 'tune__out';
	out.readOnly = true;

	const buttons = document.createElement('div');
	buttons.className = 'tune__buttons';

	const copy = document.createElement('button');
	copy.textContent = 'Скопировать';
	copy.onclick = () => {
		const text = JSON.stringify(snapshot(), null, '\t');
		out.style.display = 'block';
		out.value = text;
		out.select();
		navigator.clipboard?.writeText(text).then(
			() => (copy.textContent = 'Скопировано'),
			() => (copy.textContent = 'Выдели и скопируй'),
		);
		setTimeout(() => (copy.textContent = 'Скопировать'), 2000);
	};

	const reset = document.createElement('button');
	reset.textContent = 'Сброс';
	reset.onclick = () => {
		localStorage.removeItem(STORAGE_KEY);
		location.reload();
	};

	buttons.append(copy, reset);
	body.append(buttons, out);
	document.body.append(panel);
}

function section(title: string, fields: Field[], bag: Bag): HTMLElement {
	const box = document.createElement('div');
	const heading = document.createElement('h2');
	heading.textContent = title;
	box.append(heading);
	for (const field of fields) box.append(row(field, bag));
	return box;
}

function row(field: Field, bag: Bag): HTMLElement {
	const line = document.createElement('div');
	line.className = 'tune__row';

	const label = document.createElement('label');
	label.textContent = field.label;

	const value = document.createElement('span');
	value.className = 'value';
	value.textContent = String(bag[field.key]);

	const input = document.createElement('input');
	input.type = 'range';
	input.min = String(field.min);
	input.max = String(field.max);
	input.step = String(field.step);
	input.value = String(bag[field.key]);
	input.oninput = () => {
		const next = Number(input.value);
		bag[field.key] = next;
		value.textContent = String(next);
		save();
	};

	line.append(label, value, input);
	return line;
}

function snapshot(): Bag {
	const { flame, ...rest } = tuning;
	return { flame: { ...flame }, ...rest };
}

let saveTimer = 0;
function save(): void {
	window.clearTimeout(saveTimer);
	saveTimer = window.setTimeout(() => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
	}, 200);
}

function restore(): void {
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return;
	try {
		const saved = JSON.parse(raw) as Bag;
		const bag = tuning as unknown as Bag;
		for (const [key, value] of Object.entries(saved)) {
			if (key === 'flame') continue;
			if (key in bag) bag[key] = value;
		}
		const flame = saved.flame as Bag | undefined;
		if (flame) {
			const target = tuning.flame as unknown as Bag;
			for (const [key, value] of Object.entries(flame)) {
				if (key in target) target[key] = value;
			}
		}
	} catch {
		localStorage.removeItem(STORAGE_KEY);
	}
}
