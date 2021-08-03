const config = require('./config.json');

const Database = require('easy-json-database');
const db = new Database('./db.json');
if (!db.has('subscriptions')) db.set('subscriptions', []);

const Discord = require('discord.js');
const client = new Discord.Client(ODcyMjQzNzYzMzcwNjY4MDky.YQnCTg.lGgkfQciNHs-igwwgPu1lHkonPc);

const vinted = require('vinted-api');

let lastFetchFinished = true;

const syncSubscription = (sub) => {
    return new Promise((resolve) => {
        const additionalOptions = {};
        if (sub.catalogID) additionalOptions['catalog_ids'] = sub.catalogID;
        vinted.search(sub.query || '', {
            order: 'newest_first',
            ...additionalOptions
        }).then((res) => {
            if (!res.items) {
                console.log('Search done bug got wrong response. Promise resolved.', res);
                resolve();
                return;
            }
            const lastItemSub = db.get(`last_item_${sub.id}`);
            const alreadySentItems = db.get(`sent_items_${sub.id}`);
            let items = res.items
                .map((item) => ({
                    ...item,
                    createdTimestamp: new Date(item.created_at_ts).getTime()
                }))
                .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
                .filter((item) => 
                    (sub.maxPrice ? parseInt(item.price_numeric) < sub.maxPrice : true)
                    && (sub.size ? item.size === sub.size : true)
                    && (sub.color ? item.color1 === sub.color : true)
                    && item.createdTimestamp > lastItemSub
                    && !alreadySentItems.includes(item.id)
                );
            if (items.length > 0) {
                db.set(`last_item_${sub.id}`, items[0].createdTimestamp);
                items.sort((a, b) => b.createdTimestamp - a.createdTimestamp).forEach((item) => {
                    db.push(`sent_items_${sub.id}`, item.id);
                    const embed = new Discord.MessageEmbed()
                        .setTitle(item.title)
                        .setURL(`https://www.vinted.fr/${item.path}`)
                        .setImage(item.photos[0]?.url)
                        .setColor('#008000')
                        .setTimestamp(item.createdTimestamp)
                        .setFooter('Date Publication')
                        .addField('Taille', item.size || 'vide', true)
                        .addField('Prix', item.price || 'vide', true)
                        .addField('Condition', item.status || 'vide', true);
                    client.channels.cache.get(sub.channelID)?.send(embed);
                });
            }
            console.log(`Search done (got ${res.items.length} items). Promise resolved.`);
            resolve();
        }).catch((e) => {
            console.error('Search returned an error. Promise resolved.', e);
            resolve();
        });
    });
};

const sync = () => {

    if (!lastFetchFinished) return;
    lastFetchFinished = false;

    console.log(`${new Date().toISOString()} | Sync is running...`);

    const subscriptions = db.get('subscriptions');

    const promises = subscriptions.map((sub) => syncSubscription(sub));
    Promise.all(promises).then(() => {
        lastFetchFinished = true;
    });

};

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);

    db.all().forEach((entry) => {
        if (entry.key.startsWith('last_item')) {
            const subID = entry.key.slice(10, entry.key.length);
            db.set(`last_item_${subID}`, Date.now());
        }
    })
    sync();
    setInterval(sync, 10000);
});

client.on('message', (message) => {


    if (message.author.bot) return;
    if (message.channel.type !== 'text') return;
    if (!config.adminIDs.includes(message.author.id)) return;

    if (message.content.startsWith('!liste-abonnements')) {

        const abonnements = db.get('subscriptions');
        const chunks = [];

        abonnements.forEach((abo) => {
            const content = `${abo.query || 'aucune recherche'} | ${abo.id} | <#${abo.channelID}>`;
            const lastChunk = chunks.shift() || [];
            if ((lastChunk.join('\n').length + content.length) > 1024) {
                if (lastChunk) chunks.push(lastChunk);
                chunks.push([ content ]);
            } else {
                lastChunk.push(content);
                chunks.push(lastChunk);
            }
        });

        message.reply('voilà la liste de vos abonnements.');

        chunks.forEach((chunk) => {
            const embed = new Discord.MessageEmbed()
            .setColor('RED')
            .setAuthor(`Tapez !suppr-abo pour supprimer un abonnement`)
            .setDescription(chunk.join('\n'));
        
            message.channel.send(embed);
        });

    }

    if (message.content.startsWith('!suppr-abo')) {

        const ID = message.content.slice(11, message.content.length);
        if (!ID) return message.reply('vous devez spécifier un ID d\'abonnement valide !');

        const abonnements = db.get('subscriptions')
        const newAbonnements = abonnements.filter((abo) => abo.id !== ID);
        db.set('subscriptions', newAbonnements);

        message.reply('tous les abonnements avec cet ID ont été supprimés !');

    }

    if (message.content.startsWith('!abonnement')) {

        const collector = new Discord.MessageCollector(message.channel, (m) => m.author.id === message.author.id);
        const subscription = {
            query: null,
            maxPrice: null,
            color: null,
            size: null,
            catalogID: null,
            channelID: null
        };
        const filled = [];

        message.reply('bonjour, envoyez maintenant le nom de l\'article dont vous souhaitez recevoir les alertes (ou "non").')

        collector.on('collect', (m) => {

            if (filled.includes('catalog') && !filled.includes('channelID')) {
                if (!m.mentions.channels.first()) {
                    m.reply(`veuillez mentionner un salon valide !`);
                } else {
                    subscription.channelID = m.mentions.channels.first().id;
                    filled.push('channelID');
                    m.reply(`tout est configuré ! Les notifications arriveront très bientôt :bell:`);
                    const subscriptionID = Math.random().toString(36).substring(7);
                    db.push(`subscriptions`, {
                        ...subscription,
                        id: subscriptionID
                    });
                    db.set(`last_item_${subscriptionID}`, Date.now());
                    db.set(`sent_items_${subscriptionID}`, []);
                }
            }

            if (filled.includes('size') && !filled.includes('catalog')) {
                const catalog = m.content === 'non' ? null : m.content;
                subscription.catalogID = catalog;
                filled.push('catalog')
                m.reply(`${!catalog ? 'aucun' : ''} catalogue enregistré ! Maintenant, mentionnez le salon dans lequels seront envoyés les résultats !`);
            }

            if (filled.includes('color') && !filled.includes('size')) {
                const size = m.content === 'non' ? null : m.content;
                subscription.size = size;
                filled.push('size');
                m.reply(`${!size ? 'aucune' : ''} taille enregistrée ! Maintenant, envoyez le catalogue de l'article (ID trouvable à partir de l'URL de la recherche) ou "non" !`);
            }

            if (filled.includes('maxPrice') && !filled.includes('color')) {
                const color = m.content === 'non' ? null : m.content;
                subscription.color = color;
                filled.push('color');
                m.reply(`${!color ? 'aucune' : ''} couleur enregistrée ! Maintenant, envoyez la taille de l'article (telle qu'elle est affichée sur Vinted) ou "non".`);
            }

            if (filled.includes('query') && !filled.includes('maxPrice')) {
                let successText;
                if (m.content === "non") {
                    successText = 'aucun prix maximum défini !';
                    subscription.maxPrice = null;
                } else {
                    const price = m.content.endsWith('€') ? parseInt(m.content.slice(0, m.content - 1)) : parseInt(m.content);
                    subscription.maxPrice = price;
                    successText = `prix maximum enregistré (${subscription.maxPrice} euros) ! `;
                }
                filled.push('maxPrice');
                m.reply(`${successText} Maintenant, envoyez la couleur de l'article (telle qu'elle est affichée sur Vinted) ou "non".`);
            }

            if (!filled.includes('query')) {
                const query = m.content === 'non' ? null : m.content;
                subscription.query = query;
                filled.push('query');
                m.reply(`${!query ? 'aucune' : ''} recherche enregistrée ! Maintenant, envoyez le prix maximum de l'annonce (ou "non" pour ne définir aucun prix maximum).`);
            }

        });

    }

});

client.login(config.token);
