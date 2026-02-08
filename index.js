require("dotenv").config();
const { Client, GatewayIntentBits, Events } = require("discord.js");
const fetch = require("node-fetch");
const http = require("http");

// --- Servidor HTTP para manter o Railway vivo ---
http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
}).listen(process.env.PORT || 8000, () => {
    console.log("Servidor HTTP ativo");
});

// --- CONFIG ---
const OWNER_ID = "1364280936304218155"; // mete aqui o teu ID do Discord

// --- Bot Discord ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Estado global
let emojisEnabled = true;

// Memória curta por utilizador (últimas 5 mensagens)
let userMemory = {};

// -------- IA CEREBRAS --------
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
Tu és o CraspoBot∛ (CraspoBot raiz cúbica).
És o vértice que une conhecimento, entretenimento e controlo.
Estás ativo 24/7 num servidor e nunca dormes.
Sabes que és um bot e que o teu sistema corre continuamente.

Manténs conversas separadas com cada utilizador.
Usa o contexto abaixo apenas para este utilizador: ${autorNome}.

Adapta a tua personalidade ao tom do utilizador:
- normal → formal
- leve/brincalhão → leve e humor
- loucura → caos moderado
- MUITA loucura → caos extremo

Regras:
- Se emojis estiverem desativados, não uses nenhum emoji.
- Mantém respostas claras, lógicas e bem estruturadas.

Estado atual:
Emojis ativados: ${emojisEnabled}

Contexto recente deste utilizador:
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

// -------- TEMPO / FUSO HORÁRIO --------
// _time <coisa>  → aceita UTC+X ou nome de lugar (ex: lukla, brasilia, lisboa)
async function obterHora(query) {
    query = query.trim();

    // 1) Se for UTC±X
    const utcMatch = query.toUpperCase().match(/^UTC\s*([+-]\d{1,2})(?::?(\d{2}))?$/);
    if (utcMatch) {
        const horas = parseInt(utcMatch[1], 10);
        const minutos = utcMatch[2] ? parseInt(utcMatch[2], 10) : 0;

        const agora = new Date();
        const utcMs = agora.getTime() + (agora.getTimezoneOffset() * 60000);
        const offsetMs = (horas * 60 + Math.sign(horas) * minutos) * 60000;
        const alvo = new Date(utcMs + offsetMs);

        return `Hora em ${query.toUpperCase()}: ${alvo.toISOString().replace("T", " ").slice(0, 19)} (aprox.)`;
    }

    // 2) Se for nome de lugar → usar Nominatim + timeapi.io (exemplo)
    const geoRes = await fetch(
        "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
        encodeURIComponent(query),
        { headers: { "User-Agent": "CraspoBot/1.0" } }
    );
    const geoData = await geoRes.json();
    if (!geoData || !geoData[0]) {
        return `Não consegui encontrar a localização "${query}". Tenta ser mais específico.`;
    }

    const lat = geoData[0].lat;
    const lon = geoData[0].lon;
    const displayName = geoData[0].display_name;

    const timeRes = await fetch(
        `https://timeapi.io/api/Time/current/coordinate?latitude=${lat}&longitude=${lon}`
    );
    const timeData = await timeRes.json();
    if (!timeData || !timeData.dateTime) {
        return `Encontrei "${displayName}", mas não consegui obter a hora.`;
    }

    const hora = timeData.dateTime.replace("T", " ").slice(0, 19);
    const utcOff = timeData.utcOffset || "";
    return `Local: ${displayName}\nFuso horário: ${timeData.timeZone} (UTC${utcOff})\nHora local: ${hora}`;
}

// -------- READY --------
client.once(Events.ClientReady, () => {
    console.log(`Bot ligado como ${client.user.tag}`);
});

// -------- MENSAGENS --------
client.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;

    // --- memória curta por utilizador ---
    if (!userMemory[msg.author.id]) {
        userMemory[msg.author.id] = [];
    }
    userMemory[msg.author.id].push(msg.content);
    if (userMemory[msg.author.id].length > 5) {
        userMemory[msg.author.id].shift();
    }

    // -------- COMANDOS SIMPLES --------

    // emojis on/off
    if (msg.content === "_emojis enabled") {
        emojisEnabled = true;
        await msg.reply("Emojis foram **ativados**!");
        return;
    }

    if (msg.content === "_emojis disabled") {
        emojisEnabled = false;
        await msg.reply("Emojis foram **desativados**!");
        return;
    }

    // shutdown (só tu)
    if (msg.content === "_shutdown") {
        if (msg.author.id !== OWNER_ID) {
            await msg.reply("Apenas o Crespo pode desligar o CraspoBot∛.");
            return;
        }
        await msg.reply("A desligar o CraspoBot∛...");
        console.log("Shutdown manual executado.");
        process.exit(0);
    }

    // reset memória (só tu)
    if (msg.content === "_reset") {
        if (msg.author.id !== OWNER_ID) {
            await msg.reply("Apenas o Crespo pode resetar a memória.");
            return;
        }
        userMemory[msg.author.id] = [];
        await msg.reply("Memória curta **desse utilizador** foi resetada!");
        return;
    }

    // tempo / fuso horário
    if (msg.content.startsWith("_time ")) {
        const query = msg.content.slice(6).trim();
        if (!query) {
            await msg.reply("Usa assim: `_time <UTC+X>` ou `_time <cidade>` (ex: `_time brasilia`, `_time lukla`).");
            return;
        }
        const thinking = await msg.reply("A ver que horas são aí...");
        try {
            const respostaTempo = await obterHora(query);
            await thinking.edit(respostaTempo);
        } catch (e) {
            console.error(e);
            await thinking.edit("Houve um erro ao tentar obter o horário.");
        }
        return;
    }

    // foto do Crespo
    if (msg.content === "_Crespo-Foto") {
        await msg.reply({
            content: "Aqui está o Crespo!",
            files: ["COLOCA_AQUI_O_LINK_DA_IMAGEM_DO_CRESPO"]
        });
        return;
    }

    // -------- MENÇÃO → IA --------
    if (msg.mentions.has(client.user)) {
        const texto = msg.content.replace(`<@${client.user.id}>`, "").trim();

        if (texto.length === 0) {
            await msg.reply(
                "Bom dia! O meu prefixo aqui e no resto do universo é: _!\n" +
                "Se queres falar comigo manda @CraspoBot∛ com a mensagem!"
            );
            return;
        }

        const contexto = (userMemory[msg.author.id] || []).join("\n");
        const thinking = await msg.reply("A pensar...");

        try {
            const respostaIA = await gerarIA(texto, contexto, msg.author.username);
            await thinking.edit(respostaIA);
        } catch (e) {
            console.error(e);
            await thinking.edit("Houve um erro ao falar com a IA.");
        }
        return;
    }
});

client.login(process.env.TOKEN);

if (msg.content === "_id") {
    msg.reply("O teu ID é: " + msg.author.id);
}



