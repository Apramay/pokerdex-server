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
    broadcast({
        type: "updateGameState",
        players: players.map(({ ws, ...player }) => player), // Exclude the ws object
        tableCards,
        pot,
        currentBet,
        round,
        currentPlayerIndex
    });
}

// Function to start the game
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

    // Start with Under The Gun (UTG), which is the player after the big blind
    currentPlayerIndex = (bigBlindIndex + 1) % players.length;

    playersWhoActed.clear(); // Reset players who acted
    broadcastGameState();
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
    console.log(`${player.name} posts ${blindAmount}.`);
}

// Function to deal a hand of cards to a player
function dealHand(deck, numCards) {
    const hand =[];
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

// Function to manage the betting round
function bettingRound() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);

    if (activePlayers.length <= 1 || isBettingRoundOver()) {
        setTimeout(nextRound, 1000);
        return;
    }

    const player = players[currentPlayerIndex];

    if (playersWhoActed.has(player.name) && player.currentBet === currentBet) {
        currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
        bettingRound();
        return;
    }

    console.log(`Waiting for player ${player.name} to act...`);
}

// Function to check if the betting round is over
function isBettingRoundOver() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);

    if (activePlayers.length <= 1) {
        return true;
    }

    const allCalled = activePlayers.every(player => player.currentBet === currentBet || player.status === "folded");

    if (allCalled && playersWhoActed.size >= activePlayers.length) {
        return true;
    }

    return false;
}

// Function to get the index of the next player in the game
function getNextPlayerIndex(currentIndex) {
    let nextIndex = (currentIndex + 1) % players.length;
    let attempts = 0;
    while ((players[nextIndex].status !== "active" || players[nextIndex].tokens === 0 || players[nextIndex].allIn) && attempts < players.length) {
        if (nextIndex === currentIndex) {
            return -1;
        }
        nextIndex = (nextIndex + 1) % players.length;
        attempts++;
    }
    return nextIndex;
}

// Function to move to the next round of the game
function nextRound() {
    currentBet = 0;
    players.forEach(player => player.currentBet = 0);
    playersWhoActed.clear();

    if (round === 0) {
        round = 1;
        tableCards = dealHand(deckForGame, 3);
    } else if (round === 1 || round === 2) {
        round++;
        tableCards.push(dealCard(deckForGame));
    } else if (round === 3) {
        showdown();
        return;
    }

    broadcastGameState();
    currentPlayerIndex = getNextPlayerIndex((dealerIndex + 1) % players.length);
    setTimeout(bettingRound, 500);
}

// Function to handle the showdown when all rounds are finished
function showdown() {
    console.log("Showdown!");
    let activePlayers = players.filter(p => p.status === "active" || p.allIn);
    let winners = determineWinners(activePlayers);
    winners.forEach(winner => {
        console.log(`${winner.name} wins the hand!`);
    });
    distributePot();
    broadcastGameState();
    setTimeout(resetGame, 3000);
}

// Function to distribute the pot to the winners
function distributePot() {
    let activePlayers = players.filter(p => p.status === "active" || p.allIn);
    let winners = determineWinners(activePlayers);

    if (winners.length === 0) {
        console.log("No winners found.");
        return;
    }

    const potShare = Math.floor(pot / winners.length);
    let remainder = pot % winners.length;

    winners.forEach((winner, index) => {
        winner.tokens += potShare;
        if (index < remainder) {
            winner.tokens += 1; // Distribute the remainder
        }
        console.log(`${winner.name} receives ${potShare + (index < remainder ? 1 : 0)} tokens.`);
    });

    pot = 0; // Reset the pot
}

// Function to determine the winners of the game
function determineWinners(playerList) {
    if (playerList.length === 0) {
        return;
    }

    let bestHandValue = -1;
    let winners = [];

    playerList.forEach(player => {
        if (player.status !== "folded") {
            const handValue = evaluateHand(player.hand.concat(tableCards));

            if (handValue > bestHandValue) {
                bestHandValue = handValue;
                winners = [player];
            } else if (handValue === bestHandValue) {
                winners.push(player);
            }
        }
    });

    return winners;
}

// Function to evaluate the hand of a player
function evaluateHand(cards) {
    const hand = cards.slice().sort((a, b) => rankValues[b.rank] - rankValues[a.rank]);
    const ranks = hand.map(card => card.rank);
    const suits = hand.map(card => card.suit);

    if (isRoyalFlush(hand, ranks, suits)) return 10;
    if (isStraightFlush(hand, ranks, suits)) return 9;
    if (isFourOfAKind(hand, ranks)) return 8;
    if (isFullHouse(hand, ranks)) return 7;
    if (isFlush(hand, suits)) return 6;
    if (isStraight(hand, ranks)) return 5;
    if (isThreeOfAKind(hand, ranks)) return 4;
    if (isTwoPair(hand, ranks)) return 3;
    if (isOnePair(hand, ranks)) return 2;
    return 1; // High card
}

// Helper functions to check for different hand types
function isRoyalFlush(hand, ranks, suits) {
    if (!isFlush(hand, suits)) return false;
    const royalRanks = ["10", "J", "Q", "K", "A"];
    return royalRanks.every(rank => ranks.includes(rank));
}

function isStraightFlush(hand, ranks, suits) {
    return isFlush(hand, suits) && isStraight(hand, ranks);
}

function isFourOfAKind(hand, ranks) {
    for (let rank of ranks) {
        if (ranks.filter(r => r === rank).length === 4) {
            return true;
        }
    }
    return false;
}

function isFullHouse(hand, ranks) {
    let three = false;
    let pair = false;
    for (let rank of ranks) {
        if (ranks.filter(r => r === rank).length === 3) {
            three = true;
        }
        if (ranks.filter(r => r === rank).length === 2) {
            pair = true;
        }
    }
    return three && pair;
}

function isFlush(hand, suits) {
    return suits.every(suit => suit === suits[0]);
}

function isStraight(hand, ranks) {
    const rankValues = hand.map(card => {
        if (card.rank === "A") return 14;
        if (card.rank === "K") return 13;
        if (card.rank === "Q") return 12;
        if (card.rank === "J") return 11;
        return parseInt(card.rank);
    }).sort((a, b) => a - b);

    if (rankValues[4] - rankValues[0] === 4) return true;
    if (rankValues[3] - rankValues[0] === 3 && rankValues[4] === 14 && rankValues[3] === 5) return true; // Special case for A,2,3,4,5
    return false;
}

function isThreeOfAKind(hand, ranks) {
    for (let rank of ranks) {
        if (ranks.filter(r => r === rank).length === 3) {
            return true;
        }
    }
    return false;
}

function isTwoPair(hand, ranks) {
    let pairs = 0;
    let checkedRanks = new Set();
    for (let rank of ranks) {
        if (checkedRanks.has(rank)) continue;
        if (ranks.filter(r => r === rank).length === 2) {
            pairs++;
            checkedRanks.add(rank);
        }
    }
    return pairs === 2;
}

function isOnePair(hand, ranks) {
    for (let rank of ranks) {
        if (ranks.filter(r => r === rank).length === 2) {
            return true;
        }
    }
    return false;
}

// WebSocket server event handling
wss.on('connection', function connection(ws) {
    console.log('✅ A new client connected');

    ws.on('message', function incoming(message) {
        console.log('📩 Received message from client:', message);

        try {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                const player = {
                    name: data.name,
                    ws: ws,
                    tokens: 1000,
                    hand:[],
                    currentBet: 0,
                    status: 'active',
                    allIn: false
                };
                players.push(player);
                console.log(`➕ Player ${data.name} joined. Total players: ${players.length}`);
                broadcast({ type: 'updatePlayers', players: players.map(({ ws, ...player }) => player) });
            } else if (data.type === 'startGame') {
                startGame();
            } else if (data.type === 'bet') {
                // Handle bet action
            } else if (data.type === 'raise') {
                // Handle raise action
            } else if (data.type === 'call') {
                // Handle call action
            } else if (data.type === 'fold') {
                // Handle fold action
            } else if (data.type === 'check') {
                // Handle check action
            }

        } catch (error) {
            console.error('❌ Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('❌ Client disconnected');
        players = players.filter(player => player.ws !== ws);
        broadcast({ type: 'updatePlayers', players: players.map(({ ws, ...player }) => player) });
    });
});

// Start the server
server.listen(process.env.PORT || 8080, () => {
    console.log(`WebSocket server started on port ${server.address().port}`);
});
