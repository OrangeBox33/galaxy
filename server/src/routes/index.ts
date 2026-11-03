// Порядок важен: spaFallback стоит последним и ловит всё неразобранное.
import { Router } from 'express';
import { mountAssets, mountAvatars, spaFallback } from './static.js';
import { apiRouter } from './api.js';
import { botRouter } from './bot.js';
import { maxBotRouter } from './maxBot.js';
import { maxEnabled } from '../bot/max.js';

export function buildRouter(): Router {
	const router = Router();

	mountAssets(router);
	mountAvatars(router);
	router.use('/api', apiRouter());
	router.use('/tg', botRouter());
	if (maxEnabled) router.use('/max', maxBotRouter());
	router.use(spaFallback);

	return router;
}
