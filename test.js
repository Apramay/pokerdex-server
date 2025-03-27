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

// Helper functions
function createDeck() {
    let deck = [];
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push({ suit, rank });
        }
    }
    return shuffleDeck(deck);
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function dealHand(deck, numCards) {
    const hand = [];
    for (let i = 0; i < numCards; i++) {
        hand.push(deck.pop());
    }
    return hand;
}

function broadcast(data, tableId) {
    const jsonData = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client.tableId === tableId && client.readyState === WebSocket.OPEN) {
            client.send(jsonData);
        }
    });
}

function broadcastGameState(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    table.players.forEach(player => {
        const privateGameState = {
            type: "updateGameState",
            tableId: tableId,
            players: table.players.map(p => ({
                ...p,
                hand: p.name === player.name ? p.hand : 
                      p.hand.map(() => ({ rank: "back", suit: "back" }))
            })),
            tableCards: table.tableCards,
            pot: table.pot,
            currentBet: table.currentBet,
            round: table.round,
            currentPlayerIndex: table.currentPlayerIndex,
            dealerIndex: table.dealerIndex,
            lastRaiseAmount: table.lastRaiseAmount
        };

        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify(privateGameState));
        }
    });
}

// Game logic
function startGame(tableId) {
    const table = tables.get(tableId);
    if (!table || table.players.length < 2) {
        console.log("Not enough players to start the game");
        return;
    }

    table.deckForGame = createDeck();
    table.dealerIndex = Math.floor(Math.random() * table.players.length);
    startNewHand(tableId);
}

function startNewHand(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    // Reset hand-specific state
    table.tableCards = [];
    table.pot = 0;
    table.currentBet = 0;
    table.lastRaiseAmount = 0;
    table.playersWhoActed = new Set();
    table.round = 0; // Pre-flop
    table.deckForGame = createDeck();

    // Move dealer button
    table.dealerIndex = (table.dealerIndex + 1) % table.players.length;

    // Reset player states
    table.players.forEach(player => {
        player.hand = [];
        player.currentBet = 0;
        player.totalContribution = 0;
        player.allIn = false;
        player.status = player.tokens > 0 ? "active" : "inactive";
    });

    // Deal cards to active players
    table.players.forEach(player => {
        if (player.tokens > 0) {
            // For testing, give specific hands
            if (player.name === "A") {
                player.hand = [{ rank: "A", suit: "Hearts" }, { rank: "A", suit: "Spades" }];
                player.tokens = 500;
            } else if (player.name === "B") {
                player.hand = [{ rank: "10", suit: "Clubs" }, { rank: "10", suit: "Diamonds" }];
                player.tokens = 700;
            } else if (player.name === "C") {
                player.hand = [{ rank: "K", suit: "Hearts" }, { rank: "Q", suit: "Spades" }];
                player.tokens = 1000;
            } else {
                player.hand = dealHand(table.deckForGame, 2);
            }
        }
    });

    // Post blinds
    setupBlinds(tableId);
}

function setupBlinds(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    const smallBlindIndex = (table.dealerIndex + 1) % table.players.length;
    const bigBlindIndex = (table.dealerIndex + 2) % table.players.length;

    // Post small blind
    const sbPlayer = table.players[smallBlindIndex];
    if (sbPlayer && sbPlayer.tokens > 0) {
        const sbAmount = Math.min(table.smallBlindAmount, sbPlayer.tokens);
        sbPlayer.tokens -= sbAmount;
        sbPlayer.currentBet = sbAmount;
        sbPlayer.totalContribution += sbAmount;
        table.pot += sbAmount;
        sbPlayer.isSmallBlind = true;
        if (sbPlayer.tokens === 0) sbPlayer.allIn = true;
    }

    // Post big blind
    const bbPlayer = table.players[bigBlindIndex];
    if (bbPlayer && bbPlayer.tokens > 0) {
        const bbAmount = Math.min(table.bigBlindAmount, bbPlayer.tokens);
        bbPlayer.tokens -= bbAmount;
        bbPlayer.currentBet = bbAmount;
        bbPlayer.totalContribution += bbAmount;
        table.pot += bbAmount;
        table.currentBet = bbAmount;
        table.lastRaiseAmount = bbAmount;
        bbPlayer.isBigBlind = true;
        if (bbPlayer.tokens === 0) bbPlayer.allIn = true;
    }

    // Set first player to act (UTG)
    table.currentPlayerIndex = (bigBlindIndex + 1) % table.players.length;
    broadcastGameState(tableId);
    bettingRound(tableId);
}

function bettingRound(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    if (isBettingRoundOver(tableId)) {
        setTimeout(nextRound, 1000, tableId);
        return;
    }

    const player = table.players[table.currentPlayerIndex];
    if (!player || player.status !== "active" || player.allIn) {
        table.currentPlayerIndex = getNextPlayerIndex(table.currentPlayerIndex, tableId);
        bettingRound(tableId);
        return;
    }

    broadcast({ 
        type: "playerTurn", 
        playerName: player.name,
        tableId: tableId,
        minRaise: table.lastRaiseAmount || table.bigBlindAmount,
        currentBet: table.currentBet
    }, tableId);
}

function isBettingRoundOver(tableId) {
    const table = tables.get(tableId);
    if (!table) return true;

    const activePlayers = table.players.filter(p => 
        p.status === "active" && !p.allIn && p.tokens > 0
    );

    // All players have acted
    const allActed = activePlayers.every(p => table.playersWhoActed.has(p.name));
    
    // All active players have matched the current bet or are all-in
    const allCalled = table.players.every(p => 
        p.status !== "active" || 
        p.allIn || 
        p.currentBet === table.currentBet
    );

    return (activePlayers.length === 0) || (allActed && allCalled);
}

function getNextPlayerIndex(currentIndex, tableId) {
    const table = tables.get(tableId);
    if (!table) return -1;

    let nextIndex = (currentIndex + 1) % table.players.length;
    let attempts = 0;

    while (attempts < table.players.length) {
        const player = table.players[nextIndex];
        if (player.status === "active" && !player.allIn && player.tokens > 0) {
            return nextIndex;
        }
        nextIndex = (nextIndex + 1) % table.players.length;
        attempts++;
    }

    return -1; // No valid players found
}

function nextRound(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    // Reset for new round
    table.currentBet = 0;
    table.lastRaiseAmount = 0;
    table.playersWhoActed.clear();
    table.players.forEach(p => p.currentBet = 0);

    // Deal community cards based on round
    if (table.round === 0) { // Flop
        table.round = 1;
        table.tableCards = [
            { suit: "Clubs", rank: "A" },
            { suit: "Spades", rank: "7" },
            { suit: "Clubs", rank: "2" }
        ];
        broadcast({ type: "message", text: `Flop: ${JSON.stringify(table.tableCards)}` }, tableId);
    } 
    else if (table.round === 1) { // Turn
        table.round = 2;
        table.tableCards.push({ suit: "Clubs", rank: "9" });
        broadcast({ type: "message", text: `Turn: ${JSON.stringify(table.tableCards[3])}` }, tableId);
    } 
    else if (table.round === 2) { // River
        table.round = 3;
        table.tableCards.push({ suit: "Hearts", rank: "3" });
        broadcast({ type: "message", text: `River: ${JSON.stringify(table.tableCards[4])}` }, tableId);
    } 
    else if (table.round === 3) { // Showdown
        showdown(tableId);
        return;
    }

    broadcastGameState(tableId);
    
    // Start betting for this round
    const nextPlayerIndex = getNextPlayerIndex(table.dealerIndex, tableId);
    if (nextPlayerIndex !== -1) {
        table.currentPlayerIndex = nextPlayerIndex;
        setTimeout(() => bettingRound(tableId), 1500);
    } else {
        // No valid players, go directly to showdown
        showdown(tableId);
    }
}

function showdown(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    const activePlayers = table.players.filter(p => p.status === "active" || p.allIn);
    const winners = determineWinners(activePlayers, table);

    // Reveal winners' hands
    const revealedHands = winners.map(winner => {
        const fullHand = winner.hand.concat(table.tableCards);
        const evalResult = evaluateHand(fullHand);
        return {
            playerName: winner.name,
            hand: evalResult.bestCards,
            handType: evalResult.handType
        };
    });

    // Distribute the pot
    distributePot(tableId);

    // Broadcast showdown info
    broadcast({
        type: "showdown",
        winners: revealedHands,
        tableId: tableId
    }, tableId);

    // Start new hand after delay
    setTimeout(() => resetGame(tableId), 5000);
}

function distributePot(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    const activePlayers = table.players.filter(p => p.status === "active" || p.allIn);
    if (activePlayers.length === 0) return;

    // Sort players by their total contribution (ascending)
    activePlayers.sort((a, b) => a.totalContribution - b.totalContribution);

    let lastContribution = 0;
    let remainingPot = table.pot;

    // Create and distribute side pots
    for (let i = 0; i < activePlayers.length; i++) {
        const currentPlayer = activePlayers[i];
        const contributionDiff = currentPlayer.totalContribution - lastContribution;

        if (contributionDiff > 0 && remainingPot > 0) {
            // Players eligible for this portion of the pot
            const eligiblePlayers = activePlayers.slice(i);
            const potAmount = contributionDiff * eligiblePlayers.length;

            // Determine winners for this portion
            const winners = determineWinners(eligiblePlayers, table);
            const winAmount = Math.floor(potAmount / winners.length);

            // Distribute to winners
            winners.forEach(winner => {
                winner.tokens += winAmount;
                console.log(`${winner.name} wins ${winAmount} from side pot`);
            });

            remainingPot -= potAmount;
            lastContribution = currentPlayer.totalContribution;
        }
    }

    // Distribute any remaining chips (due to rounding)
    if (remainingPot > 0) {
        const winners = determineWinners(activePlayers, table);
        winners.forEach(winner => winner.tokens += 1);
    }
}

function determineWinners(players, table) {
    if (players.length === 0) return [];
    if (players.length === 1) return [players[0]]; // Single player wins by default

    let bestHandValue = -1;
    let winners = [];
    let bestHand = null;

    players.forEach(player => {
        if (player.status === "folded") return;

        const fullHand = player.hand.concat(table.tableCards);
        const { handValue, bestCards, handType } = evaluateHand(fullHand);

        if (handValue > bestHandValue) {
            winners = [player];
            bestHandValue = handValue;
            bestHand = bestCards;
        } 
        else if (handValue === bestHandValue) {
            const comparison = compareHands(bestCards, bestHand);
            if (comparison > 0) {
                winners = [player];
                bestHand = bestCards;
            } 
            else if (comparison === 0) {
                winners.push(player);
            }
        }
    });

    return winners;
}


// Function to evaluate the hand of a player
function evaluateHand(cards) {
    const combinations = getAllFiveCardCombos(cards);
    let best = {
        handValue: 0,
        bestCards: [],
        handType: "",
        kicker: -1
    };

    for (let combo of combinations) {
        const result = evaluateFiveCardHand(combo);
        if (result.handValue > best.handValue ||
            (result.handValue === best.handValue && compareHands(result.bestCards, best.bestCards) > 0)) {
            best = result;
        }
    }

    return best;
}

function getAllFiveCardCombos(cards) {
    const results = [];
    const combo = [];

    function backtrack(start) {
        if (combo.length === 5) {
            results.push([...combo]);
            return;
        }
        for (let i = start; i < cards.length; i++) {
            combo.push(cards[i]);
            backtrack(i + 1);
            combo.pop();
        }
    }

    backtrack(0);
    return results;
}

function evaluateFiveCardHand(hand) {
    const suits = hand.map(c => c.suit);
    const ranks = hand.map(c => c.rank);
    const values = hand.map(c => rankValues[c.rank]).sort((a, b) => b - a);
    const rankCount = {};
    ranks.forEach(r => rankCount[r] = (rankCount[r] || 0) + 1);

    const isFlush = suits.every(s => s === suits[0]);
    const isStraight = checkStraight(values);

    // Royal Flush
    if (isFlush && isStraight && values.includes(14) && values.includes(10)) {
        return { handValue: 10, bestCards: hand, handType: "Royal Flush", kicker: -1 };
    }

    // Straight Flush
    if (isFlush && isStraight) {
        return { handValue: 9, bestCards: hand, handType: "Straight Flush", kicker: values[0] };
    }

    // Four of a Kind
    if (Object.values(rankCount).includes(4)) {
        const fourRank = Object.keys(rankCount).find(r => rankCount[r] === 4);
        const kicker = values.find(v => v !== rankValues[fourRank]);
        return {
            handValue: 8,
            bestCards: hand,
            handType: "Four of a Kind",
            kicker: kicker
        };
    }

    // Full House
    const hasThree = Object.values(rankCount).includes(3);
    const hasPair = Object.values(rankCount).filter(v => v >= 2).length >= 2;
    if (hasThree && hasPair) {
        return { handValue: 7, bestCards: hand, handType: "Full House", kicker: -1 };
    }

    // Flush
    if (isFlush) {
        return { handValue: 6, bestCards: hand, handType: "Flush", kicker: values[0] };
    }

    // Straight
    if (isStraight) {
        return { handValue: 5, bestCards: hand, handType: "Straight", kicker: values[0] };
    }

    // Three of a Kind
    if (Object.values(rankCount).includes(3)) {
        return { handValue: 4, bestCards: hand, handType: "Three of a Kind", kicker: values[0] };
    }

    // Two Pair
    const pairs = Object.entries(rankCount).filter(([r, c]) => c === 2).map(([r]) => rankValues[r]);
    if (pairs.length === 2) {
        pairs.sort((a, b) => b - a);
        const kicker = values.find(v => v !== pairs[0] && v !== pairs[1]);
        return { handValue: 3, bestCards: hand, handType: "Two Pair", kicker: kicker };
    }

    // One Pair
    // One Pair
if (pairs.length === 1) {
    const pairValue = pairs[0];
    const remaining = values.filter(v => v !== pairValue).slice(0, 3); // Get top 3 kickers
    return { 
        handValue: 2, 
        bestCards: hand, 
        handType: "One Pair", 
        kicker: remaining.length > 0 ? remaining[0] : 0, 
        pairValue: pairValue // Store the value of the pair explicitly
    };
}


    // High Card
    return { handValue: 1, bestCards: hand, handType: "High Card", kicker: values[0] };
}

function checkStraight(values) {
    const unique = [...new Set(values)];
    for (let i = 0; i <= unique.length - 5; i++) {
        if (unique[i] - unique[i + 4] === 4) return true;
    }
    // Check wheel (A-2-3-4-5)
    if (unique.includes(14) && unique.includes(2) && unique.includes(3) && unique.includes(4) && unique.includes(5)) {
        return true;
    }
    return false;
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
    const handValues = hand.map(card => rankValues[card.rank]) //  ✅  Renamed to avoid conflict
        .sort((a, b) => a - b);
    // Normal straight check
    for (let i = 0; i <= handValues.length - 5; i++) {
        if (handValues[i + 4] - handValues[i] === 4 &&
            new Set(handValues.slice(i, i + 5)).size === 5) {
            return true;
        }
    }
    // Special case: A, 2, 3, 4, 5 (Low Straight)
    if (handValues.includes(14) && handValues.slice(0, 4).join() === "2,3,4,5") {
        return true;
    }
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
    let pairs = [];
    let checkedRanks = new Set();
    
    for (let rank of ranks) {
        if (checkedRanks.has(rank)) continue;
        if (ranks.filter(r => r === rank).length === 2) {
            pairs.push(rankValues[rank]); // Store numerical value of the pair
            checkedRanks.add(rank);
        }
    }

    if (pairs.length === 2) {
        pairs.sort((a, b) => b - a); // Sort pairs to ensure the highest pair is first
        const kicker = ranks.find(rank => !pairs.includes(rankValues[rank])); // Find the kicker
        return { result: true, highPair: pairs[0], lowPair: pairs[1], kicker: kicker ? rankValues[kicker] : 0 };
    }

    return { result: false, highPair: 0, lowPair: 0, kicker: 0 };
}

function isOnePair(hand, ranks) {
    for (let rank of ranks) {
        if (ranks.filter(r => r === rank).length === 2) {
            return true;
        }
    }
    return false;
}
function compareHands(handA, handB) {
    const valuesA = handA.map(c => rankValues[c.rank]).sort((a, b) => b - a);
    const valuesB = handB.map(c => rankValues[c.rank]).sort((a, b) => b - a);
    // If both hands have a pair, compare the pair values first
    const pairA = valuesA.find((v, _, arr) => arr.filter(x => x === v).length === 2);
    const pairB = valuesB.find((v, _, arr) => arr.filter(x => x === v).length === 2);
    if (pairA && pairB) {
        if (pairA > pairB) return 1;
        if (pairA < pairB) return -1;
    }

    for (let i = 0; i < 5; i++) {
        if (valuesA[i] > valuesB[i]) return 1;
        if (valuesA[i] < valuesB[i]) return -1;
    }
    return 0; // exact tie
}

// WebSocket server event handling
wss.on('connection', function connection(ws) {
    console.log(' ✅  A new client connected');
    ws.on('message', function incoming(message) {
        console.log(' 📩  Received message from client:', message);
        try {
            const data = JSON.parse(message);
            //  ✅  Handle "Show or Hide" Decision
            if (data.type ===
                "showHideDecision") {
                let player = null;
                let tableId = ws.tableId;
                if (tableId) {
                    let table = tables.get(tableId);
                    if (table) {
                        player = table.players.find(p => p.name === data.playerName);
                    }
                }
                if (!player) return;
                if (data.choice === "show") {
                    console.log(` 👀  ${player.name} chose to SHOW their hand!`);
                    broadcast({
                        type: "updateActionHistory",
                        action: ` 👀  ${player.name} revealed: ${formatHand(player.hand)}`
                    }, ws.tableId);
                } else {
                    console.log(` 🙈  ${player.name} chose to HIDE their hand.`);

                    broadcast({
                        type: "updateActionHistory",
                        action: ` 🙈  ${player.name} chose to keep their hand hidden.`
                    }, ws.tableId);
                }
                //  ✅  Remove player from the waiting list
                let playersWhoNeedToDecide = [];
                if (ws.tableId) {
                    let table = tables.get(ws.tableId);
                    if (table) {
                        playersWhoNeedToDecide = playersWhoNeedToDecide.filter(p => p !== data.playerName);
                        table.playersWhoNeedToDecide = playersWhoNeedToDecide;
                    }
                }
                //  ✅  If all players have chosen, start the next round
                if (playersWhoNeedToDecide.length === 0 && ws.tableId) {
                    setTimeout(resetGame, 3000, ws.tableId);
                }
            }
            //  ✅  Handle other game actions separately
            if (data.type === 'join') {
                const player = {
                    name: data.name,
                    ws: ws,
                    tokens: 1000,
                    hand: [],
                    currentBet: 0,
                    status: 'active',
                    allIn: false
                };
                let tableId = data.tableId;
                ws.tableId = tableId;
                let table = tables.get(tableId);
                if (!table) {
                    table = {
                        players: [],
                        tableCards: [],
                        pot: 0,
                        currentPlayerIndex: 0,
                        deckForGame: [],
                        currentBet: 0,
                        dealerIndex: 0,
                        round: 0,
                        smallBlindAmount: 10,
                        bigBlindAmount: 20,
                        playersWhoActed: new Set()
                    };
                    tables.set(tableId, table);
                }
                table.players.push(player);
                console.log(` ➕  Player ${data.name} joined. Total players: ${table.players.length}`);
                broadcast({ type: 'updatePlayers', players: table.players.map(({ ws, ...player }) => player) , tableId: tableId }, tableId);
            } else if (data.type === 'startGame') {
                startGame(data.tableId);
            } else if (data.type === 'bet') {
                handleBet(data, ws.tableId);
            } else if (data.type === 'raise') {
                handleRaise(data, ws.tableId);
            } else if (data.type === 'call') {
                handleCall(data, ws.tableId);
            } else if (data.type === 'fold') {
                handleFold(data, ws.tableId);
            } else if (data.type === 'check') {
                handleCheck(data, ws.tableId);
            }
        } catch (error) {
            console.error(' ❌  Error parsing message:', error);
        }
    });
    ws.on('close', () => {
        console.log(' ❌  Client disconnected');
        let tableId = ws.tableId;
        if (tableId) {
            let table = tables.get(tableId);
            if (table) {
                table.players = table.players.filter(player => player.ws !== ws);
                broadcast({ type: 'updatePlayers', players: table.players.map(({ ws, ...player }) => player), tableId: tableId }, tableId);
            }
        }
    });
});
// Action handlers
function handleRaise(data, tableId) {
    const table = tables.get(tableId);
    if (!table) return;
    
    const player = table.players.find(p => p.name === data.playerName);
    if (!player) return;
    
    let raiseAmount = parseInt(data.amount);
    if (raiseAmount > player.tokens) raiseAmount = player.tokens; // All-in scenario
    
    const totalBet = player.currentBet + raiseAmount;
    player.tokens -= raiseAmount;
    table.pot += raiseAmount;
    player.currentBet = totalBet;
    player.totalContribution += raiseAmount;
table.pot += raiseAmount;
player.currentBet = totalBet;
    
    if (player.tokens === 0) {
        player.allIn = true;
    }
    
    console.log(`${player.name} raises to ${totalBet}`);
    
    // Handle side pot creation
    const maxEffectiveStack = Math.min(...table.players.map(p => p.currentBet));
    table.sidePots = table.sidePots || [];
    if (totalBet > maxEffectiveStack) {
        console.log(`${player.name} raised beyond the effective stack, creating a side pot`);
        table.sidePots.push({
            amount: totalBet - maxEffectiveStack,
            eligiblePlayers: table.players.filter(p => p.currentBet >= totalBet)
        });
    }
    
    table.currentBet = totalBet;
    table.playersWhoActed.clear(); // Reset for new round
    table.playersWhoActed.add(player.name);
    
    broadcast({
        type: "updateActionHistory",
        action: `${data.playerName} raised to ${totalBet}`
    }, tableId);
    broadcast({ type: "raise", playerName: data.playerName, amount: totalBet, tableId: tableId }, tableId);
    
    table.currentPlayerIndex = getNextPlayerIndex(table.currentPlayerIndex, tableId);
    broadcastGameState(tableId);
    bettingRound(tableId);
}


function handleBet(data, tableId) {
const table = tables.get(tableId);
if (!table) return;

console.log(` 🔄  ${data.playerName} performed action: ${data.type}`);
console.log("Before updating playersWhoActed:", [...table.playersWhoActed]);
const player = table.players.find(p => p.name === data.playerName);
if (!player) {
    console.error("Player not found:", data.playerName);
    return;
}
const betAmount = parseInt(data.amount);
if (betAmount <= player.tokens && betAmount > table.currentBet) {
    player.tokens -= betAmount;
    table.pot += betAmount;
    table.currentBet = betAmount;
    player.currentBet = betAmount;
    if (player.tokens === 0) {
        player.allIn = true;
    }
    table.playersWhoActed.add(player.name);
    console.log("After updating playersWhoActed:", [...table.playersWhoActed]);
    broadcast({
        type: "updateActionHistory",
        action: `${data.playerName} bet ${betAmount}`
    }, tableId);
    broadcast({ type: "bet", playerName: data.playerName, amount: betAmount, tableId: tableId
 }, tableId);
    //  ✅  After a bet, all need to act again
    table.players.forEach(p => {
        if (p.name !== player.name) {
            table.playersWhoActed.delete(p.name);
        }
    });
    console.log("After updating playersWhoActed:", [...table.playersWhoActed]);
    table.currentPlayerIndex = getNextPlayerIndex(table.currentPlayerIndex, tableId);
    broadcastGameState(tableId);  //  ✅  Only update the UI once
    bettingRound(tableId);
}
}
function handleRaise(data, tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    const player = table.players.find(p => p.name === data.playerName);
    if (!player || player.status !== "active") return;

    const raiseAmount = parseInt(data.amount);
    const minRaise = table.lastRaiseAmount || table.bigBlindAmount;

    if (raiseAmount < minRaise && raiseAmount !== player.tokens) {
        console.log(`Invalid raise amount ${raiseAmount}, minimum is ${minRaise}`);
        return;
    }

    const totalBet = player.currentBet + raiseAmount;
    player.tokens -= raiseAmount;
    player.currentBet = totalBet;
    player.totalContribution += raiseAmount;
    table.pot += raiseAmount;
    table.currentBet = totalBet;
    table.lastRaiseAmount = raiseAmount;
    table.playersWhoActed.clear(); // Reset for new betting round
    table.playersWhoActed.add(player.name);

    if (player.tokens === 0) player.allIn = true;

    broadcast({
        type: "updateActionHistory",
        action: `${player.name} raised to ${totalBet}`,
        tableId: tableId
    }, tableId);

    table.currentPlayerIndex = getNextPlayerIndex(table.currentPlayerIndex, tableId);
    broadcastGameState(tableId);
    bettingRound(tableId);
}

function handleCall(data, tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    const player = table.players.find(p => p.name === data.playerName);
    if (!player || player.status !== "active") return;

    const callAmount = table.currentBet - player.currentBet;
    const actualCall = Math.min(callAmount, player.tokens);

    player.tokens -= actualCall;
    player.currentBet += actualCall;
    player.totalContribution += actualCall;
    table.pot += actualCall;
    table.playersWhoActed.add(player.name);

    if (player.tokens === 0) player.allIn = true;

    broadcast({
        type: "updateActionHistory",
        action: `${player.name} called ${actualCall}`,
        tableId: tableId
    }, tableId);

    table.currentPlayerIndex = getNextPlayerIndex(table.currentPlayerIndex, tableId);
    broadcastGameState(tableId);
    bettingRound(tableId);
}

function handleFold(data, tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    const player = table.players.find(p => p.name === data.playerName);
    if (!player || player.status !== "active") return;

    player.status = "folded";
    table.playersWhoActed.add(player.name);

    broadcast({
        type: "updateActionHistory",
        action: `${player.name} folded`,
        tableId: tableId
    }, tableId);

    // Check if only one player remains
    const activePlayers = table.players.filter(p => p.status === "active");
    if (activePlayers.length === 1) {
        showdown(tableId);
        return;
    }

    table.currentPlayerIndex = getNextPlayerIndex(table.currentPlayerIndex, tableId);
    broadcastGameState(tableId);
    bettingRound(tableId);
}

function handleCheck(data, tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    const player = table.players.find(p => p.name === data.playerName);
    if (!player || player.status !== "active") return;

    if (player.currentBet < table.currentBet) {
        console.log("Cannot check when there's a bet");
        return;
    }

    table.playersWhoActed.add(player.name);
    broadcast({
        type: "updateActionHistory",
        action: `${player.name} checked`,
        tableId: tableId
    }, tableId);

    if (isBettingRoundOver(tableId)) {
        setTimeout(nextRound, 1000, tableId);
    } else {
        table.currentPlayerIndex = getNextPlayerIndex(table.currentPlayerIndex, tableId);
        broadcastGameState(tableId);
        bettingRound(tableId);
    }
}

function handleShowHide(data, tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    const player = table.players.find(p => p.name === data.playerName);
    if (!player) return;

    broadcast({
        type: "updateActionHistory",
        action: data.choice === "show" ? 
            `${player.name} showed their hand` :
            `${player.name} hid their hand`,
        tableId: tableId
    }, tableId);
}

function handlePlayerReady(data, tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    const player = table.players.find(p => p.name === data.playerName);
    if (player) player.isReady = true;

    // Start new hand if all ready
    if (table.players.every(p => p.isReady || p.tokens <= 0)) {
        startNewHand(tableId);
    }
}

function resetGame(tableId) {
    const table = tables.get(tableId);
    if (!table) return;

    // Reset player states
    table.players.forEach(player => {
        player.hand = [];
        player.currentBet = 0;
        player.totalContribution = 0;
        player.allIn = false;
        player.isReady = false;
        if (player.tokens > 0) {
            player.status = "active";
        } else {
            player.status = "inactive";
        }
    });

    // Start new hand
    startNewHand(tableId);
}

// Start server
server.listen(process.env.PORT || 8080, () => {
    console.log(`Server started on port ${server.address().port}`);
});


