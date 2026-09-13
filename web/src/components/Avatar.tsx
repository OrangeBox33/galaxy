// Аватарка или кружок с первой буквой имени в цвете пола — Telegram отдаёт
// фото не всегда, и отсутствие аватарки не должно ломать экран (раздел 9).
import { assetUrl } from '../api/client';
import type { Gender } from '../../../shared/config';

const TINT: Record<Gender, string> = {
	MALE: '#6FA8FF',
	FEMALE: '#FF8FC0',
	UNSPECIFIED: '#C8D8FF',
};

type Props = { name: string; file: string | null; gender: Gender; size: number };

export function Avatar({ name, file, gender, size }: Props) {
	const style = { width: size, height: size, borderRadius: size / 2 };

	if (file) {
		return <img className="avatar" style={style} src={assetUrl(`avatars/${file}`)} alt="" />;
	}

	const letter = name.replace(/^@/, '').trim().charAt(0).toUpperCase() || '★';
	return (
		<div
			className="avatar avatar--letter"
			style={{ ...style, background: TINT[gender], fontSize: size * 0.42 }}
		>
			{letter}
		</div>
	);
}
