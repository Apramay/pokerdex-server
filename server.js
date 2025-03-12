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
    const hand = [];
    for (let i = 0; i < numCards; i++) {
        hand.push(dealCard(deck));
    }
    return hand;
}

function displayCard(card) {
    const rank = card.rank;
    const suit = card.suit;
    const imageName = `${rank}_of_${suit}.png`;

    return `<img src="./cards/${imageName}" alt="${rank} of ${suit}" onerror="this.onerror=null; this.src='./cards/default.png';">`;
}


function displayHand(hand) {
    return hand.map(displayCard).join(", ");
}

let players = [];
let tableCards = [];
let pot = 0;
let currentPlayerIndex = 0;
let deckForGame = [];
let currentBet = 0;
let round = 0;
let smallBlindAmount = 10;
let bigBlindAmount = 20;
let dealerIndex = 0;

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
        players,
        tableCards,
        pot,
        currentBet,
        round,
        currentPlayerIndex
    });
}

function createPlayer(name, tokens) {
    return { name: name, tokens: tokens, hand: [], currentBet: 0, status: "active", allIn: false };
}

function startGame(playerNames, initialTokens) {
    deckForGame = shuffleDeck(createDeck());
    players = playerNames.map((name) => createPlayer(name, initialTokens));
    dealerIndex = Math.floor(Math.random() * players.length);
    startNewHand();
}

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
    updateUI();
    setTimeout(bettingRound, 500);
}


function postBlind(player, amount) {
    const blindAmount = Math.min(amount, player.tokens);
    player.tokens -= blindAmount;
    player.currentBet = blindAmount;
    pot += blindAmount;
    if (player.tokens === 0) {
        player.allIn = true;
    }
    displayMessage(`${player.name} posts ${blindAmount}.`);
}

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

let playersWhoActed = new Set(); // Track players who acted

function bettingRound() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);

    if (activePlayers.length <= 1) {
        console.log("Only one player left, moving to next round.");
        setTimeout(nextRound, 1000);
        return;
    }

    if (isBettingRoundOver()) {
        console.log("All players have acted. Betting round is over.");
        setTimeout(nextRound, 1000);
        return;
    }

    const player = players[currentPlayerIndex];

    // If this player has already acted, move to the next one
    if (playersWhoActed.has(player.name) && player.currentBet === currentBet) {
        currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
        bettingRound();
        return;
    }

    console.log(`Waiting for player ${player.name} to act...`);
    playerAction(player);
}

function isBettingRoundOver() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0);

    if (activePlayers.length <= 1) {
        return true; // If only one player remains, the round ends.
    }

    // Ensure all active players have matched the current bet
    const allCalled = activePlayers.every(player => player.currentBet === currentBet || player.status === "folded");

    // If all active players have called or folded, the round is over
    if (allCalled && playersWhoActed.size >= activePlayers.length) {
        return true;
    }

    return false;
}


function bigBlindCheckRaiseOption() {
    let bigBlindPlayer = players[((dealerIndex + 2) % players.length)];

    if (currentBet === bigBlindAmount) { 
        // No raises occurred, so big blind can check
        displayMessage(`${bigBlindPlayer.name}, you can check or bet.`);
        checkBtn.style.display = "inline";
    } else {
        // Someone raised, so big blind must call or fold
        displayMessage(`${bigBlindPlayer.name}, you must call or fold.`);
        checkBtn.style.display = "none";
    }

    foldBtn.style.display = "inline";
    callBtn.style.display = "inline";
    betBtn.style.display = "inline";
    raiseBtn.style.display = "inline";

    checkBtn.onclick = () => {
        check(bigBlindPlayer);
        updateUI();
        bettingRound();
    };

    callBtn.onclick = () => {
        call(bigBlindPlayer);
        updateUI();
        bettingRound();
    };

    raiseBtn.onclick = () => {
        const amount = parseInt(betInput.value);
        if (!isNaN(amount)) {
            raise(bigBlindPlayer, amount);
            updateUI();
            bettingRound();
        } else {
            displayMessage("Invalid raise amount.");
        }
    };
}

function playerAction(player) {
    displayMessage(`${player.name}, your turn.`);

    // Disable check if there's a bet to call
    if (currentBet > 0 && player.currentBet < currentBet) {
        checkBtn.style.display = "none"; 
    } else {
        checkBtn.style.display = "inline";
    }

    foldBtn.style.display = "inline";
    callBtn.style.display = currentBet > 0 ? "inline" : "none";
    betBtn.style.display = currentBet === 0 ? "inline" : "none";
    raiseBtn.style.display = currentBet > 0 ? "inline" : "none";

    foldBtn.onclick = () => { handleAction(() => fold(player)); };
    callBtn.onclick = () => { handleAction(() => call(player)); };
    betBtn.onclick = () => {
        const amount = parseInt(betInput.value);
        if (!isNaN(amount)) { handleAction(() => bet(player, amount)); } else { displayMessage("Invalid bet amount."); }
    };
    raiseBtn.onclick = () => {
        const amount = parseInt(betInput.value);
        if (!isNaN(amount)) { handleAction(() => raise(player, amount)); } else { displayMessage("Invalid raise amount."); }
    };
    checkBtn.onclick = () => { handleAction(() => check(player)); };
}
function startFlopBetting() {
    currentBet = 0; // Reset betting amount

    // Betting starts from Small Blind
    currentPlayerIndex = (dealerIndex + 1) % players.length;
    playersWhoActed.clear();

    // Update action buttons: Only Check or Bet allowed
    checkBtn.style.display = "inline";
    betBtn.style.display = "inline";
    foldBtn.style.display = "none";
    callBtn.style.display = "none";
    raiseBtn.style.display = "none";

    bettingRound();
}


function handleAction(action) {
    action();
    playersWhoActed.add(players[currentPlayerIndex].name); // Mark player as having acted
    updateUI();
    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
    bettingRound();
}


function fold(playerName) {
    let player = players.find(p => p.name === playerName);
    if (!player) return;

    player.status = "folded";
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


function check(playerName) {
    let player = players.find(p => p.name === playerName);
    if (!player || currentBet > 0) return;

    broadcastGameState();
    nextPlayerTurn();
}
function nextPlayerTurn() {
    currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
    if (currentPlayerIndex === -1) {
        nextRound();
    } else {
        broadcastGameState();
    }
}
function getNextPlayerIndex(currentIndex) {
    let nextIndex = (currentIndex + 1) % players.length;
    let attempts = 0;
    while ((players[nextIndex].status !== "active" || players[nextIndex].tokens === 0) && attempts < players.length) {
        if (nextIndex === currentIndex) {
            return -1;
        }
        nextIndex = (nextIndex + 1) % players.length;
        attempts++;
    }
    return nextIndex;
}


function nextRound() {
    console.log("nextRound() called. Current round:", round);

    currentBet = 0;
    players.forEach((player) => (player.currentBet = 0));
    playersWhoActed.clear(); // Reset players who acted

    if (round === 0) {
        round++;
        tableCards = dealHand(deckForGame, 3);
        displayMessage(`Flop: ${displayHand(tableCards)}`);

        // Betting round starts from Small Blind after the flop
        currentPlayerIndex = (dealerIndex + 1) % players.length;
    } else if (round === 1) {
        round++;
        if (deckForGame.length > 0) {
            tableCards.push(dealCard(deckForGame));
            displayMessage(`Turn: ${displayCard(tableCards[3])}`);
        }
    } else if (round === 2) {
        round++;
        if (deckForGame.length > 0) {
            tableCards.push(dealCard(deckForGame));
            displayMessage(`River: ${displayCard(tableCards[4])}`);
        }
    } else if (round === 3) {
        showdown();
        return;
    }

    updateUI();
    setTimeout(startFlopBetting, 1000); // Ensure betting starts after UI updates
}
function startFlopBetting() {
    currentBet = 0; // Reset betting amount

    // Betting starts from Small Blind
    currentPlayerIndex = (dealerIndex + 1) % players.length;
    playersWhoActed.clear();

    bettingRound();
}




function showdown() {
    displayMessage("Showdown!");

    let activePlayers = players.filter(p => p.status === "active" || p.allIn); // Only players still in hand
    let winners = determineWinners(activePlayers);

    // Highlight the winner(s) in UI
    winners.forEach(winner => {
        displayMessage(`${winner.name} wins the hand!`);
    });

    distributePot();
    updateUI();
    setTimeout(resetHand, 3000); // Wait before resetting for new hand
}


function distributePot() {
    let eligiblePlayers = players.filter(p => p.status === "active" || p.allIn);
    eligiblePlayers.sort((a, b) => a.currentBet - b.currentBet);

    let totalPot = pot;
    let sidePots = [];

    // Create side pots for players who went all-in
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

    // Award each side pot to the correct winners
    sidePots.forEach(sidePot => {
        const winners = determineWinners(sidePot.players);
        const splitPot = Math.floor(sidePot.amount / winners.length);

        winners.forEach(winner => {
            winner.tokens += splitPot;
            displayMessage(`${winner.name} wins ${splitPot} from a side pot.`);
        });
    });

    // Award any remaining main pot chips
    let remainingPot = totalPot - sidePots.reduce((acc, sp) => acc + sp.amount, 0);
    if (remainingPot > 0) {
        let mainWinners = determineWinners(players.filter(p => p.status === "active"));
        let splitPot = Math.floor(remainingPot / mainWinners.length);
        mainWinners.forEach(winner => {
            winner.tokens += splitPot;
            displayMessage(`${winner.name} wins ${splitPot} from the main pot.`);
        });
    }
}


function determineWinners(playerList) {
    // Exclude folded players
    let eligiblePlayers = playerList.filter(player => player.status !== "folded");

    if (eligiblePlayers.length === 1) {
        return eligiblePlayers; // Only one player left, they win by default
    }

    const playerHands = eligiblePlayers.map(player => ({
        player,
        hand: evaluateHand(player.hand.concat(tableCards)),
    }));

    playerHands.sort((a, b) => b.hand.value - a.hand.value); // Sort by hand strength

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
    });
    dealerIndex = (dealerIndex + 1) % players.length;
    startNewHand();
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

// UI functions

const playersDiv = document.getElementById("players");
const communityCardsDiv = document.getElementById("community-cards");
const potDiv = document.getElementById("pot");
const messageDiv = document.getElementById("message");
const foldBtn = document.getElementById("fold-btn");
const checkBtn = document.getElementById("check-btn");
const callBtn = document.getElementById("call-btn");
const betInput = document.getElementById("bet-input");
const betBtn = document.getElementById("bet-btn");
const raiseBtn = document.getElementById("raise-btn");
const restartBtn = document.getElementById("restart-btn");
const playerNameInput = document.getElementById("player-name-input");
const addPlayerBtn = document.getElementById("add-player-btn");
const startGameBtn = document.getElementById("start-game-btn");

function updateUI(playersFromWebSocket = null) {
    // Use WebSocket data if available; otherwise, use local players list
    if (playersFromWebSocket) {
        players = playersFromWebSocket; 
    }

    console.log("🎨 Updating players UI with:", players);
 const playersDiv = document.getElementById("players");
    if (!playersDiv) {
        console.error("❌ Players list element not found!");
        return;
    }
    playersDiv.innerHTML = "";
    players.forEach((player, index) => {
        let indicators = "";
        if (index === dealerIndex) indicators += "D ";
        if (index === (dealerIndex + 1) % players.length) indicators += "SB ";
        if (index === (dealerIndex + 2) % players.length) indicators += "BB ";

        playersDiv.innerHTML += `<div class="player">${indicators}${player.name}: Tokens: ${player.tokens}<br>Hand: ${player.status === "active" ? displayHand(player.hand) : "Folded"}</div>`;
    });

    communityCardsDiv.innerHTML = "";
    tableCards.forEach(card => {
        communityCardsDiv.innerHTML += `<div>${displayCard(card)}</div>`;
    });


    communityCardsDiv.innerHTML = "";
    tableCards.forEach(card => {
        communityCardsDiv.innerHTML += `<div>${displayCard(card)}</div>`;
    });

    potDiv.textContent = `Pot: ${pot}`;
    messageDiv.textContent = "";
    document.getElementById("round").textContent = "Round: " + round;
    document.getElementById("currentBet").textContent = "Current Bet: " + currentBet;
}


function displayMessage(message) {
    messageDiv.textContent = message;
}

addPlayerBtn.onclick = function() {
    const playerName = playerNameInput.value;
    if (playerName) {
        players.push(createPlayer(playerName, 1000));
        playerNameInput.value = "";
        updateUI();
    }
};

startGameBtn.onclick = function() {
    if (players.length >= 2) {
        startGame(players.map(p => p.name), 1000);
        updateUI();
    } else {
        displayMessage("You need at least two players to start.");
    }
};

restartBtn.onclick = function(){
    players = [];
    tableCards = [];
    pot = 0;
    currentPlayerIndex = 0;
    deckForGame = [];
    currentBet = 0;
    round = 0;
    playerNameInput.value = "";
    updateUI();
};
wss.on("connection", (ws) => {
    console.log("✅ New player connected");
    ws.send(JSON.stringify({ type: "updatePlayers", players.map(({ ws, ...player }) => player) }));

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "join") {
                if (!players.some(player => player.name === data.name)) {
                    players.push({ name: data.name, tokens: 1000, status: "active", currentBet: 0, ws });
                    broadcast({ type: "updatePlayers", players.map(({ ws, ...player }) => player) });
                }
            }

            if (data.type === "startGame") {
                startGame();
            }

            if (data.type === "bet") {
                bet(data.name, data.amount);
            }

            if (data.type === "raise") {
                raise(data.name, data.amount);
            }

            if (data.type === "call") {
                call(data.name);
            }

            if (data.type === "fold") {
                fold(data.name);
            }

            if (data.type === "check") {
                check(data.name);
            }

            if (data.type === "nextRound") {
                nextRound();
            }
        } catch (error) {
            console.error("❌ Error handling message:", error);
        }
    });

    ws.on("close", () => {
        console.log("🚪 A player disconnected");
        players = players.filter(player => player.ws !== ws);
        if (players.length === 1) {
            console.log(`${players[0].name} wins by default!`);
            resetGame();
        }
        broadcastGameState();
    });
});

server.listen(3000, () => {
    console.log("🚀 Server running on port 3000");
});
