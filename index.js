require("dotenv").config();
const { 
    Client, 
    GatewayIntentBits, 
    Events 
} = require("discord.js");

const fetch = require("node-fetch");
const http = require("http");

// Música
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus 
} = require("@discordjs/voice");

const ytdl = require("ytdl-core");
const ytSearch = require("yt-search");

// Servidor HTTP (Railway/Koyeb)
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
}).listen(process.env.PORT || 8000);

// Config
const OWNER_ID = "1364280936304218155";
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Estado
let emojisEnabled = true;
let userMemory = {};
let queue = [];
let player = createAudioPlayer();

// Bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// IA Cerebras
async function gerarIA(prompt, contexto, autorNome) {
    const resposta = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.CEREBRAS_KEY}`
        },
        body: JSON.stringify({
            model: "llama3.1-8b",
            messages: [
                {
                    role: "system",
                    content: `
Tu és o CraspoBot∛.
És o vértice que une conhecimento, entretenimento e controlo.
Adapta-te ao tom do utilizador.
Manténs conversas separadas por utilizador.
Emojis ativados: ${emojisEnabled}
Contexto deste utilizador (${autorNome}):
${contexto}
`
                },
                { role: "user", content: prompt }
            ]
        })
    });

    const data = await resposta.json();
    return data.choices[0].message.content;
}

// Google Geocode
async function geocodeLugar(lugar) {
    const url =
        "https://maps.googleapis.com/maps/api/geocode/json?address=" +
        encodeURIComponent(lugar) +
        `&key=${GOOGLE_API_KEY}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!data.results || !data.results[0]) return null;

    const r = data.results[0];
    return {
        nome: r.formatted_address,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng
    };
}

// Google Timezone
async function obterHoraLugar(lugarOuUtc) {
    const q = lugarOuUtc.trim();

    const utcMatch = q.toUpperCase().match(/^UTC\s*([+-]\d{1,2})(?::?(\d{2}))?$/);
    if (utcMatch) {
        const horas = parseInt(utcMatch[1], 10);
        const minutos = utcMatch[2] ? parseInt(utcMatch[2], 10) : 0;

        const agora = new Date();
        const utcMs = agora.getTime() + (agora.getTimezoneOffset() * 60000);
        const offsetMs = (horas * 60 + Math.sign(horas) * minutos) * 60000;
        const alvo = new Date(utcMs + offsetMs);

        return `Hora em ${q.toUpperCase()}: ${alvo.toISOString().replace("T", " ").slice(0, 19)} (aprox.)`;
    }

    const geo = await geocodeLugar(q);
    if (!geo) return `Não encontrei "${q}".`;

    const tzUrl =
        "https://maps.googleapis.com/maps/api/timezone/json?location=" +
        `${geo.lat},${geo.lng}` +
        `&timestamp=${Math.floor(Date.now() / 1000)}` +
        `&key=${GOOGLE_API_KEY}`;

    const tzRes = await fetch(tzUrl);
    const tzData = await tzRes.json();

    if (!tzData.timeZoneId) {
        return `Encontrei "${geo.nome}", mas não consegui obter o fuso horário.`;
    }

    const timeZone = tzData.timeZoneId;
    const agoraLocal = new Date().toLocaleString("pt-PT", { timeZone });

    return `Local: ${geo.nome}
Fuso horário: ${timeZone}
Hora local: ${agoraLocal}`;
}

// DuckDuckGo + Wikipedia
async function pesquisarTermo(termo) {
    termo = termo.trim();
    if (!termo) return "Escreve algo para eu pesquisar.";

    const ddgRes = await fetch(
        "https://api.duckduckgo.com/?format=json&no_redirect=1&no_html=1&q=" +
        encodeURIComponent(termo)
    );
    const ddg = await ddgRes.json();

    let resposta = "";

    if (ddg.AbstractText) resposta += `**DuckDuckGo:** ${ddg.AbstractText}\n`;
    else resposta += `**DuckDuckGo:** Sem resumo direto.\n`;

    const wikiRes = await fetch(
        "https://en.wikipedia.org/api/rest_v1/page/summary/" +
        encodeURIComponent(termo)
    );

    if (wikiRes.ok) {
        const wiki = await wikiRes.json();
        if (wiki.extract) resposta += `\n**Wikipedia:** ${wiki.extract}`;
        else resposta += `\n**Wikipedia:** Sem resumo.`;
    }

    return resposta;
}

// Música
async function tocarMusica(msg, query) {
    const voiceChannel = msg.member.voice.channel;
    if (!voiceChannel) return msg.reply("Entra num canal de voz primeiro.");

    const pesquisa = await ytSearch(query);
    if (!pesquisa || !pesquisa.videos || !pesquisa.videos.length)
        return msg.reply("Não encontrei essa música.");

    const musica = pesquisa.videos[0];
    queue.push(musica);

    msg.reply(`Adicionado à fila: **${musica.title}**`);

    if (player.state.status !== AudioPlayerStatus.Playing) {
        tocarProxima(msg, voiceChannel);
    }
}

function tocarProxima(msg, voiceChannel) {
    if (queue.length === 0) {
        msg.channel.send("Fila vazia.");
        return;
    }

    const musica = queue.shift();

    const stream = ytdl(musica.url, { filter: "audioonly" });
    const resource = createAudioResource(stream);

    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: msg.guild.id,
        adapterCreator: msg.guild.voiceAdapterCreator
    });

    player.play(resource);
    connection.subscribe(player);

    msg.channel.send(`🎵 A tocar: **${musica.title}**`);

    player.on(AudioPlayerStatus.Idle, () => {
        tocarProxima(msg, voiceChannel);
    });
}

// Ready
client.once(Events.ClientReady, () => {
    console.log(`CraspoBot∛ ligado como ${client.user.tag}`);
});

// Mensagens
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;

    if (!userMemory[msg.author.id]) userMemory[msg.author.id] = [];
    userMemory[msg.author.id].push(msg.content);
    if (userMemory[msg.author.id].length > 5) userMemory[msg.author.id].shift();

    if (msg.content === "_id") {
        return msg.reply("O teu ID é: " + msg.author.id);
    }

    if (msg.content === "_emojis enabled") {
        emojisEnabled = true;
        return msg.reply("Emojis ativados!");
    }

    if (msg.content === "_emojis disabled") {
        emojisEnabled = false;
        return msg.reply("Emojis desativados!");
    }

    if (msg.content === "_shutdown") {
        if (msg.author.id !== OWNER_ID)
            return msg.reply("Só o Crespo pode desligar o CraspoBot∛.");
        msg.reply("A desligar...");
        process.exit(0);
    }

    if (msg.content === "_reset") {
        if (msg.author.id !== OWNER_ID)
            return msg.reply("Só o Crespo pode resetar a memória.");
        userMemory[msg.author.id] = [];
        return msg.reply("Memória resetada!");
    }

    if (msg.content.startsWith("_time ")) {
        const query = msg.content.slice(6).trim();
        const thinking = await msg.reply("A ver que horas são...");
        const resposta = await obterHoraLugar(query);
        return thinking.edit(resposta);
    }

    if (msg.content.startsWith("_where ")) {
        const lugar = msg.content.slice(7).trim();
        const thinking = await msg.reply("A procurar...");
        const geo = await geocodeLugar(lugar);
        if (!geo) return thinking.edit("Não encontrei.");
        return thinking.edit(
            `Encontrei: ${geo.nome}\nLatitude: ${geo.lat}\nLongitude: ${geo.lng}`
        );
    }

    if (msg.content.startsWith("_search ")) {
        const termo = msg.content.slice(8).trim();
        const thinking = await msg.reply("A pesquisar...");
        const resposta = await pesquisarTermo(termo);
        return thinking.edit(resposta);
    }

    if (msg.content.startsWith("_play ")) {
        const query = msg.content.slice(6).trim();
        return tocarMusica(msg, query);
    }

    if (msg.content === "_skip") {
        player.stop();
        return msg.reply("⏭ Música saltada.");
    }

    if (msg.content === "_stop") {
        queue = [];
        player.stop();
        return msg.reply("⛔ Música parada e fila limpa.");
    }

    if (msg.content === "_pause") {
        player.pause();
        return msg.reply("⏸ Música pausada.");
    }

    if (msg.content === "_resume") {
        player.unpause();
        return msg.reply("▶ Música retomada.");
    }

    if (msg.content === "_queue") {
        if (queue.length === 0) return msg.reply("Fila vazia.");
        return msg.reply(
            "Fila atual:\n" +
            queue.map((m, i) => `${i + 1}. ${m.title}`).join("\n")
        );
    }

    if (msg.mentions.has(client.user)) {
        const texto = msg.content.replace(`<@${client.user.id}>`, "").trim();
        const contexto = userMemory[msg.author.id].join("\n");
        const thinking = await msg.reply("A pensar...");
        const resposta = await gerarIA(texto, contexto, msg.author.username);
        return thinking.edit(resposta);
    }
});

client.login(process.env.TOKEN);
