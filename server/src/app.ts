// Сборка express-приложения. Отдельно от точки входа: так его можно поднять
// в тестах, не запуская фоновые процессы и не занимая боевой порт.
import express from 'express';
import helmet from 'helmet';
import { BASE_PATH } from '../../shared/config.js';
import { log } from './lib/log.js';
import { HttpError } from './lib/errors.js';
import { buildRouter } from './routes/index.js';

export function createApp(): express.Express {
	const app = express();

	// За nginx: доверяем X-Forwarded-* первого прокси, иначе req.ip и req.protocol врут.
	app.set('trust proxy', 1);
	app.disable('x-powered-by');

	app.use(
		helmet({
			// Mini App открывается внутри iframe Telegram, поэтому X-Frame-Options
			// выключен намеренно: за рамки отвечает frame-ancestors в CSP.
			frameguard: false,
			crossOriginEmbedderPolicy: false,
			crossOriginResourcePolicy: { policy: 'cross-origin' },
			contentSecurityPolicy: {
				useDefaults: false,
				directives: {
					defaultSrc: ["'self'"],
					baseUri: ["'self'"],
					objectSrc: ["'none'"],
					// telegram-web-app.js подключается со стороны Telegram.
					scriptSrc: ["'self'", 'https://telegram.org'],
					styleSrc: ["'self'", "'unsafe-inline'"],
					imgSrc: ["'self'", 'data:', 'blob:'],
					connectSrc: ["'self'"],
					fontSrc: ["'self'", 'data:'],
					frameAncestors: ['https://web.telegram.org', 'https://*.telegram.org'],
					formAction: ["'self'"],
				},
			},
		}),
	);

	// Тела запросов маленькие: самое крупное — initData и апдейт бота.
	app.use(express.json({ limit: '256kb' }));

	app.use(BASE_PATH, buildRouter());

	// Всё, что выше префикса, нам не принадлежит: соседние приложения домена
	// живут на своих путях, и отвечать за них мы не должны.
	app.use((_req, res) => {
		res.status(404).json({ error: { code: 'not_found', message: 'Не найдено' } });
	});

	// Единый обработчик ошибок: HttpError (включая BadRequest) превращается
	// в свой статус, всё остальное — в 500 с записью в лог.
	app.use(
		(
			err: unknown,
			_req: express.Request,
			res: express.Response,
			_next: express.NextFunction,
		): void => {
			if (err instanceof HttpError) {
				res.status(err.status).json({
					error: {
						code: err.code,
						message: err.message,
						...(err.field ? { field: err.field } : {}),
					},
				});
				return;
			}
			log.error({ err }, 'необработанная ошибка запроса');
			res.status(500).json({ error: { code: 'internal', message: 'Внутренняя ошибка' } });
		},
	);

	return app;
}
