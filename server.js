const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const rankValues = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14 };

let players = [];
let deck = [];
let tableCards = [];
let pot = 0;
let currentBet = 0;
let currentPlayerIndex = 0;
let round = 0;
let dealerIndex = 0;
let smallBlindAmount = 10;
let bigBlindAmount = 20;

function createDeck() {
    const deck = [];
    for (const suit of suits) {
        for (const rank of ranks) {
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

function dealCard(deck) {
    return deck.pop();
}

function dealHand(deck, numCards) {
    return Array.from({ length: numCards }, () => dealCard(deck));
}

function createPlayer(name, tokens) {
    return { name, tokens, hand: [], currentBet: 0, status: "active", allIn: false };
}

function startGame() {
    if (players.length < 2) {
        console.log("Not enough players to start the game.");
        return;
    }

    deck = shuffleDeck(createDeck());
    players.forEach(player => {
        player.hand = dealHand(deck, 2);
        player.currentBet = 0;
        player.status = "active";
        player.allIn = false;
    });

    dealerIndex = Math.floor(Math.random() * players.length);
    tableCards = [];
    pot = 0;
    currentBet = 0;
    round = 0;
    setupBlinds();
}

function setupBlinds() {
    const smallBlindIndex = (dealerIndex + 1) % players.length;
    const bigBlindIndex = (dealerIndex + 2) % players.length;

    postBlind(players[smallBlindIndex], smallBlindAmount);
    postBlind(players[bigBlindIndex], bigBlindAmount);

    currentBet = bigBlindAmount;
    currentPlayerIndex = (bigBlindIndex + 1) % players.length;

    broadcastGameState();
    bettingRound();
}

function postBlind(player, amount) {
    player.tokens -= amount;
    player.currentBet = amount;
    pot += amount;
    if (player.tokens === 0) player.allIn = true;
}

function bettingRound() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn);
    if (activePlayers.length <= 1 || isBettingRoundOver()) {
        nextRound();
        return;
    }

    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
    broadcastGameState();
}

function isBettingRoundOver() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn);
    return activePlayers.every(player => player.currentBet === currentBet);
}

function getNextPlayerIndex(index) {
    let nextIndex = (index + 1) % players.length;
    while (players[nextIndex].status !== "active" || players[nextIndex].allIn) {
        nextIndex = (nextIndex + 1) % players.length;
        if (nextIndex === index) return -1;
    }
    return nextIndex;
}

function nextRound() {
    if (round === 0) {
        tableCards = dealHand(deck, 3);
    } else if (round === 1 || round === 2) {
        tableCards.push(dealCard(deck));
    } else {
        showdown();
        return;
    }
    round++;
    bettingRound();
}

function showdown() {
    let winners = determineWinners();
    winners.forEach(winner => {
        winner.tokens += pot;
        console.log(`${winner.name} wins ${pot} chips!`);
    });
    resetGame();
}

function determineWinners() {
    return [players[0]]; // TODO: Implement proper hand evaluation
}

function resetGame() {
    pot = 0;
    round = 0;
    deck = shuffleDeck(createDeck());
    tableCards = [];
    players.forEach(player => {
        player.hand = dealHand(deck, 2);
        player.status = "active";
        player.allIn = false;
        player.currentBet = 0;
    });

    dealerIndex = (dealerIndex + 1) % players.length;
    setupBlinds();
}

function playerAction(playerName, action, amount = 0) {
    let player = players.find(p => p.name === playerName);
    if (!player) return;

    if (action === "fold") {
        player.status = "folded";
    } else if (action === "call") {
        let callAmount = Math.min(currentBet - player.currentBet, player.tokens);
        player.tokens -= callAmount;
        player.currentBet += callAmount;
        pot += callAmount;
    } else if (action === "bet" || action === "raise") {
        if (amount > player.tokens || amount <= currentBet) return;
        let totalBet = amount;
        player.tokens -= totalBet - player.currentBet;
        pot += totalBet - player.currentBet;
        player.currentBet = totalBet;
        currentBet = totalBet;
    }

    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
    bettingRound();
}

function broadcastGameState() {
    const gameState = {
        type: "updateGame",
        players,
        tableCards,
        pot,
        currentBet,
        round,
        currentPlayer: players[currentPlayerIndex]?.name,
    };
    broadcast(gameState);
}

wss.on("connection", (ws) => {
    console.log("✅ New player connected");
    ws.send(JSON.stringify({ type: "updatePlayers", players }));

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "join") {
                if (!players.some(p => p.name === data.name)) {
                    players.push(createPlayer(data.name, 1000));
                    broadcast({ type: "updatePlayers", players });
                }
            }

            if (data.type === "startGame") {
                startGame();
                broadcastGameState();
            }

            if (data.type === "action") {
                playerAction(data.name, data.action, data.amount);
                broadcastGameState();
            }

        } catch (error) {
            console.error("❌ Error handling message:", error);
        }
    });

    ws.on("close", () => console.log("🚪 A player disconnected"));
});

function broadcast(data) {
    const jsonData = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(jsonData);
        }
    });
}

server.listen(3000, () => console.log("🚀 Server running on port 3000"));
