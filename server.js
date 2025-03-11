const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Card and game constants
const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const rankValues = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14
};

// Game state variables
let players = [];
let tableCards = [];
let pot = 0;
let currentPlayerIndex = 0;
let deckForGame = [];
let currentBet = 0;
let dealerIndex = 0;
let round = 0;
let smallBlindAmount = 10;
let bigBlindAmount = 20;
let playersWhoActed = new Set();

// Function to create a new deck of cards
function createDeck() {
    let deck = [];
    suits.forEach(suit => {
        ranks.forEach(rank => {
            deck.push({ suit, rank });
        });
    });
    return deck.sort(() => Math.random() - 0.5);
}

// Function to broadcast data to all connected clients
function broadcast(data) {
    const jsonData = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(jsonData);
        }
    });
}

// Function to broadcast the current game state to all clients
function broadcastGameState() {
    players.forEach(player => {
        const privateGameState = {
            type: "updateGameState",
            players: players.map(({ ws, hand, ...playerData }) => ({
                ...playerData,
                hand: player.name === playerData.name ? hand : [] // Only send their own hand
            })),
            tableCards,
            pot,
            currentBet,
            round,
            currentPlayerIndex,
            dealerIndex
        };

        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(privateGameState));
        }
    });
}

// Function to start the game
function startGame() {
    if (players.length < 2) {
        console.log("❌ Not enough players to start the game.");
        return;
    }
    deckForGame = shuffleDeck(createDeck());
    dealerIndex = Math.floor(Math.random() * players.length);
    startNewHand();
    broadcast({ type: "startGame" });
    broadcastGameState();
}

// Function to start a new hand
function startNewHand() {
    deckForGame = shuffleDeck(createDeck());
    players.forEach(player => {
        player.hand = dealHand(deckForGame, 2);
        player.currentBet = 0;
        player.status = "active";
        player.allIn = false;
    });
    tableCards = [];
    pot = 0;
    currentBet = 0;
    round = 0;
    setupBlinds();
}

// Function to set up blinds for the new hand
function setupBlinds() {
    pot = 0;
    const smallBlindIndex = (dealerIndex + 1) % players.length;
    const bigBlindIndex = (dealerIndex + 2) % players.length;

    postBlind(players[smallBlindIndex], smallBlindAmount);
    postBlind(players[bigBlindIndex], bigBlindAmount);

    currentBet = bigBlindAmount;
    currentPlayerIndex = (bigBlindIndex + 1) % players.length;

    playersWhoActed.clear();
    playersWhoActed.add(players[smallBlindIndex].name);
    playersWhoActed.add(players[bigBlindIndex].name);

    broadcastGameState();
    broadcast({ type: "blindsPosted", smallBlind: players[smallBlindIndex].name, bigBlind: players[bigBlindIndex].name });
    setTimeout(bettingRound, 500);
}

// Function to post blinds
function postBlind(player, amount) {
    const blindAmount = Math.min(amount, player.tokens);
    player.tokens -= blindAmount;
    player.currentBet = blindAmount;
    pot += blindAmount;
    if (player.tokens === 0) {
        player.allIn = true;
    }
}

// Function to deal a hand of cards to a player
function dealHand(deck, numCards) {
    const hand = [];
    for (let i = 0; i < numCards; i++) {
        hand.push(deck.pop());
    }
    return hand;
}

// Function to shuffle the deck of cards
function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function bettingRound() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);

    if (activePlayers.length <= 1) {
        setTimeout(nextRound, 1000);
        return;
    }

    if (isBettingRoundOver()) {
        setTimeout(nextRound, 1000);
        return;
    }

    const player = players[currentPlayerIndex];

    if (!player || player.status !== "active" || player.tokens === 0 || player.allIn) {
        currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
        if (currentPlayerIndex === -1) {
            return;
        }
        bettingRound();
        return;
    }

    playerAction(player);
}

function isBettingRoundOver() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);

    if (activePlayers.length <= 1) {
        return true;
    }

    const allBetsMatched = activePlayers.every(player =>
        player.currentBet === currentBet || player.status === "folded"
    );

    const allPlayersActed = playersWhoActed.size >= activePlayers.length;

    if (allBetsMatched && allPlayersActed) {
        return true;
    }

    return false;
}

function getNextPlayerIndex(currentIndex) {
    let activePlayers = players.filter(p => p.status === "active" && p.tokens > 0);

    if (activePlayers.length <= 1) {
        setTimeout(nextRound, 1000);
        return -1;
    }

    let nextIndex = (currentIndex + 1) % players.length;
    let attempts = 0;

    while (
        (players[nextIndex].status !== "active" || players[nextIndex].tokens === 0 || players[nextIndex].allIn) &&
        attempts < players.length
    ) {
        nextIndex = (nextIndex + 1) % players.length;
        attempts++;
    }

    if (attempts >= players.length) {
        setTimeout(nextRound, 1000);
        return -1;
    }

    if (isBettingRoundOver()) {
        return -1;
    }

    return nextIndex;
}

function startFlopBetting() {
    currentBet = 0;
    currentPlayerIndex = (dealerIndex + 1) % players.length;
    playersWhoActed.clear();
    bettingRound();
}

function playerAction(player) {
    let options = [];
    if (currentBet === 0 || player.currentBet === currentBet) {
        options.push("check", "bet");
    } else {
        options.push("call", "fold", "raise");
    }

    player.ws.send(JSON.stringify({
        type: "playerTurn",
        message: `It's your turn, ${player.name}.`,
        options: options
    }));
}

function nextRound() {
    playersWhoActed.clear();
