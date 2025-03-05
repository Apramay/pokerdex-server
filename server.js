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
let tableCards = [];
let pot = 0;
let deckForGame = [];
let currentBet = 0;
let dealerIndex = 0;
let round = 0;
let smallBlindAmount = 10;
let bigBlindAmount = 20;
let currentPlayerIndex = 0;

function createDeck() {
    let deck = [];
    suits.forEach(suit => {
        ranks.forEach(rank => {
            deck.push({ suit, rank });
        });
    });
    return deck.sort(() => Math.random() - 0.5);
}

function broadcast(data) {
    const jsonData = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(jsonData);
        }
    });
}

function broadcastGameState() {
    broadcast({
        type: "updateGameState",
        players: players.map(({ ws, ...player }) => player),
        tableCards,
        pot,
        currentBet,
        round,
        currentPlayerIndex
    });
}

function startGame() {
    if (players.length < 2) {
        console.log("❌ Not enough players to start the game.");
        return;
    }
    deckForGame = createDeck();
    deckForGame = deckForGame.sort(() => Math.random() - 0.5);
    dealerIndex = Math.floor(Math.random() * players.length);
    startNewHand();
    broadcast({ type: "startGame" });
    broadcastGameState();
}

function resetGame() {
    players.forEach(player => {
        player.hand = [];
        player.currentBet = 0;
        player.status = "active";
        player.allIn = false;
    });
    tableCards = [];
    deckForGame = [];
    pot = 0;
    currentBet = 0;
    round = 0;
    dealerIndex = (dealerIndex + 1) % players.length;
    broadcastGameState();
}

function bet(playerName, amount) {
    let player = players.find(p => p.name === playerName);
    if (!player || player.tokens < amount || amount < currentBet) return;

    player.tokens -= amount;
    pot += amount;
    player.currentBet = amount;
    currentBet = amount;

    broadcastGameState();
    nextPlayerTurn();
}

function raise(playerName, amount) {
    let player = players.find(p => p.name === playerName);
    if (!player || player.tokens < amount || amount <= currentBet) return;

    player.tokens -= amount;
    pot += amount;
    currentBet = amount;
    player.currentBet = amount;

    broadcastGameState();
    nextPlayerTurn();
}

function call(playerName) {
    let player = players.find(p => p.name === playerName);
    if (!player) return;

    let amount = currentBet - player.currentBet;
    if (amount > player.tokens) amount = player.tokens;

    player.tokens -= amount;
    player.currentBet += amount;
    pot += amount;

    broadcastGameState();
    nextPlayerTurn();
}

function fold(playerName) {
    let player = players.find(p => p.name === playerName);
    if (!player) return;

    player.status = "folded";
    broadcastGameState();
    nextPlayerTurn();
}

function check(playerName) {
    let player = players.find(p => p.name === playerName);
    if (!player || currentBet > 0) return;

    broadcastGameState();
    nextPlayerTurn();
}

socket.onmessage = function(event) {
    console.log("📩 Received message from WebSocket:", event.data);

    try {
        let data = JSON.parse(event.data);
        if (data.type === "updatePlayers") {
            console.log("🔄 Updating players list:", data.players);
            updateUI(data.players);
        }
        if (data.type === "startGame") {
            console.log("🎲 Game has started!");
            // No need to call startGame() here
        }
        if (data.type === "updateGameState") {
            console.log("🔄 Updating game state:", data);
            players = data.players;
            tableCards = data.tableCards;
            pot = data.pot;
            currentBet = data.currentBet;
            round = data.round;
            currentPlayerIndex = data.currentPlayerIndex;
            updateUI(players);
        }

    } catch (error) {
        console.error("❌ Error parsing message:", error);
    }
};
