import { Router } from 'express';
import { authRouter } from './auth.js';
import { meRouter } from './me.js';
import { graphRouter } from './graph.js';
import { invitesRouter } from './invites.js';
import { linksRouter } from './links.js';
import { suggestionsRouter } from './suggestions.js';
import { adminRouter } from './admin.js';
import { mutationRateLimit } from '../lib/rateLimit.js';

export function apiRouter(): Router {
	const router = Router();

	router.get('/health', (_req, res) => {
		res.json({ ok: true });
	});

	router.use(mutationRateLimit());

	router.use('/auth', authRouter());
	router.use('/me', meRouter());
	router.use('/graph', graphRouter());
	router.use('/invites', invitesRouter());
	router.use('/links', linksRouter());
	router.use('/suggestions', suggestionsRouter());
	router.use('/admin', adminRouter());

	return router;
}
