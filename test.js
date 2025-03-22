const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const app = express();

app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store game state for each table
const tables = new Map();

// Card and game constants
const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const rankValues = {
    "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14
};

const smallBlindAmount = 10;
const bigBlindAmount = 20;

// Function to create a new deck of cards
function createDeck() {
    const deck = [];
    suits.forEach(suit => {
        ranks.forEach(rank => {
            deck.push({ suit, rank });
        });
    });
    return deck.sort(() => Math.random() - 0.5);
}

// Function to broadcast data to all connected clients in a table
function broadcast(data, tableId) {
    const jsonData = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.tableId === tableId && client.readyState === WebSocket.OPEN) {
            client.send(jsonData);
        }
    });
}

// Function to broadcast the current game state to all clients in a table
function broadcastGameState(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    table.players.forEach(player => {
        const privateGameState = {
            type: "updateGameState",
            tableId: tableId,
            players: table.players.map(({ ws, hand, ...playerData }) => ({
                ...playerData,
                hand: player.name === playerData.name ? hand : Array(hand.length).fill({ rank: "back", suit: "back" })
            })),
            tableCards: table.tableCards,
            pot: table.pot,
            currentBet: table.currentBet,
            round: table.round,
            currentPlayerIndex: table.currentPlayerIndex,
            dealerIndex: table.dealerIndex
        };
        if (player.ws && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(privateGameState));
        }
    });
}

// Function to start the game
function startGame(tableId) {
    const table = tables.get(tableId);
    if (!table || table.players.length < 2) {
        console.log("  ❌   Not enough players to start the game.");
        return;
    }

    table.deckForGame = shuffleDeck(createDeck());
    table.dealerIndex = Math.floor(Math.random() * table.players.length);
    startNewHand(tableId);
    broadcast({ type: "startGame", tableId: tableId }, tableId);
    broadcastGameState(tableId);
}

// Function to start a new hand
function startNewHand(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    // Reset game state for a new hand
    table.tableCards =[];
    table.pot = 0;
    table.currentBet = 0;
    table.playersWhoActed = new Set();
    table.deckForGame = shuffleDeck(createDeck());
    table.round = 0;

    // Move the dealer button
    table.dealerIndex = (table.dealerIndex + 1) % table.players.length;

    // Determine small blind and big blind indices
    let smallBlindIndex = (table.dealerIndex + 1) % table.players.length;
    let bigBlindIndex = (table.dealerIndex + 2) % table.players.length;

    // Reset player states and deal cards
    table.players.forEach((player, index) => {
        player.hand = dealHand(table.deckForGame, 2);
        player.currentBet = 0;
        player.status = "active"; // Reset player status
        player.isSmallBlind = index === smallBlindIndex;
        player.isBigBlind = index === bigBlindIndex;

        // Deduct blinds from player tokens and add to pot
        if (player.isSmallBlind) {
            player.tokens -= smallBlindAmount;
            table.pot += smallBlindAmount;
            player.currentBet = smallBlindAmount;
        } else if (player.isBigBlind) {
            player.tokens -= bigBlindAmount;
            table.pot += bigBlindAmount;
            player.currentBet = bigBlindAmount;
        }
    });

    table.currentBet = bigBlindAmount; // Set initial bet to big blind
    // Set the starting player (after the big blind)
    table.currentPlayerIndex = (bigBlindIndex + 1) % table.players.length;

    // Broadcast the updated game state
    broadcastGameState(tableId);
}

function setupBlinds(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    table.pot = 0;
    const smallBlindIndex = (table.dealerIndex + 1) % table.players.length;
    const bigBlindIndex = (table.dealerIndex + 2) % table.players.length;

    console.log(`  🎲   Setting up blinds: SB -> ${table.players[smallBlindIndex].name}, BB -> ${table.players[bigBlindIndex].name}`);

    postBlind(table.players[smallBlindIndex], smallBlindAmount, tableId); // Small Blind posts
    postBlind(table.players[bigBlindIndex], bigBlindAmount, tableId, true); // Big Blind posts & updates `currentBet`

    table.currentPlayerIndex = (bigBlindIndex + 1) % table.players.length; // First action goes to UTG (next after BB)
    table.playersWhoActed.clear();

    console.log(`  🎯   First action: ${table.players[table.currentPlayerIndex].name}`);

    broadcastGameState(tableId);  // Ensures frontend gets the correct initial state

    broadcast({
        type: "blindsPosted",
        smallBlind: table.players[smallBlindIndex].name,
        bigBlind: table.players[bigBlindIndex].name,
        tableId: tableId
    }, tableId);

    setTimeout(bettingRound, 500, tableId);  // Start the first betting round
}

function formatHand(hand) {
    return hand.map(card => `${card.rank} of ${card.suit}`).join(", ");
}

function postBlind(player, amount, tableId, isBigBlind = false) {
    const table = tables.get(tableId);
    if (!table) return;

    const blindAmount = Math.min(amount, player.tokens);
    player.tokens -= blindAmount;
    player.currentBet = blindAmount;
    table.pot += blindAmount;

    if (player.tokens === 0) {
        player.allIn = true;
    }

    if (isBigBlind) {  // Ensure `currentBet` is set to the BB amount
        table.currentBet = blindAmount;
    }

    console.log(`  💰   ${player.name} posts ${blindAmount}. Pot: ${table.pot}, Current Bet: ${table.currentBet}`);
}

function getNextPlayerIndex(currentIndex, tableId) {
    const table = tables.get(tableId);
    if (!table) return -1;

    console.log(`  🔄   Finding next player from index ${currentIndex}`);

    let nextIndex = (currentIndex + 1) % table.players.length;
    let attempts = 0;

    while (attempts < table.players.length) {
        let nextPlayer = table.players[nextIndex];
        if (nextPlayer.status === "active" && nextPlayer.tokens > 0 && !nextPlayer.allIn) {
            console.log(`  🎯   Next player is ${nextPlayer.name}`);
            return nextIndex;
        }
        console.log(`  ⏩   Skipping ${nextPlayer.name} (Status: ${nextPlayer.status}, Tokens: ${nextPlayer.tokens})`);
        nextIndex = (nextIndex + 1) % table.players.length;
        attempts++;
    }

    console.log("  ✅   All players have acted. Moving to the next round.");
    setTimeout(nextRound, 1000, tableId);
    return -1;
}

function bettingRound(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    console.log("Starting betting round...");

    let activePlayers = table.players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);
    if (activePlayers.length <= 1) {
        console.log("Betting round over, moving to next round.");
        setTimeout(nextRound, 1000, tableId);
        return;
    }

    if (isBettingRoundOver(tableId)) {
        console.log("All players have acted. Betting round is over.");
        setTimeout(nextRound, 1000, tableId);
        return;
    }

    const player = table.players[table.currentPlayerIndex];

    if (table.playersWhoActed.has(player.name) && player.currentBet === table.currentBet) {
        console.log(`${player.name} has already acted. Skipping...`);
        table.currentPlayerIndex = getNextPlayerIndex(table.currentPlayerIndex, tableId);
        bettingRound(tableId);
        return;
    }

    console.log(`Waiting for player ${player.name} to act...`);
    broadcast({ type: "playerTurn", playerName: player.name, tableId: tableId }, tableId);
}

function isBettingRoundOver(tableId) {
    const table = tables.get(tableId);
    if (!table) return true;

    console.log("  📊   Checking if betting round is over...");
    console.log("playersWhoActed:", [...table.playersWhoActed]);
    console.log("Current Bet:", table.currentBet);
    console.log("Active Players:", table.players.filter(p => p.status === "active").map(p => p.name));

    let activePlayers = table.players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);
    if (activePlayers.length <= 1) return true; // Only one player left, round ends immediately

    // Ensure all active players have either checked or matched the current bet
    const allCalledOrChecked = activePlayers.every(player =>
        table.playersWhoActed.has(player.name) &&
        (player.currentBet === table.currentBet || table.currentBet === 0)
    );

    console.log("  ✅   Betting round over:", allCalledOrChecked);
    return allCalledOrChecked;
}

function bigBlindCheckRaiseOption(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    let bigBlindPlayer = table.players[(table.dealerIndex + 2) % table.players.length];
    if (table.currentBet === bigBlindAmount) {
        console.log(`${bigBlindPlayer.name}, you can check or bet.`);
        bigBlindPlayer.ws.send(JSON.stringify({
            type: "bigBlindAction",
            options: ["check", "raise"],
            tableId: tableId
        }));
    } else {
        console.log(`${bigBlindPlayer.name}, you must call or fold.`);
        bigBlindPlayer.ws.send(JSON.stringify({
            type: "bigBlindAction",
            message: `${bigBlindPlayer.name}, you must call or fold.`,
            options: ["call", "fold", "raise"],
            tableId: tableId
        }));
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

function startFlopBetting(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    table.currentBet = 0;
    table.playersWhoActed.clear();

    // Get the first active player left of the dealer
    table.currentPlayerIndex = getNextPlayerIndex(table.dealerIndex, tableId);

    console.log(`  🎯   Starting post-flop betting with: ${table.players[table.currentPlayerIndex].name}`);
    table.playersWhoActed.clear();

    // Broadcast correct first player
    broadcast({
        type: "playerTurn",
        playerName: table.players[table.currentPlayerIndex].name,
        tableId: tableId
    }, tableId);

    bettingRound(tableId);
}

function nextRound(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    console.log("nextRound() called. Current round:", table.round);
    table.currentBet = 0;

    table.players.forEach(player => (player.currentBet = 0));
    table.playersWhoActed.clear();

    console.log("  🆕   New round started. Reset playersWhoActed.");

    //   Debugging log
    if (table.round === 0) {
        table.round++;
        table.tableCards = dealHand(table.deckForGame, 3); // Flop
        broadcast({ type: "message", text: `Flop: ${JSON.stringify(table.tableCards)}`, tableId: tableId }, tableId);
    } else if (table.round === 1) {
        table.round++;
        if (table.deckForGame.length > 0) {
            table.tableCards.push(dealHand(table.deckForGame, 1)[0]); // Turn
            broadcast({ type: "message", text: `Turn: ${JSON.stringify(table.tableCards[3])}`, tableId: tableId }, tableId);
        }
    } else if (table.round === 2) {
        table.round++;
        if (table.deckForGame.length > 0) {
            table.tableCards.push(dealHand(table.deckForGame, 1)[0]); // River
            broadcast({ type: "message", text: `River: ${JSON.stringify(table.tableCards[4])}`, tableId: tableId }, tableId);
        }
    } else if (table.round === 3) {
        // Showdown logic
        let winners = determineWinners(tableId);
        broadcast({ type: "showdown", winners: winners, tableId: tableId }, tableId);
        setTimeout(() => {
            startNewHand(tableId);
        }, 5000); // Delay before starting a new hand
        return;
    }

    broadcastGameState(tableId);

    // Delay before starting betting round
    setTimeout(() => {
        let activePlayers = table.players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);
        if (activePlayers.length > 1) {
            startFlopBetting(tableId);
        } else {
            console.log("Only one active player left.");
            // Award pot to the last active player
            let winner = activePlayers[0];
            winner.tokens += table.pot;
            broadcast({ type: "message", text: `${winner.name} wins the pot!`, tableId: tableId }, tableId);
            setTimeout(() => {
                startNewHand(tableId);
            }, 5000); // Delay before starting a new hand
        }
    }, 1000);
}

function handleFold(data, tableId) {
const table = tables.get(tableId);
if (!table) return;

console.log(` 🔄  ${data.playerName} performed action: ${data.type}`);
console.log("Before updating playersWhoActed:", [...table.playersWhoActed]);
const player = table.players.find(p => p.name === data.playerName);
if (!player) {
    console.error("Player not found:", data.playerName);
    return; //  ✅  Prevents processing an invalid action
}
player.status = "folded";
table.playersWhoActed.add(player.name);
console.log(` ❌  ${player.name} folded.`);
broadcast({
    type: "updateActionHistory",
    action: `${data.playerName} folded`
}, tableId);
broadcast({ type: "fold", playerName: data.playerName }, tableId);
table.currentPlayerIndex = getNextPlayerIndex(table.currentPlayerIndex, tableId);
if (table.currentPlayerIndex !== -1) {
    bettingRound(tableId);
} else {
    console.log(" ✅  All players have acted. Moving to next round.");
    setTimeout(nextRound, 1000, tableId);
}
broadcastGameState(tableId);  //  ✅  Only update the UI once
}
function handleCheck(data, tableId) {
const table = tables.get(tableId);
if (!table) return;

console.log(` 🔄  ${data.playerName} performed action: ${data.type}`);
console.log("Before updating playersWhoActed:", [...table.playersWhoActed]);
const player = table.players.find(p => p.name === data.playerName);
if (!player) {
    console.error(" ❌  Player not found:", data.playerName);
    return; //  ✅  Prevents processing an invalid action
}
if (table.currentBet === 0 || player.currentBet === table.currentBet) {
    console.log(`${player.name} checked.`);
    table.playersWhoActed.add(player.name);
    console.log("After updating playersWhoActed:", [...table.playersWhoActed]);
    broadcast({
        type: "updateActionHistory",
        action: `${data.playerName} checked`
    }, tableId);
    if (isBettingRoundOver(tableId)) {
        setTimeout(nextRound, 1000, tableId);
    } else {
        table.currentPlayerIndex = getNextPlayerIndex(table.currentPlayerIndex, tableId);
        broadcastGameState(tableId);
        bettingRound(tableId);
    }
}
}
// Start the server
server.listen(process.env.PORT || 8080, () => {
console.log(`WebSocket server started on port ${server.address().port}`);
});
