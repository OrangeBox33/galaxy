// Панель песочницы раскладки: в сборку не попадает (её тянет layoutSandbox.ts).

export type Bag = Record<string, number | boolean>;

export type Control =
	| { kind: 'range'; key: string; label: string; min: number; max: number; step: number }
	| { kind: 'toggle'; key: string; label: string }
	| { kind: 'button'; label: string; run: () => void };

export type Section = { title: string; bag: Bag; controls: Control[] };

export type PanelOptions = {
	sections: Section[];
	// Что вернуть в буфер по кнопке «Скопировать».
	snapshot: () => unknown;
	onChange: () => void;
	storageKey: string;
};

export type Panel = {
	// Строка замеров под заголовком: сколько звёзд, связей, миллисекунд.
	setStatus: (text: string) => void;
	// Ползунки могли поменяться не из панели (сброс, адресная строка).
	refresh: () => void;
};

export function createLayoutPanel(options: PanelOptions): Panel {
	restore(options);

	const style = document.createElement('style');
	style.textContent = CSS;
	document.head.append(style);

	const panel = document.createElement('div');
	panel.className = 'lay';

	const head = document.createElement('div');
	head.className = 'lay__head';

	const toggle = document.createElement('button');
	toggle.textContent = 'Свернуть';
	toggle.onclick = () => {
		panel.classList.toggle('hidden');
		toggle.textContent = panel.classList.contains('hidden') ? 'Раскладка' : 'Свернуть';
	};
	head.append(toggle);

	const status = document.createElement('div');
	status.className = 'lay__status';
	status.textContent = '…';
	head.append(status);
	panel.append(head);

	const body = document.createElement('div');
	body.className = 'lay__body';
	panel.append(body);

	const refreshers: (() => void)[] = [];

	for (const section of options.sections) {
		const box = document.createElement('div');
		const heading = document.createElement('h2');
		heading.textContent = section.title;
		box.append(heading);
		for (const control of section.controls) {
			const [element, refresh] = row(control, section.bag, () => {
				save(options);
				options.onChange();
			});
			box.append(element);
			if (refresh) refreshers.push(refresh);
		}
		body.append(box);
	}

	const out = document.createElement('textarea');
	out.className = 'lay__out';
	out.readOnly = true;

	const buttons = document.createElement('div');
	buttons.className = 'lay__buttons';

	const copy = document.createElement('button');
	copy.textContent = 'Скопировать';
	copy.onclick = () => {
		const text = JSON.stringify(options.snapshot(), null, '\t');
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
		localStorage.removeItem(options.storageKey);
		location.reload();
	};

	buttons.append(copy, reset);
	body.append(buttons, out);
	document.body.append(panel);

	return {
		setStatus: (text) => (status.textContent = text),
		refresh: () => refreshers.forEach((fn) => fn()),
	};
}

function row(control: Control, bag: Bag, changed: () => void): [HTMLElement, (() => void) | null] {
	if (control.kind === 'button') {
		const line = document.createElement('div');
		line.className = 'lay__row act';
		const button = document.createElement('button');
		button.textContent = control.label;
		button.onclick = control.run;
		line.append(button);
		return [line, null];
	}

	if (control.kind === 'toggle') {
		const line = document.createElement('div');
		line.className = 'lay__row flag';
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.checked = bag[control.key] === true;
		const label = document.createElement('label');
		label.textContent = control.label;
		label.onclick = () => input.click();
		input.onchange = () => {
			bag[control.key] = input.checked;
			changed();
		};
		line.append(input, label);
		return [line, () => (input.checked = bag[control.key] === true)];
	}

	const line = document.createElement('div');
	line.className = 'lay__row';

	const label = document.createElement('label');
	label.textContent = control.label;

	const value = document.createElement('span');
	value.className = 'value';

	const input = document.createElement('input');
	input.type = 'range';
	input.min = String(control.min);
	input.max = String(control.max);
	input.step = String(control.step);

	const show = (): void => {
		const current = Number(bag[control.key]);
		input.value = String(current);
		value.textContent = String(current);
	};
	show();

	input.oninput = () => {
		bag[control.key] = Number(input.value);
		value.textContent = input.value;
		changed();
	};

	line.append(label, value, input);
	return [line, show];
}

let saveTimer = 0;
function save(options: PanelOptions): void {
	window.clearTimeout(saveTimer);
	saveTimer = window.setTimeout(() => {
		const dump: Record<string, Bag> = {};
		for (const section of options.sections) dump[section.title] = { ...section.bag };
		localStorage.setItem(options.storageKey, JSON.stringify(dump));
	}, 200);
}

function restore(options: PanelOptions): void {
	const raw = localStorage.getItem(options.storageKey);
	if (!raw) return;
	try {
		const dump = JSON.parse(raw) as Record<string, Bag>;
		for (const section of options.sections) {
			const saved = dump[section.title];
			if (!saved) continue;
			for (const [key, value] of Object.entries(saved)) {
				if (key in section.bag) section.bag[key] = value;
			}
		}
	} catch {
		localStorage.removeItem(options.storageKey);
	}
}

const CSS = `
	.lay { position: fixed; top: 0; right: 0; bottom: 0; width: 340px; overflow-y: auto;
		background: rgba(8, 11, 22, 0.94); color: #dbe4f7; font: 12px/1.35 -apple-system, sans-serif;
		padding: 10px 12px 40px; box-shadow: -1px 0 0 rgba(255,255,255,0.08); z-index: 10; }
	.lay.hidden { width: auto; bottom: auto; overflow: visible; padding: 8px 10px; }
	.lay.hidden .lay__body { display: none; }
	.lay__head button { width: 100%; }
	.lay__status { margin: 6px 0 2px; color: #7fe0c0; font-variant-numeric: tabular-nums; }
	.lay h2 { font-size: 12px; margin: 14px 0 6px; color: #8fa3c8; text-transform: uppercase;
		letter-spacing: 0.08em; }
	.lay__row { display: grid; grid-template-columns: 1fr 52px; gap: 6px; align-items: center;
		margin: 3px 0; }
	.lay__row label { color: #b6c4e0; }
	.lay__row input[type=range] { grid-column: 1 / -1; width: 100%; margin: 0; }
	.lay__row .value { text-align: right; color: #7fe0c0; font-variant-numeric: tabular-nums; }
	.lay__row.flag { grid-template-columns: 18px 1fr; }
	.lay__row.flag label { cursor: pointer; }
	.lay__row.act { grid-template-columns: 1fr; margin: 6px 0; }
	.lay__buttons { display: flex; gap: 6px; margin: 16px 0 0; padding: 8px 0; }
	.lay button { flex: 1; padding: 6px 8px; border-radius: 6px; border: 1px solid #2a3652;
		background: #141c30; color: #dbe4f7; cursor: pointer; font: inherit; }
	.lay button:hover { background: #1c2540; }
	.lay__out { width: 100%; height: 130px; margin-top: 8px; background: #0b111f; color: #9fb3d8;
		border: 1px solid #22304c; border-radius: 6px; font: 11px/1.3 monospace; display: none; }
	.lay__legend { position: fixed; left: 12px; bottom: 12px; z-index: 10; display: grid; gap: 3px;
		font: 12px/1.3 -apple-system, sans-serif; color: #b6c4e0; pointer-events: none; }
	.lay__legend span { display: flex; align-items: center; gap: 6px; }
	.lay__legend i { width: 10px; height: 10px; border-radius: 50%; display: block; }
`;
