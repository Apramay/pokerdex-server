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
let currentPlayerIndex = 0;
let currentBet = 0;
let round = 0;
let dealerIndex = 0;
let smallBlindAmount = 10;
let bigBlindAmount = 20;

const suits = ["Hearts", "Diamonds", "Clubs", "Spades"];
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const rankValues = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14 };

function createDeck() {
    const newDeck = [];
    for (const suit of suits) {
        for (const rank of ranks) {
            newDeck.push({ suit, rank });
        }
    }
    return newDeck;
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
    const hand = [];
    for (let i = 0; i < numCards; i++) {
        hand.push(dealCard(deck));
    }
    return hand;
}

function startNewHand() {
    deck = shuffleDeck(createDeck());
    players.forEach(player => {
        player.hand = dealHand(deck, 2);
        player.currentBet = 0;
        player.status = "active";
        player.allIn = false;
        sendPlayerHand(player);
    });
    tableCards = [];
    pot = 0;
    currentBet = 0;
    round = 0;
    setupBlinds();
}

function setupBlinds() {
    pot = 0;
    const smallBlindIndex = (dealerIndex + 1) % players.length;
    const bigBlindIndex = (dealerIndex + 2) % players.length;

    postBlind(players[smallBlindIndex], smallBlindAmount);
    postBlind(players[bigBlindIndex], bigBlindAmount);

    currentBet = bigBlindAmount;
    currentPlayerIndex = (bigBlindIndex + 1) % players.length;

    playersWhoActed.clear();
    broadcast({ type: "updatePlayers", players });
    broadcast({ type: "potUpdate", pot: pot });
    broadcast({ type: "roundUpdate", round: round, currentBet: currentBet });
    setTimeout(bettingRound, 500);
}

function postBlind(player, amount) {
    const blindAmount = Math.min(amount, player.chips);
    player.chips -= blindAmount;
    player.currentBet = blindAmount;
    pot += blindAmount;
    if (player.chips === 0) {
        player.allIn = true;
    }
    broadcast({ type: "message", message: `${player.name} posts ${blindAmount}.` });
}

function getNextPlayerIndex(currentIndex) {
    let nextIndex = (currentIndex + 1) % players.length;
    let attempts = 0;
    while ((players[nextIndex].status !== "active" || players[nextIndex].chips === 0 || players[nextIndex].allIn) && attempts < players.length) {
        if (nextIndex === currentIndex) {
            return -1;
        }
        nextIndex = (nextIndex + 1) % players.length;
        attempts++;
    }
    return nextIndex;
}

let playersWhoActed = new Set();

function bettingRound() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.chips > 0);

    if (activePlayers.length <= 1 || isBettingRoundOver()) {
        nextRound();
        return;
    }

    const player = players[currentPlayerIndex];

    if (playersWhoActed.has(player.name) && player.currentBet === currentBet) {
        currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
        bettingRound();
        return;
    }

    broadcast({ type: "message", message: `Waiting for player ${player.name} to act...` });
}

function isBettingRoundOver() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.chips > 0);
    if (activePlayers.length <= 1) return true;
    const allCalled = activePlayers.every(player => player.currentBet === currentBet || player.status === "folded");
    return allCalled && playersWhoActed.size >= activePlayers.length;
}

function nextRound() {
    currentBet = 0;
    players.forEach((player) => (player.currentBet = 0));
    playersWhoActed.clear();

    if (round === 0) {
        round++;
        tableCards = dealHand(deck, 3);
        broadcast({ type: "communityCards", cards: tableCards });
    } else if (round === 1) {
        round++;
        if (deck.length > 0) {
            tableCards.push(dealCard(deck));
            broadcast({ type: "communityCards", cards: tableCards });
        }
    } else if (round === 2) {
        round++;
        if (deck.length > 0) {
            tableCards.push(dealCard(deck));
            broadcast({ type: "communityCards", cards: tableCards });
        }
    } else if (round === 3) {
        showdown();
        return;
    }

    broadcast({ type: "roundUpdate", round: round, currentBet: currentBet });
    broadcast({ type: "updatePlayers", players });
    broadcast({ type: "potUpdate", pot: pot });
    setTimeout(bettingRound, 1000);
}

function showdown() {
    broadcast({ type: "message", message: "Showdown!" });
    let activePlayers = players.filter(p => p.status === "active" || p.allIn);
    let winners = determineWinners(activePlayers);

    winners.forEach(winner => {
        broadcast({ type: "message", message: `${winner.name} wins the hand!` });
    });

    distributePot();
    setTimeout(resetHand, 3000);
}

function distributePot() {
    let eligiblePlayers = players.filter(p => p.status === "active" || p.allIn);
    eligiblePlayers.sort((a, b) => a.currentBet - b.currentBet);

    let totalPot = pot;
    let sidePots = [];

    while (eligiblePlayers.length > 0) {
        const minBet = eligiblePlayers[0].currentBet;
        let potPortion = 0;

        eligiblePlayers.forEach(player => {
            potPortion += Math.min(minBet, player.currentBet);
            player.currentBet -= Math.min(minBet, player.currentBet);
        });

        sidePots.push({ players: [...eligiblePlayers], amount: potPortion });
        eligiblePlayers = eligiblePlayers.filter(p => p.currentBet > 0);
    }

    sidePots.forEach(sidePot => {
        const winners = determineWinners(sidePot.players);
        const splitPot = Math.floor(sidePot.amount / winners.length);

        winners.forEach(winner => {
            winner.chips += splitPot;
            broadcast({ type: "message", message: `${winner.name} wins ${splitPot} from a side pot.` });
        });
    });

    let remainingPot = totalPot - sidePots.reduce((acc, sp) => acc + sp.amount, 0);
    if (remainingPot > 0) {
        let mainWinners = determineWinners(players.filter(p =>p.status === "active"));
        let splitPot = Math.floor(remainingPot / mainWinners.length);
        mainWinners.forEach(winner => {
            winner.chips += splitPot;
            broadcast({ type: "message", message: `${winner.name} wins ${splitPot} from the main pot.` });
        });
    }

    pot = 0;
    broadcast({ type: "potUpdate", pot: pot });
}

function determineWinners(playerList) {
    let eligiblePlayers = playerList.filter(player => player.status !== "folded");

    if (eligiblePlayers.length === 1) {
        return eligiblePlayers;
    }

    const playerHands = eligiblePlayers.map(player => ({
        player,
        hand: evaluateHand(player.hand.concat(tableCards)),
    }));

    playerHands.sort((a, b) => b.hand.value - a.hand.value);

    const bestHandValue = playerHands[0].hand.value;
    return playerHands
        .filter(playerHand => playerHand.hand.value === bestHandValue)
        .map(playerHand => playerHand.player);
}

function resetHand() {
    round = 0;
    tableCards = [];
    players.forEach(player => {
        player.hand = [];
        player.status = "active";
        player.allIn = false;
        player.currentBet = 0;
    });
    dealerIndex = (dealerIndex + 1) % players.length;
    startNewHand();
}

function sendPlayerHand(player) {
    wss.clients.forEach(client => {
        if (client.player === player && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "playerHand", playerName: player.name, hand: player.hand }));
        }
    });
}

// Hand evaluation functions:
function evaluateHand(cards) {
    const allCards = cards.sort((a, b) => rankValues[a.rank] - rankValues[b.rank]);
    const ranks = allCards.map(c => rankValues[c.rank]);
    const suits = allCards.map(c => c.suit);

    if (isRoyalFlush(allCards, ranks, suits)) return { value: 10, handName: "Royal Flush" };
    if (isStraightFlush(allCards, ranks, suits)) return { value: 9, handName: "Straight Flush", highCard: getStraightHighCard(ranks) };
    if (isFourOfAKind(ranks)) return { value: 8, handName: "Four of a Kind", quadRank: getQuadRank(ranks), kicker: getKicker(ranks, getQuadRank(ranks)) };
    if (isFullHouse(ranks)) return { value: 7, handName: "Full House", tripsRank: getTripsRank(ranks), pairRank: getPairRank(ranks) };
    if (isFlush(suits)) return { value: 6, handName: "Flush", highCard: getFlushHighCard(ranks, suits) };
    if (isStraight(ranks)) return { value: 5, handName: "Straight", highCard: getStraightHighCard(ranks) };
    if (isThreeOfAKind(ranks)) return { value: 4, handName: "Three of a Kind", tripsRank: getTripsRank(ranks), kickers: getKickers(ranks, getTripsRank(ranks)) };
    if (isTwoPair(ranks)) return { value: 3, handName: "Two Pair", highPairs: getTwoPairHighCards(ranks), kicker: getKicker(ranks, getTwoPairHighCards(ranks)[0], getTwoPairHighCards(ranks)[1]) };
    if (isOnePair(ranks)) return { value: 2, handName: "One Pair", pairRank: getPairRank(ranks), kickers: getKickers(ranks, getPairRank(ranks)) };
    return { value: 1, handName: "High Card", highCard: ranks[6] };
}

// Helper functions for hand evaluation:
function isRoyalFlush(cards, ranks, suits) {
    if (!isFlush(suits)) return false;
    const royalRanks = [10, 11, 12, 13, 14];
    return royalRanks.every(rank => ranks.includes(rank));
}

function isStraightFlush(cards, ranks, suits) {
    return isFlush(suits) && isStraight(ranks);
}

function isFourOfAKind(ranks) {
    return ranks.some(rank => ranks.filter(r => r === rank).length === 4);
}

function isFullHouse(ranks) {
    return isThreeOfAKind(ranks) && isOnePair(ranks);
}

function isFlush(suits) {
    return suits.every(suit => suit === suits[0]);
}

function isStraight(ranks) {
    for (let i = 0; i < ranks.length - 4; i++) {
        if (ranks[i + 1] === ranks[i] + 1 && ranks[i + 2] === ranks[i] + 2 && ranks[i + 3] === ranks[i] + 3 && ranks[i + 4] === ranks[i] + 4) {
            return true;
        }
    }
    if (ranks[3] === 5 && ranks[4] === 10 && ranks[5] === 11 && ranks[6] === 12 && ranks[7] === 13) {
        return true;
    }
    return false;
}

function isThreeOfAKind(ranks) {
    return ranks.some(rank => ranks.filter(r => r === rank).length === 3);
}

function isTwoPair(ranks) {
    const pairs = ranks.filter((rank, index) => ranks.indexOf(rank) !== index).sort((a, b) => b - a);
    return new Set(pairs).size === 2;
}

function isOnePair(ranks) {
    return ranks.some((rank, index) => ranks.indexOf(rank) !== index);
}

function getQuadRank(ranks) {
    return ranks.find(rank => ranks.filter(r => r === rank).length === 4);
}

function getTripsRank(ranks) {
    return ranks.find(rank => ranks.filter(r => r === rank).length === 3);
}

function getPairRank(ranks) {
    return ranks.find((rank, index) => ranks.indexOf(rank) !== index);
}

function getKicker(ranks, ...excludeRanks) {
    return ranks.filter(rank => !excludeRanks.includes(rank)).sort((a, b) => b - a)[0];
}

function getKickers(ranks, excludeRank) {
    return ranks.filter(rank => rank !== excludeRank).sort((a, b) => b - a).slice(0, 2);
}

function getStraightHighCard(ranks) {
    for (let i = ranks.length - 5; i >= 0; i--) {
        if (ranks[i + 1] === ranks[i] + 1 && ranks[i + 2] === ranks[i] + 2 && ranks[i + 3] === ranks[i] + 3 && ranks[i + 4] === ranks[i] + 4) {
            return ranks[i + 4];
        }
    }
    if (ranks[3] === 5 && ranks[4] === 10 && ranks[5] === 11 && ranks[6] === 12 && ranks[7] === 13) {
        return 13;
    }
    return 0;
}

function getFlushHighCard(ranks, suits) {
    const flushSuit = suits.find((suit, index, arr) => arr.filter(s => s === suit).length >= 5);
    const flushRanks = ranks.filter((_, index) => suits[index] === flushSuit).sort((a, b) => b - a);
    return flushRanks[0];
}

function getTwoPairHighCards(ranks) {
    const pairs = ranks.filter((rank, index) => ranks.indexOf(rank) !== index).sort((a, b) => b - a);
    return [pairs[0], pairs[2]];
}

wss.on("connection", (ws) => {
    console.log("✅ New player connected");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "join") {
                if (!players.some(player => player.name === data.name)) {
                    const newPlayer = { name: data.name, chips: 1000, hand: [], currentBet: 0, status: "active", allIn: false };
                    players.push(newPlayer);
                    ws.player = newPlayer;
                    broadcast({ type: "updatePlayers", players });
                }
            }

            if (data.type === "startGame") {
                if (players.length >= 2) {
                    dealerIndex = Math.floor(Math.random() * players.length);
                    startNewHand();
                } else {
                    broadcast({ type: "message", message: "Need at least two players to start." });
                }
            }

            if (data.type === "fold") {
                const player = players.find(p => p.name === ws.player.name);
                if (player) {
                    player.status = "folded";
                    playersWhoActed.add(player.name);
                    broadcast({ type: "message", message: `${player.name} folds.` });
                    broadcast({ type: "updatePlayers", players });
                    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
                    bettingRound();
                }
            }

            if (data.type === "call") {
                const player = players.find(p => p.name === ws.player.name);
                if (player) {
                    let amount = Math.min(currentBet - player.currentBet, player.chips);
                    player.chips -= amount;
                    player.currentBet += amount;
                    pot += amount;
                    playersWhoActed.add(player.name);
                    broadcast({ type: "message", message: `${player.name} calls.` });
                    broadcast({ type: "potUpdate", pot: pot });
                    broadcast({ type: "updatePlayers", players });
                    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
                    bettingRound();
                }
            }

            if (data.type === "bet") {
                const player = players.find(p => p.name === ws.player.name);
                if (player) {
                    if (data.amount > player.chips || data.amount < currentBet) {
                        broadcast({ type: "message", message: "Invalid bet." });
                        return;
                    }
                    player.chips -= data.amount;
                    pot += data.amount;
                    player.currentBet = data.amount;
                    currentBet = data.amount;
                    playersWhoActed.add(player.name);
                    broadcast({ type: "message", message: `${player.name} bets ${data.amount}.` });
                    broadcast({ type: "potUpdate", pot: pot });
                    broadcast({ type: "updatePlayers", players });
                    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
                    bettingRound();
                }
            }

            if (data.type === "raise") {
                const player = players.find(p => p.name === ws.player.name);
                if (player) {
                    if (data.amount <= currentBet || data.amount > player.chips) {
                        broadcast({ type: "message", message: "Invalid raise." });
                        return;
                    }
                    const totalBet = data.amount;
                    player.chips -= totalBet - player.currentBet;
                    pot += totalBet - player.currentBet;
                    player.currentBet = totalBet;
                    currentBet = totalBet;
                    playersWhoActed.add(player.name);
                    broadcast({ type: "message", message: `${player.name} raises to ${totalBet}.` });
                    broadcast({ type: "potUpdate", pot: pot });
                    broadcast({ type: "updatePlayers", players });
                    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
                    bettingRound();
                }
            }

            if (data.type === "check") {
                const player = players.find(p => p.name === ws.player.name);
                if (player) {
                    if (currentBet === 0 || player.currentBet === currentBet) {
                        playersWhoActed.add(player.name);
                        broadcast({ type: "message", message: `${player.name} checks.` });
                        broadcast({ type: "updatePlayers", players });
                        currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
                        bettingRound();
                    } else {
                        broadcast({ type: "message", message: "You cannot check when there is a bet." });
                    }
                }
            }
        } catch (error) {
            console.error("❌ Error handling message:", error);
        }
    });

    ws.on("close", () => {
        console.log("🚪 A player disconnected");
        players = players.filter(player => player.name !== ws.player?.name);
        broadcast({ type: "updatePlayers", players });
    });
});

function broadcast(data) {
    const jsonData = JSON.stringify(data);
    console.log("📢 Broadcasting to all players:", jsonData);

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(jsonData);
        }
    });
}

server.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});
