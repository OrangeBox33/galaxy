// Разовая настройка Telegram. Запускается локально с прод-значениями:
//   npm run setup:bot
import { env } from '../env.js';
import { getWebhookInfo, setWebhook } from './api.js';

async function main(): Promise<void> {
	const url = `${env.publicBaseUrl}/tg/webhook/${env.webhookSecret}`;
	await setWebhook(url);
	console.log(`Вебхук установлен: ${env.publicBaseUrl}/tg/webhook/***`);

	console.log('\nОсталось сделать в BotFather:');
	console.log('  /mybots → выбрать бота → Bot Settings → Configure Mini App → Enable');
	console.log(`  URL приложения: ${env.publicBaseUrl}`);
	console.log('  Без этого ссылки-приглашения вида t.me/<бот>?start=<токен> не сработают.\n');

	const info = (await getWebhookInfo()) as {
		url?: string;
		pending_update_count?: number;
		last_error_message?: string;
	};
	console.log('Что видит Telegram:');
	console.log(`  адрес задан: ${info.url ? 'да' : 'нет'}`);
	console.log(`  необработанных апдейтов: ${info.pending_update_count ?? 0}`);
	if (info.last_error_message) console.log(`  последняя ошибка: ${info.last_error_message}`);
}

main().catch((err: Error) => {
	console.error(`Не удалось настроить бота: ${err.message}`);
	process.exit(1);
});
