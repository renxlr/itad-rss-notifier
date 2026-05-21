require('dotenv').config();

const fs = require('fs');
const Parser = require('rss-parser');
const parser = new Parser();

const RSS_URL = process.env.RSS_URL;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!RSS_URL || !WEBHOOK_URL) {
    console.error('Faltam variáveis RSS_URL ou WEBHOOK_URL no .env');
    process.exit(1);
}

let fetchFn = global.fetch;
if (!fetchFn) {
    fetchFn = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
}

let seen = new Set();
if (fs.existsSync('seen.json')) {
    try {
        const data = JSON.parse(fs.readFileSync('seen.json'));
        seen = new Set(data);
    } catch (e) {
        console.warn('seen.json corrompido, começando do zero.');
        fs.unlinkSync('seen.json');
    }
}

let firstRun = true;

async function checkFeed() {
    try {
        console.log("Checando feed...");

        const feed = await parser.parseURL(RSS_URL);
        console.log("Itens encontrados:", feed.items.length);

        let hasNew = false;

        for (const item of feed.items) {
            if (firstRun) {
                seen.add(item.link);
                continue;
            }

            if (!seen.has(item.link)) {
                hasNew = true;
                seen.add(item.link);

                if (seen.size > 100) {
                    seen = new Set([...seen].slice(-50));
                }

                const res = await fetchFn(WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content:
                            `**Promoção na waitlist**\n` +
                            `${item.title}\n` +
                            `${item.link}`,
                    }),
                });

                if (!res.ok) {
                    console.error('Webhook falhou:', res.status, await res.text());
                } else {
                    console.log('Enviado:', item.title);
                }

                await new Promise(r => setTimeout(r, 1000));
            }
        }

        if (firstRun || hasNew) {
            fs.writeFileSync('seen.json', JSON.stringify([...seen]));
        }

        firstRun = false;

    } catch (err) {
        console.error('Erro:', err);
    }
}

checkFeed();
setInterval(checkFeed, 1000 * 60 * 10);
console.log('bot rodando...');