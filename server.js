const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = [];
let gameState = null; // Store game state

wss.on("connection", (ws) => {
    console.log("✅ New player connected");

    ws.send(JSON.stringify({ type: "updatePlayers", players }));

    if (gameState) {
        ws.send(JSON.stringify({ type: "gameState", gameState }));
    }

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "join") {
                console.log(`👤 Player joined: ${data.name}`);

                if (!players.some(player => player.name === data.name)) {
                    players.push({ name: data.name, tokens: 1000 });
                    broadcast({ type: "updatePlayers", players });
                }
            }

            if (data.type === "startGame") {
                console.log("🎲 Game started!");
                startGame();
            }

            if (data.type === "playerAction") {
                if (gameState && data.player === gameState.players[gameState.currentPlayerIndex].name) {
                    processPlayerAction(data.player, data.action);
                }
            }
        } catch (error) {
            console.error("❌ Error handling message:", error);
        }
    });

    ws.on("close", () => {
        console.log("🚪 A player disconnected");
    });
});

function startGame() {
    gameState = {
        players: players.map(p => ({ ...p, hand: [], currentBet: 0, status: "active", allIn: false })),
        deck: shuffleDeck(createDeck()),
        tableCards: [],
        pot: 0,
        currentBet: 0,
        currentPlayerIndex: 0,
        round: 0
    };

    // Deal hands to players
    gameState.players.forEach(player => {
        player.hand = dealHand(gameState.deck, 2);
    });

    broadcast({ type: "gameState", gameState });
}

function processPlayerAction(playerName, action) {
    let player = gameState.players[gameState.currentPlayerIndex];

    if (player.name !== playerName) return;

    if (action === "fold") {
        player.status = "folded";
    } else if (action === "check") {
        console.log(`${player.name} checks.`);
    } else if (action === "call") {
        let amount = Math.min(gameState.currentBet - player.currentBet, player.tokens);
        player.tokens -= amount;
        player.currentBet += amount;
        gameState.pot += amount;
    }

    // Move to the next active player
    gameState.currentPlayerIndex = getNextPlayerIndex(gameState.currentPlayerIndex);
    broadcast({ type: "gameState", gameState });
}

function getNextPlayerIndex(currentIndex) {
    let nextIndex = (currentIndex + 1) % gameState.players.length;
    while (gameState.players[nextIndex].status === "folded" || gameState.players[nextIndex].tokens === 0) {
        nextIndex = (nextIndex + 1) % gameState.players.length;
    }
    return nextIndex;
}

// Helper functions
function broadcast(data) {
    const jsonData = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(jsonData);
        }
    });
}

function createDeck() {
    const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
    const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
    let deck = [];

    suits.forEach(suit => {
        ranks.forEach(rank => {
            deck.push({ suit, rank });
        });
    });

    return deck;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function dealHand(deck, numCards) {
    return deck.splice(deck.length - numCards, numCards);
}

server.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});
