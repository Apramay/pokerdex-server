const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = [];

wss.on("connection", (ws) => {
    console.log("New player connected");

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

  if (data.type === "join" || data.type === "addPlayer") {
    if (players.length < 10) { // Limit to 10 players
        const playerId = Date.now(); // Unique ID
        const player = { id: playerId, name: data.name, chips: 1000 };
        players.push(player);
        console.log(`${data.name} joined the game.`);

        ws.send(JSON.stringify({ type: "welcome", message: `Welcome, ${data.name}!` }));
        broadcast({ type: "updatePlayers", players });

        // Attach ID to WebSocket session for reference
        ws.playerId = playerId;
    } else {
        ws.send(JSON.stringify({ type: "error", message: "Game is full!" }));
    }
}


            

            // Handle game moves (bet, fold, check)
            if (data.type === "move") {
                console.log(`${data.name} made a move: ${data.move}`);
                broadcast({ type: "move", player: data.name, move: data.move, amount: data.amount });
            }
        } catch (err) {
            console.error("Error processing message:", err);
        }
    });

ws.on("close", () => {
    players = players.filter(p => p.id !== ws.playerId); // Remove by ID
    console.log("A player disconnected.");
    broadcast({ type: "updatePlayers", players });
});


});

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}


const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`WebSocket server running on port ${PORT}`));
