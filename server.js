const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = [];
let deck = [];
let tableCards = [];
let pot = 0;
let currentBet = 0;
let currentPlayerIndex = 0;
let dealerIndex = 0;
let smallBlindAmount = 10;
let bigBlindAmount = 20;
let gameStarted = false;

const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];

function createDeck() {
    let deck = [];
    for (let suit of suits) {
        for (let rank of ranks) {
            deck.push({ suit, rank });
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function dealHand() {
    return [deck.pop(), deck.pop()];
}

wss.on("connection", (ws) => {
    console.log("✅ New player connected");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "join") {
                if (players.length < 6) {
                    players.push({ name: data.name, chips: 1000, hand: [], status: "active" });
                    broadcast({ type: "updatePlayers", players });
                }
            }

            if (data.type === "startGame" && !gameStarted) {
                gameStarted = true;
                startGame();
            }

            if (data.type === "action") {
                handlePlayerAction(data.action, data.name);
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
    deck = shuffleDeck(createDeck());
    players.forEach(player => {
        player.hand = dealHand();
        player.status = "active";
    });

    dealerIndex = Math.floor(Math.random() * players.length);
    setupBlinds();
    broadcastGameState();
}

function setupBlinds() {
    pot = 0;
    currentBet = bigBlindAmount;
    const smallBlindIndex = (dealerIndex + 1) % players.length;
    const bigBlindIndex = (dealerIndex + 2) % players.length;

    players[smallBlindIndex].chips -= smallBlindAmount;
    players[bigBlindIndex].chips -= bigBlindAmount;

    pot += smallBlindAmount + bigBlindAmount;
    currentPlayerIndex = (bigBlindIndex + 1) % players.length;
}

function handlePlayerAction(action, playerName) {
    let player = players.find(p => p.name === playerName);
    if (!player || player.status !== "active") return;

    if (action.type === "fold") {
        player.status = "folded";
    } else if (action.type === "call") {
        let callAmount = currentBet - player.currentBet;
        player.chips -= callAmount;
        player.currentBet += callAmount;
        pot += callAmount;
    } else if (action.type === "raise") {
        let amount = action.amount;
        player.chips -= amount;
        player.currentBet = amount;
        pot += amount;
        currentBet = amount;
    }

    currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
    broadcastGameState();
}

function broadcastGameState() {
    let gameState = {
        type: "gameState",
        players: players.map(p => ({ name: p.name, chips: p.chips, status: p.status })),
        pot,
        currentBet,
        currentPlayerIndex,
        tableCards,
    };
    broadcast(gameState);
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

server.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});
