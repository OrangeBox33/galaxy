// Фото профиля во весь экран, только по нажатию на аватарку. Первое просим сразу,
// не дожидаясь числа фото, остальные — все разом, когда оно загрузилось: так первое
// не делит канал с остальными, а листать потом мгновенно. Живёт в body: backdrop-filter карточки
// делает её рамкой для position: fixed, и галерея сжалась бы до карточки.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { photos } from '../api/endpoints';
import { assetUrl } from '../api/client';

// Сдвиг пальцем, после которого листаем, — доля ширины экрана.
const SWIPE = 0.18;

type Props = { userId: string; avatar: string | null; onClose: () => void };

export function Gallery({ userId, avatar, onClose }: Props) {
	const [count, setCount] = useState<number | null>(null);
	const [index, setIndex] = useState(0);
	const [drag, setDrag] = useState(0);
	const [loaded, setLoaded] = useState<Set<number>>(() => new Set());
	const [firstDone, setFirstDone] = useState(false);
	const start = useRef<{ x: number; y: number } | null>(null);

	useEffect(() => {
		let alive = true;
		photos
			.count(userId)
			.then(({ count }) => alive && setCount(count))
			.catch(() => alive && setCount(0));
		return () => {
			alive = false;
		};
	}, [userId]);

	const total = count ?? 0;
	const go = (step: number) =>
		setIndex((current) => Math.max(0, Math.min(total - 1, current + step)));

	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (event.key === 'Escape') onClose();
			if (event.key === 'ArrowLeft') go(-1);
			if (event.key === 'ArrowRight') go(1);
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	function onPointerUp(event: React.PointerEvent) {
		const from = start.current;
		start.current = null;
		setDrag(0);
		if (!from) return;
		const dx = event.clientX - from.x;
		const dy = event.clientY - from.y;
		const width = window.innerWidth;
		if (Math.abs(dx) > width * SWIPE && Math.abs(dx) > Math.abs(dy)) {
			go(dx < 0 ? 1 : -1);
		} else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
			// Не event.target: при захвате указателя он всегда сама галерея.
			const hit = document.elementFromPoint(event.clientX, event.clientY);
			if (hit?.closest('.gallery__frame')) go(event.clientX < width / 2 ? -1 : 1);
			else onClose();
		}
	}

	return createPortal(
		<div className="gallery" onClick={(event) => event.stopPropagation()}>
			<div
				className="gallery__viewport"
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId);
					start.current = { x: event.clientX, y: event.clientY };
				}}
				onPointerMove={(event) => {
					if (start.current) setDrag(event.clientX - start.current.x);
				}}
				onPointerUp={onPointerUp}
				onPointerCancel={() => {
					start.current = null;
					setDrag(0);
				}}
			>
				<div
					className={`gallery__track${drag !== 0 ? ' gallery__track--drag' : ''}`}
					style={{ transform: `translateX(calc(${-index * 100}% + ${drag}px))` }}
				>
					{Array.from({ length: Math.max(1, total) }, (_, i) => (
						<div className="gallery__slide" key={i}>
							{/* Фото профиля в Telegram квадратные, как и аватарка: растянутая
							    аватарка стоит ровно там, где проявится фото, и скачка нет. */}
							<div className="gallery__frame">
								{i === 0 && avatar && (
									<img
										src={assetUrl(`avatars/${avatar}`)}
										alt=""
										draggable={false}
									/>
								)}
								{(i === 0 ? count !== 0 : i < total && firstDone) && (
									<img
										className={
											loaded.has(i)
												? 'gallery__photo--loaded'
												: 'gallery__photo'
										}
										src={photos.url(userId, i)}
										alt=""
										draggable={false}
										onLoad={() => {
											setLoaded((current) => new Set(current).add(i));
											if (i === 0) setFirstDone(true);
										}}
										onError={() => i === 0 && setFirstDone(true)}
									/>
								)}
							</div>
						</div>
					))}
				</div>
			</div>
			{total > 1 && (
				<div className="gallery__dots">
					{Array.from({ length: total }, (_, i) => (
						<span key={i} className={i === index ? 'gallery__dot--on' : undefined} />
					))}
				</div>
			)}
			<button className="gallery__close" onClick={onClose} aria-label="Закрыть">
				×
			</button>
		</div>,
		document.body,
	);
}
