const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public')); //  Serve static files

const suits = ["Hearts", "Diamonds", "Clubs", "Spades"]; //  Card constants [cite: 1]
const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]; //  Card constants [cite: 1]
const rankValues = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14 }; //  Card constants [cite: 2]

function createDeck() {
    const deck =;
    for (const suit of suits) {
        for (const rank of ranks) {
            deck.push({ suit, rank }); //  Push card object to deck
        }
    }
    return deck;
}

function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]]; //  Swap elements
    }
    return deck;
}

function dealCard(deck) {
    return deck.pop(); //  Remove and return last card
}

function dealHand(deck, numCards) {
    const hand =;
    for (let i = 0; i < numCards; i++) {
        hand.push(dealCard(deck)); //  Deal cards to hand
    }
    return hand;
}

function createPlayer(name, tokens) {
    return { name: name, tokens: tokens, hand:, currentBet: 0, status: "active", allIn: false }; //  Player object [cite: 14]
}

let players =;
let tableCards =;
let pot = 0;
let currentPlayerIndex = 0;
let deckForGame =;
let currentBet = 0;
let round = 0;
let smallBlindAmount = 10;
let bigBlindAmount = 20;
let dealerIndex = 0;

function startGame(playerNames, initialTokens) {
    deckForGame = shuffleDeck(createDeck());
    players = playerNames.map((name) => createPlayer(name, initialTokens)); //  Create players [cite: 15]
    dealerIndex = Math.floor(Math.random() * players.length); //  Random dealer index [cite: 16]
    startNewHand();
}

function startNewHand() {
    deckForGame = shuffleDeck(createDeck()); //  Shuffle a new deck [cite: 16, 17]
    players.forEach(player => {
        player.hand = dealHand(deckForGame, 2); //  Deal 2 cards to each player [cite: 17]
        player.currentBet = 0;
        player.status = "active";
        player.allIn = false;
    });
    tableCards =; //  Clear table cards [cite: 18]
    pot = 0; //  Reset pot [cite: 18]
    currentBet = 0; //  Reset current bet [cite: 18]
    round = 0; //  Reset round [cite: 18]
    setupBlinds();
}

function setupBlinds() {
    pot = 0;
    const smallBlindIndex = (dealerIndex + 1) % players.length; //  Determine small blind index [cite: 19]
    const bigBlindIndex = (dealerIndex + 2) % players.length; //  Determine big blind index [cite: 20]
    postBlind(players[smallBlindIndex], smallBlindAmount); //  Post small blind [cite: 20]
    postBlind(players[bigBlindIndex], bigBlindAmount); //  Post big blind [cite: 20]
    currentBet = bigBlindAmount; //  Set current bet to big blind [cite: 20]
    // Start with Under The Gun (UTG), which is the player after the big blind
    currentPlayerIndex = (bigBlindIndex + 1) % players.length; //  Set current player index [cite: 21]
    playersWhoActed.clear(); // Reset players who acted [cite: 22]
    sendGameStateToAll();
    setTimeout(bettingRound, 500); //  Start betting round [cite: 22]
}

function postBlind(player, amount) {
    const blindAmount = Math.min(amount, player.tokens);
    player.tokens -= blindAmount; //  Deduct blind amount [cite: 23]
    player.currentBet = blindAmount; //  Set player's current bet [cite: 23]
    pot += blindAmount; //  Add blind to pot [cite: 24]
    if (player.tokens === 0) {
        player.allIn = true; //  Player is all-in [cite: 24, 25]
    }
    sendGameStateToAll(`${player.name} posts ${blindAmount}.`);
}

function getNextPlayerIndex(currentIndex) {
    let nextIndex = (currentIndex + 1) % players.length; //  Get next player's index [cite: 25, 26, 27]
    let attempts = 0;
    while ((players[nextIndex].status !== "active" || players[nextIndex].tokens === 0 || players[nextIndex].allIn) && attempts < players.length) {
        if (nextIndex === currentIndex) {
            return -1; //  No eligible player found [cite: 26, 27]
        }
        nextIndex = (nextIndex + 1) % players.length;
        attempts++;
    }
    return nextIndex;
}

let playersWhoActed = new Set(); //  Track players who have acted [cite: 28, 29]
// Track players who acted
function bettingRound() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0); //  Get active players [cite: 29, 30]
    if (activePlayers.length <= 1) {
        console.log("Only one player left, moving to next round.");
        setTimeout(nextRound, 1000); //  Move to next round [cite: 31]
        return;
    }
    if (isBettingRoundOver()) {
        console.log("All players have acted. Betting round is over.");
        setTimeout(nextRound, 1000); //  Move to next round [cite: 32]
        return;
    }
    const player = players[currentPlayerIndex]; //  Get current player [cite: 33, 34]
    // If this player has already acted, move to the next one
    if (playersWhoActed.has(player.name) && player.currentBet === currentBet) {
        currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex); //  Get next player [cite: 33, 34]
        bettingRound();
        return;
    }
    console.log(`Waiting for player ${player.name} to act...`);
    sendPlayerActionOptions(player); //  Send action options to player
}

function isBettingRoundOver() {
    let activePlayers = players.filter(p => p.status === "active" && !p.allIn && p.tokens > 0); //  Get active players [cite: 35, 36, 37, 38]
    if (activePlayers.length <= 1) {
        return true; //  Round ends if only one player remains [cite: 36, 37]
        // If only one player remains, the round ends.
    }
    // Ensure all active players have matched the current bet
    const allCalled = activePlayers.every(player => player.currentBet === currentBet || player.status === "folded");
    // If all active players have called or folded, the round is over
    if (allCalled && playersWhoActed.size >= activePlayers.length) {
        return true; //  Round is over [cite: 38]
    }
    return false;
}

function sendPlayerActionOptions(player) {
    const actionOptions = {
        type: 'actionOptions',
        canCheck: false,
        canCall: false,
        canBet: false,
        canRaise: false
    };

    if (currentBet > 0 && player.currentBet < currentBet) { //  Can't check if there's a bet to call [cite: 49, 50, 51, 52]
        actionOptions.canCall = true;
    } else {
        actionOptions.canCheck = true;
    }

    if (currentBet === 0) { //  Can bet if no current bet [cite: 51, 52]
        actionOptions.canBet = true;
    }

    if (currentBet > 0) { //  Can raise if there's a current bet [cite: 52]
        actionOptions.canRaise = true;
    }

    sendToPlayer(player, JSON.stringify(actionOptions));
}

function startFlopBetting() {
    currentBet = 0; //  Reset betting amount [cite: 57, 58, 59, 60]
    // Betting starts from Small Blind
    currentPlayerIndex = (dealerIndex + 1) % players.length;
    playersWhoActed.clear();
    sendGameStateToAll();
    bettingRound();
}

function nextRound() {
    console.log("nextRound() called. Current round:", round);
    currentBet = 0;
    players.forEach((player) => (player.currentBet = 0));
    playersWhoActed.clear(); // Reset players who acted [cite: 74, 75, 76, 77, 78, 79, 80, 81, 82]
    if (round === 0) {
        round++;
        tableCards = dealHand(deckForGame, 3); //  Deal 3 cards for flop [cite: 76]
        sendGameStateToAll(`Flop: ${displayHand(tableCards)}`);
        // Betting round starts from Small Blind after the flop
        currentPlayerIndex = (dealerIndex + 1) % players.length;
    } else if (round === 1) {
        round++;
        if (deckForGame.length > 0) {
            tableCards.push(dealCard(deckForGame)); //  Deal 1 card for turn [cite: 78]
            sendGameStateToAll(`Turn: ${displayCard(tableCards[3])}`);
        }
    } else if (round === 2) {
        round++;
        if (deckForGame.length > 0) {
            tableCards.push(dealCard(deckForGame)); //  Deal 1 card for river [cite: 80]
            sendGameStateToAll(`River: ${displayCard(tableCards[4])}`);
        }
    } else if (round === 3) {
        showdown(); //  Showdown after river [cite: 81]
        return;
    }
    sendGameStateToAll();
    setTimeout(startFlopBetting, 1000); // Ensure betting starts after UI updates [cite: 82]
}

function showdown() {
    sendGameStateToAll("Showdown!");
    let activePlayers = players.filter(p => p.status === "active" || p.allIn); //  Get active players [cite: 84, 85, 86, 87]
    // Only players still in hand
    let winners = determineWinners(activePlayers); //  Determine winners [cite: 85, 86, 87]
    // Highlight the winner(s) in UI
    winners.forEach(winner => {
        sendGameStateToAll(`${winner.name} wins the hand!`); //  Send winner message [cite: 86, 87]
    });
    distributePot(); //  Distribute pot [cite: 87]
    sendGameStateToAll();
    setTimeout(resetHand, 3000); // Wait before resetting for new hand [cite: 87]
}

function distributePot() {
    let eligiblePlayers = players.filter(p => p.status === "active" || p.allIn); //  Get eligible players [cite: 87, 88, 89, 90, 91, 92, 93, 94, 95, 96]
    eligiblePlayers.sort((a, b) => a.currentBet - b.currentBet);
    let totalPot = pot;
    let sidePots =;
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
            sendGameStateToAll(`${winner.name} wins ${splitPot} from a side pot.`);
        });
    });
    // Award any remaining main pot chips
    let remainingPot = totalPot - sidePots.reduce((acc, sp) => acc + sp.amount, 0);
    if (remainingPot > 0) {
        let mainWinners = determineWinners(players.filter(p => p.status === "active"));
        let splitPot = Math.floor(remainingPot / mainWinners.length);
        mainWinners.forEach(winner => {
            winner.tokens += splitPot;
            sendGameStateToAll(`${winner.name} wins ${splitPot} from the main pot.`);
        });
    }
}

function determineWinners(playerList) {
    // Exclude folded players
    let eligiblePlayers = playerList.filter(player => player.status !== "folded"); //  Get eligible players [cite: 96, 97, 98, 99, 100, 101, 102, 103]
    if (eligiblePlayers.length === 1) {
        return eligiblePlayers; //  Only one player left, they win by default [cite: 97, 98, 99, 100]
        // Only one player left, they win by default
    }
    const playerHands = eligiblePlayers.map(player => ({
        player,
        hand: evaluateHand(player.hand.concat(tableCards)),
    }));
    playerHands.sort((a, b) => b.hand.value - a.hand.value); // Sort by hand strength [cite: 99, 100]
    const bestHandValue = playerHands[0].hand.value;
    return playerHands
        .filter(playerHand => playerHand.hand.value === bestHandValue)
        .map(playerHand => playerHand.player);
}

function resetHand() {
    round = 0; //  Reset round [cite: 101, 102, 103]
    tableCards =; //  Clear table cards [cite: 101, 102, 103]
    players.forEach(player => {
        player.hand =; //  Clear player hands [cite: 102, 103]
        player.status ="active";
        player.allIn = false;
    });
    dealerIndex = (dealerIndex + 1) % players.length; //  Move dealer button
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

function sendGameStateToAll(message) {
    const gameState = {
        type: 'gameState',
        gameState: {
            players: players.map(p => ({ ...p, hand: p.status === "active" ? p.hand :})), //  Hide folded hands
            tableCards: tableCards,
            pot: pot,
            currentPlayerIndex: currentPlayerIndex,
            dealerIndex: dealerIndex,
            currentBet: currentBet,
            round: round
        },
        message: message
    };
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(gameState));
        }
    });
}

function sendToPlayer(player, message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.player === player) {
            client.send(message);
        }
    });
}

wss.on('connection', ws => {
    console.log('Client connected');

    ws.on('message', message => {
        try {
            const data = JSON.parse(message);
            // Handle different message types based on 'data.type'
            if (data.type === 'addPlayer') {
                const playerName = data.playerName;
                if (playerName) {
                    const player = createPlayer(playerName, 1000);
                    players.push(player);
                    ws.player = player; //  Associate player with connection
                    sendGameStateToAll();
                }
            } else if (data.type === 'startGame') {
                if (players.length >= 2) {
                    startGame(players.map(p => p.name), 1000);
                    sendGameStateToAll();
                } else {
                    sendGameStateToAll("You need at least two players to start.");
                }
            } else if (data.type === 'restartGame') {
                players =;
                tableCards =;
                pot = 0;
                currentPlayerIndex = 0;
                deckForGame =;
                currentBet = 0;
                round = 0;
                sendGameStateToAll();
            } else if (data.type === 'playerAction') {
                const player = players.find(p => p.name === data.playerName);
                if (!player) return;

                if (data.action === 'fold') {
                    fold(player);
                } else if (data.action === 'call') {
                    call(player);
                } else if (data.action === 'bet') {
                    bet(player, data.amount);
                } else if (data.action === 'raise') {
                    raise(player, data.amount);
                } else if (data.action === 'check') {
                    check(player);
                }
                playersWhoActed.add(players[currentPlayerIndex].name);
                updateUI();
                currentPlayerIndex = getNextPlayerIndex(currentPlayerIndex);
                bettingRound();
            }
        } catch (e) {
            console.error('Invalid JSON:', message);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.onerror = function (evt) {
        console.error("WebSocket error:", evt);
    };
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
