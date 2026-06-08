require('dotenv').config();

const fs = require('fs');
const Parser = require('rss-parser');
const { parse } = require('node-html-parser');
const parser = new Parser({
    customFields: {
        item: ['description'],
    },
});

const RSS_URL = process.env.RSS_URL;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!RSS_URL || !WEBHOOK_URL) {
    console.error('Faltam variáveis RSS_URL ou WEBHOOK_URL no .env');
    process.exit(1);
}

let fetchFn = global.fetch;
if (!fetchFn) {
    fetchFn = (...args) =>
        import('node-fetch').then(({ default: fetch }) => fetch(...args));
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

async function sendWebhook(payload) {
    let res = await fetchFn(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (res.status === 429) {
        const data = await res.json();
        const wait = (data.retry_after + 0.5) * 1000;
        console.warn(`Rate limit, aguardando ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        res = await fetchFn(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    }

    return res;
}

async function checkFeed() {
    try {
        console.log('Checando feed...');

        const feed = await parser.parseURL(RSS_URL);
        console.log('Itens encontrados:', feed.items.length);

        let hasNew = false;

        for (const item of feed.items) {
            if (!seen.has(item.link)) {
                hasNew = true;
                seen.add(item.link);

                if (seen.size > 100) {
                    seen = new Set([...seen].slice(-50));
                }

                if (!item.description) {
                    console.warn('Item sem description:', item.title);
                    continue;
                }

                const root = parse(item.description);
                const games = root.querySelectorAll(
                    'div[style="margin-bottom:30px"]',
                );

                const fields = games.map((game) => {
                    const name =
                        game.querySelector('a[href*="/game/"]')?.text?.trim() ??
                        'Desconhecido';
                    const price =
                        game
                            .querySelector('a[href*="itad.link"]')
                            ?.text?.trim() ?? '?';
                    const discount =
                        game
                            .querySelector('span[style*="text-align:right"]')
                            ?.text?.trim() ?? '?';
                    const storeSpan = game.querySelector(
                        'span[style*="0.8em"]',
                    );
                    const storeDiv = storeSpan?.parentNode;
                    const store =
                        storeDiv?.childNodes
                            .filter((n) => n.nodeType === 3)
                            .map((n) => n.text.trim())
                            .filter(Boolean)
                            .join('') ?? '?';
                    const link =
                        game
                            .querySelector('a[href*="/game/"]')
                            ?.getAttribute('href') ?? item.link;

                    return {
                        name: `[${name}](${link})`,
                        value: `${price} **(${discount})** na ${store}`,
                        inline: false,
                    };
                });

                const res = await sendWebhook({
                    embeds: [
                        {
                            title: 'Promoções na waitlist!',
                            color: 0x1b2838,
                            fields,
                            footer: { text: 'IsThereAnyDeal' },
                            timestamp: new Date().toISOString(),
                        },
                    ],
                });

                if (!res.ok) {
                    console.error(
                        'Webhook falhou:',
                        res.status,
                        await res.text(),
                    );
                } else {
                    console.log('Enviado:', item.title);
                }

                await new Promise((r) => setTimeout(r, 1000));
            }
        }

        if (hasNew) {
            fs.writeFileSync('seen.json', JSON.stringify([...seen]));
        }
    } catch (err) {
        console.error('Erro:', err);
    }
}

checkFeed();
setInterval(checkFeed, 1000 * 60 * 10);
console.log('bot rodando...');