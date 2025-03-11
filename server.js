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
                hand: player.name === playerData.name ? hand : [] // ✅ Only send their own hand
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
    console.log(`${player.name} posts ${blindAmount}.`);
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
    console.log("Starting betting round...");

    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);

    // ✅ If only one active player remains, move to the next round immediately.
    if (activePlayers.length <= 1) {
        console.log("Only one player left, moving to next round.");
        setTimeout(nextRound, 1000);
        return;
    }

    // ✅ Corrected: Don't check `isBettingRoundOver()` too early.
    if (playersWhoActed.size >= activePlayers.length && isBettingRoundOver()) {
        console.log("All players have acted. Betting round is over.");
        setTimeout(nextRound, 1000);
        return;
    }

    const player = players[currentPlayerIndex];

    // ✅ Ensure skipping only if player has acted AND matched the current bet
    if (playersWhoActed.has(player.name) && player.currentBet === currentBet) {
        currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
        bettingRound(); // Continue to next player
        return;
    }

    console.log(`Waiting for player ${player.name} to act...`);

    // ✅ Ensures UI correctly prompts player action
    playerAction(player);
}


function isBettingRoundOver() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);
    
    if (activePlayers.length <= 1) return true; // Only one player left, round ends immediately
    
    // ✅ Move to the next round as soon as all players have either:
    // 1. Called (matched the currentBet)
    // 2. Folded
    const allBetsMatched = activePlayers.every(player => 
        player.currentBet === currentBet || player.status === "folded"
    );

    if (allBetsMatched) {
        playersWhoActed.clear(); // Reset for the next round
        return true;
    }

    return false;
}



function getNextPlayerIndex(currentIndex) {
    let activePlayers = players.filter(p => p.status === "active" && p.tokens > 0);
    
    if (activePlayers.length <= 1) {
        console.log("Only one player remains, moving to next round.");
        setTimeout(nextRound, 1000);
        return -1;
    }

    let nextIndex = (currentIndex + 1) % players.length;
    let initialIndex = currentIndex; // Store who originally acted
    let attempts = 0;

    while (
        (players[nextIndex].status !== "active" || players[nextIndex].tokens === 0 || players[nextIndex].allIn) 
        && attempts < players.length
    ) {
        nextIndex = (nextIndex + 1) % players.length;
        attempts++;

        // If we looped back to the original raiser, stop
        if (nextIndex === initialIndex) {
            console.log("✅ All players have acted. Moving to the next round.");
            setTimeout(nextRound, 1000);
            return -1;
        }
    }

    if (attempts >= players.length) {
        console.warn("⚠ No valid player found. Ending round.");
        setTimeout(nextRound, 1000);
        return -1;
    }

    return nextIndex;
}

function startFlopBetting() {
    currentBet = 0;
    currentPlayerIndex = (dealerIndex + 1) % players.length;
    playersWhoActed.clear();
    bettingRound();  // ✅ Ensure betting actually starts
}



function nextRound() {
    console.log("nextRound() called. Current round:", round);

    currentBet = 0;
    players.forEach(player => (player.currentBet = 0));
    playersWhoActed.clear();

    if (round === 0) {
        round++;
        tableCards = dealHand(deckForGame, 3); // Flop
        broadcast({ type: "message", text: `Flop: ${JSON.stringify(tableCards)}` });
    } else if (round === 1) {
        round++;
        tableCards.push(dealHand(deckForGame, 1)[0]); // Turn
        broadcast({ type: "message", text: `Turn: ${JSON.stringify(tableCards[3])}` });
    } else if (round === 2) {
        round++;;
        tableCards.push(dealHand(deckForGame, 1)[0]); // River
        broadcast({ type: "message", text: `River: ${JSON.stringify(tableCards[4])}` });
    } else if (round === 3) {
        showdown();
        return;
    }

    broadcastGameState();
    setTimeout(startFlopBetting, 1000);
}



function showdown() {
    console.log("Showdown!");
    let activePlayers = players.filter(p => p.status === "active" || p.allIn);
    let winners = determineWinners(activePlayers);
    winners.forEach(winner => {
        console.log(`${winner.name} wins the hand!`);});
    distributePot();
    broadcastGameState();
    broadcast({
        type: "winner",
        winners: winners.map(w => w.name),
        pot: pot
    });
    setTimeout(resetGame, 3000);
}

function distributePot() {
    let activePlayers = players.filter(p => p.status === "active" || p.allIn);
    activePlayers.sort((a, b) => a.currentBet - b.currentBet);

    let totalPot = pot;
    let sidePots = [];
    while (activePlayers.length > 0) {
        const minBet = activePlayers[0].currentBet;
        let potPortion = 0;

        activePlayers.forEach(player => {
            potPortion += Math.min(minBet, player.currentBet);
            player.currentBet -= Math.min(minBet, player.currentBet);
        });

        sidePots.push({ players: [...activePlayers], amount: potPortion });
        activePlayers = activePlayers.filter(p => p.currentBet > 0);
    }

    sidePots.forEach(sidePot => {
        let winners = determineWinners(sidePot.players);
        let splitPot = Math.floor(sidePot.amount / winners.length);
        winners.forEach(winner => {
            winner.tokens += splitPot;
        });
    });
let remainingPot = totalPot - sidePots.reduce((acc, sp) => acc + sp.amount, 0);
    if (remainingPot > 0) {
        let mainWinners = determineWinners(players.filter(p => p.status === "active"));
        let splitPot = Math.floor(remainingPot / mainWinners.length);
        mainWinners.forEach(winner => {
            winner.tokens += splitPot;
            console.log(`${winner.name} wins ${splitPot} from the main pot.`);
        });
    }
}
function resetGame() {
    console.log("Resetting game for the next round.");
    round = 0;
    tableCards = [];
    pot = 0;
    players.forEach(player => {
        player.hand = [];
        player.currentBet = 0;
        player.status = "active";
        player.allIn = false;
    });
    dealerIndex = (dealerIndex + 1) % players.length; // Move dealer button
    startNewHand();
}


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
                handleBet(data);
            } else if (data.type === 'raise') {
                handleRaise(data);
            } else if (data.type === 'call') {
                handleCall(data);
            } else if (data.type === 'fold') {
                handleFold(data);
            } else if (data.type === 'check') {
                handleCheck(data);
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

// Action handlers
function handleBet(data) {
    const player = players.find(p => p.name === data.playerName);
    if (!player) {
        console.error("Player not found:", data.playerName);
        return;
    }

    const betAmount = parseInt(data.amount);

    if (betAmount > player.tokens) {
        console.error("Not enough tokens:", data.playerName);
        return;
    }

    player.tokens -= betAmount;
    player.currentBet = betAmount;
    pot += betAmount;
    currentBet = betAmount; // Update the current bet

    // Move to the next player
    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);

    // Broadcast the updated game state
    broadcastGameState();
}

function handleRaise(data) {
    const player = players.find(p => p.name === data.playerName);
    if (!player) {
        console.error("Player not found:", data.playerName);
        return;
    }

    const raiseAmount = parseInt(data.amount);

    if (raiseAmount <= currentBet || raiseAmount > player.tokens) {
        console.error("Invalid raise amount:", data.playerName);
        return;
    }

    const totalBet = raiseAmount;
    player.tokens -= totalBet - player.currentBet;
    pot += totalBet - player.currentBet;
    player.currentBet = totalBet;
    currentBet = totalBet;

    // ✅ Mark this player as having acted
    playersWhoActed.add(player.name); 

    // Move to the next player
    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);

    // Broadcast the updated game state
    broadcastGameState();
}


function handleCall(data) {
    const player = players.find(p => p.name === data.playerName);
    if (!player) {
        console.error("Player not found:", data.playerName);
        return;
    }

    let amount = Math.min(currentBet - player.currentBet, player.tokens);
    player.tokens -= amount;
    player.currentBet += amount;
    pot += amount;
    if (player.tokens === 0) {
        player.allIn = true;
    }

    // Move to the next player
    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);

    // Broadcast the updated game state
    broadcastGameState();
}

function handleFold(data) {
    const player = players.find(p => p.name === data.playerName);
    if (!player) {
        console.error("Player not found:", data.playerName);
        return;
    }

    player.status = "folded";

    // Move to the next player
    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);

    // Broadcast the updated game state
    broadcastGameState();
}

function handleCheck(data) {
    const player = players.find(p => p.name === data.playerName);
    if (!player) {
        console.error("Player not found:", data.playerName);
        return;
    }

    if (currentBet === 0 || player.currentBet === currentBet) {
        console.log(`${player.name} checked.`);
        playersWhoActed.add(player.name); // ✅ Mark player as having acted

        // ✅ Move to the next player
        currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);

        if (isBettingRoundOver()) {
            console.log("All players have checked/called. Moving to next round.");
            setTimeout(nextRound, 1000);
        } else {
            console.log(`Next player: ${players[currentPlayerIndex].name}`);
            broadcastGameState();
        }
    } else {
        console.log("Check not allowed, there is a bet to match.");
    }
}

// Start the server
server.listen(process.env.PORT || 8080, () => {
    console.log(`WebSocket server started on port ${server.address().port}`);
});
